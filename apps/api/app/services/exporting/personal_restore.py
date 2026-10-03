"""Additive personal restore; the caller owns the final commit and task lifecycle."""
from __future__ import annotations

import hashlib
import uuid
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.archive_restore import ArchiveRestoreReceipt
from app.models.attachment import AssetObject, Attachment
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.project import Project
from app.models.user import User
from app.schemas.preferences import UserPreferenceUpdate
from app.services.assets.asset_store import get_asset_store
from app.services.assets.scanner import detect_mime_type, scan_attachment, scan_status_allows_use
from app.services.derived_rebuild import rebuild_conversation_derived_data
from app.services.editing.attachment_reference_rewriter import rewrite_attachment_data
from app.services.exporting.archive_configuration_restore import restore_configurations
from app.services.exporting.archive_preflight import EMBEDDED_COLUMNS, EMBEDDED_REFERENCES, open_personal_archive, references_for
from app.services.exporting.archive_transaction import track_archive_object
from app.services.exporting.system_archive import TABLE_MODELS, SystemArchiveError, _decode_payload
from app.services.preferences import update_preferences


def restore_personal_archive(db: Session, path: Path, *, owner_user_id: uuid.UUID,
                             expected_digest: str, include_preferences: bool = False,
                             progress_callback=None, heartbeat=None):
    with open_personal_archive(path, heartbeat=heartbeat) as archive:
        if archive.content_digest != expected_digest:
            raise SystemArchiveError("Archive changed since preview. Preview it again.", 409)
        if db.get_bind().dialect.name == "postgresql":
            key = int.from_bytes(hashlib.sha256(f"archive-restore:{owner_user_id}:{expected_digest}".encode()).digest()[:8], "big", signed=True)
            db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})
        owner = db.get(User, owner_user_id, populate_existing=True)
        if owner is None or not owner.can_login:
            raise SystemArchiveError("The restore account is unavailable.", 403)
        previous = db.get(ArchiveRestoreReceipt, (owner_user_id, expected_digest), populate_existing=True)
        if previous:
            return {**previous.result, "already_restored": True}
        if db.get_bind().dialect.name == "sqlite" and not db.connection().connection.driver_connection.in_transaction:
            # sqlite3 legacy transaction mode otherwise treats the SAVEPOINT
            # as the outer transaction and RELEASE would commit prematurely.
            db.connection().exec_driver_sql("BEGIN")
        # Everything after the successful preview is one nested transaction.
        # The worker can still roll back the outer transaction after this returns.
        with db.begin_nested():
            restore_id = uuid.uuid5(owner_user_id, f"personal-archive:{expected_digest}")
            def target(name, source):
                return uuid.uuid5(restore_id, f"{name}:{source}") if source is not None else None
            attachment_map = {uuid.UUID(source): target("attachments", source) for source in archive.ids["attachments"]}
            def embedded(value):
                if isinstance(value, list): return [embedded(item) for item in value]
                if isinstance(value, dict):
                    output = {key: embedded(item) for key, item in value.items()}
                    for key, name in EMBEDDED_REFERENCES.items():
                        if value.get(key) is not None: output[key] = str(target(name, value[key]))
                    return output
                return rewrite_attachment_data(value, attachment_map)
            assets, missing = _restore_assets(db, archive, progress_callback)
            names = {name for name, in db.query(Project.name).filter_by(owner_user_id=owner_user_id)}
            pending_current = []
            pending_conflicts = []
            first_projects, first_conversations = [], []
            order = ("projects", "conversations", "messages", "message_versions", "attachments",
                     "project_conversations", "attachment_occurrences", "source_refs", "annotations", "notebooks", "reading_positions")
            for step, name in enumerate(order):
                model = TABLE_MODELS[name]
                for index, row in enumerate(archive.rows(name), start=1):
                    decoded = _decode_payload(model, row)
                    decoded["id"] = target(name, row["id"])
                    for field, table in references_for(name, model).items():
                        source = row.get(field)
                        if field == "asset_object_id": decoded[field] = assets.get(source)
                        elif source is not None and table is not None: decoded[field] = target(table, source)
                    if "owner_user_id" in decoded: decoded["owner_user_id"] = owner_user_id
                    if "subject_key" in decoded: decoded["subject_key"] = str(owner_user_id)
                    for field in EMBEDDED_COLUMNS.get(name, ()):
                        if field in decoded: decoded[field] = embedded(decoded[field])
                    for field in ("display_text", "plain_text", "comment_markdown", "description_markdown", "summary"):
                        if isinstance(decoded.get(field), str): decoded[field] = rewrite_attachment_data(decoded[field], attachment_map)
                    if name == "projects":
                        original, suffix = decoded["name"], 1
                        while decoded["name"] in names:
                            suffix += 1; decoded["name"] = f"{original} (restored {suffix})"
                        names.add(decoded["name"]); decoded["is_default"] = False
                        if len(first_projects) < 20: first_projects.append(str(decoded["id"]))
                    if name == "conversations":
                        decoded["offline_revision"] = 1
                        if len(first_conversations) < 20: first_conversations.append(str(decoded["id"]))
                    if name == "messages":
                        pending_current.append((decoded["id"], decoded.get("current_version_id")))
                        decoded["current_version_id"] = None
                    if name == "message_versions": decoded["blocks"] = []
                    if name == "attachments":
                        decoded["import_id"] = None
                        if not row.get("asset_object_id") or row["asset_object_id"] in missing:
                            decoded["asset_object_id"] = None
                            decoded["status"] = "missing"
                            decoded["resolution_status"] = "missing"
                        elif decoded.get("asset_object_id"):
                            asset = db.get(AssetObject, decoded["asset_object_id"])
                            decoded["scan_status"] = asset.scan_status
                            decoded["detected_mime_type"] = asset.detected_mime_type
                    if name in {"annotations", "notebooks"} and decoded.get("conflict_of_id"):
                        pending_conflicts.append((model, decoded["id"], decoded["conflict_of_id"]))
                        decoded["conflict_of_id"] = None
                    if name in {"annotations", "notebooks", "reading_positions"}: decoded["revision"] = 1
                    if name == "notebooks":
                        for block in decoded["blocks"]:
                            if isinstance(block, dict) and block.get("id"):
                                block["id"] = str(uuid.uuid5(restore_id, f"notebook-block:{row['id']}:{block['id']}"))
                    db.add(model(**decoded))
                    if index % 250 == 0:
                        db.flush()
                        _report(progress_callback, "restoring", 15 + round(step * 55 / len(order)), index, archive.counts[name])
                db.flush()
            for index, (message_id, version_id) in enumerate(pending_current, start=1):
                db.get(Message, message_id).current_version_id = version_id
                if index % 250 == 0: db.flush()
            for model, row_id, conflict_id in pending_conflicts:
                db.get(model, row_id).conflict_of_id = conflict_id
            db.flush()
            _report(progress_callback, "restoring_configuration", 72, 0, 1)
            restore_configurations(db, archive, owner_user_id)
            from app.services.exporting.archive_context import restore_context
            restore_context(db, archive, target)
            if include_preferences:
                for row in archive.rows("preferences"):
                    update_preferences(db, UserPreferenceUpdate.model_validate({key: row[key] for key in UserPreferenceUpdate.model_fields if key in row}), str(owner_user_id))
            for index, source in enumerate(sorted(archive.ids["conversations"]), start=1):
                rebuild_conversation_derived_data(db, target("conversations", source))
                _report(progress_callback, "rebuilding", 75 + round(20 * index / max(1, archive.counts["conversations"])), index, archive.counts["conversations"])
            result = {"restore_id": str(restore_id), "counts": archive.counts,
                "project_ids": first_projects, "conversation_ids": first_conversations,
                "missing_assets": archive.preview()["missing_assets"], "preferences_imported": bool(include_preferences and archive.counts["preferences"]),
                "already_restored": False}
            db.add(ArchiveRestoreReceipt(owner_user_id=owner_user_id, content_digest=expected_digest,
                                        restore_id=restore_id, result=result))
            db.flush()
            _report(progress_callback, "publishing", 99, 1, 1)
        return result


def _report(callback, phase, progress, done, total):
    if callback: callback(phase, progress, done, total)


def _restore_assets(db, archive, callback):
    store, mapped, missing = get_asset_store(), {}, set()
    for index, row in enumerate(archive.rows("asset_objects"), start=1):
        entry = row.get("archive_path")
        if not entry:
            # A digest without bytes is not proof of possession of another
            # account's deduplicated object. Keep this reference missing.
            mapped[row["id"]] = None; missing.add(row["id"]); continue
        if db.get_bind().dialect.name == "postgresql":
            key = int.from_bytes(hashlib.sha256(f"archive-object:{row['sha256']}:{row['byte_size']}".encode()).digest()[:8], "big", signed=True)
            db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})
        existing = db.query(AssetObject).filter_by(sha256=row["sha256"], byte_size=row["byte_size"]).with_for_update().first()
        reusable = False
        if existing and existing.status == "available" and scan_status_allows_use(existing.scan_status):
            try:
                with store.resolve_key(existing.storage_key).open("rb") as source:
                    reusable = hashlib.file_digest(source, "sha256").hexdigest() == row["sha256"]
            except (ValueError, FileNotFoundError): pass
        if reusable:
            mapped[row["id"]] = existing.id
            continue
        with archive.archive.open(entry) as source:
            staged = store.stage(source, max_bytes=get_settings().bundle_max_object_bytes, quarantine=True)
        try:
            if staged.sha256 != row["sha256"] or staged.byte_size != row["byte_size"]:
                raise SystemArchiveError("Archive attachment changed after preview.")
            scan = scan_attachment(staged.path)
            if not scan.allowed_by_policy:
                raise SystemArchiveError("Archive attachment was rejected by the configured scanner.")
            mime, extension = detect_mime_type(staged.path)
            key = store.object_key()
            track_archive_object(db, store, key)
            store.promote(staged.path, key)
            if existing is None:
                existing = AssetObject(sha256=row["sha256"], byte_size=row["byte_size"], detected_mime_type=mime,
                    detected_extension=extension, storage_backend=store.backend, storage_key=key,
                    scan_status=scan.status, status="available")
                db.add(existing)
            else:
                existing.storage_backend, existing.storage_key = store.backend, key
                existing.detected_mime_type, existing.detected_extension = mime, extension
                existing.scan_status, existing.status, existing.deleted_at = scan.status, "available", None
            db.flush(); mapped[row["id"]] = existing.id
        finally:
            staged.path.unlink(missing_ok=True)
        _report(callback, "restoring_assets", min(14, round(14 * index / max(1, archive.counts["asset_objects"]))), index, archive.counts["asset_objects"])
    return mapped, missing
