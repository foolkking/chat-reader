"""Source-bound append. All comparisons and writes repeat inside the canonical transaction."""
import hashlib
import json
import uuid
import zipfile
from dataclasses import replace
from datetime import datetime, timezone
from itertools import islice

from fastapi import HTTPException
from sqlalchemy import select, or_, text

from app.models.attachment import Attachment
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.reader_extension import ExtensionDevice, ExtensionSource
from app.models.share import Share
from app.services.adaptive_import.reader_package import PROFILE, INDEX, package_header
from app.services.adaptive_import.archive_sources import _artifact_path, verify_archive_sources
from app.services.extension_access import alive, principal_for


def canonical_stamp(db, cid):
    """Bound identity/current revision, order, deletion and local resource changes, not user notes."""
    h = hashlib.sha256()
    for statement in (
        select(Message.id, Message.role, Message.order_key, Message.current_version_id, Message.is_deleted)
          .where(Message.conversation_id == cid).order_by(Message.order_key),
        select(Attachment.id, Attachment.asset_object_id, Attachment.display_name, Attachment.deleted_at, Attachment.status)
          .where(Attachment.conversation_id == cid).order_by(Attachment.id),
    ):
        for row in db.execute(statement.execution_options(yield_per=64)):
            h.update(json.dumps(list(row), default=str, separators=(",",":")).encode() + b"\n")
    return h.hexdigest()


def source_summary(path, before=0):
    """Only called for a validated, retained staged source. Do not read media to check a prefix."""
    from app.services.adaptive_import.reader_package import _json, require
    with zipfile.ZipFile(path) as z:
        head = package_header(z)
        roots = {a["path"]:a["root"] for a in head["assets"]}
        sha = hashlib.sha256((head["lineage"] + "\n").encode())
        count, prefix = 0, sha.hexdigest()
        with z.open(INDEX) as f:
            while line := f.readline(65537):
                require(len(line) <= 65536 and count < 50000)
                r = _json(line)
                sha.update(json.dumps([r["id"],r["parent"],r["source_path"],r["role"],r["at"],r["sha256"],
                           [(p, roots[p]) for p in r["assets"]]], ensure_ascii=False, separators=(",",":")).encode() + b"\n")
                count += 1
                if count == before:
                    prefix = sha.hexdigest()
        return head, count, prefix, sha.hexdigest()


def inspect(db, record, *, lock=False):
    from app.services.feature_policies import get_feature_policy
    grant_id = uuid.UUID(record.analysis_summary["extension_device"])
    stmt = select(ExtensionDevice).where(ExtensionDevice.id == grant_id)
    grant = db.scalar(stmt.with_for_update() if lock else stmt)
    owner = principal_for(db, grant)
    if owner.id != record.owner_user_id or not alive(grant.expires_at, datetime.now(timezone.utc)) or not get_feature_policy(db).allow_user_import:
        raise HTTPException(403, "Import authorization expired.")
    archives = [a for a in record.artifacts if a.source_type == "adaptive_archive"]
    if len(archives) != 1 or not (archives[0].parsed_summary or {}).get("reader_profile") == PROFILE:
        raise HTTPException(409, "Reader package was not recognized; nothing was imported.")
    p = _artifact_path(record, archives[0])
    with zipfile.ZipFile(p) as z:
        key = "chatgpt:" + package_header(z)["source_id"]
    if lock and db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key":int.from_bytes(
            hashlib.sha256(f"{owner.id}:{key}".encode()).digest()[:8], "big", signed=True)})
    binding = db.scalar(select(ExtensionSource).where(ExtensionSource.owner_user_id == owner.id, ExtensionSource.source_key == key))
    head, count, prefix, digest = source_summary(p, binding.message_count if binding else 0)
    cid = binding.conversation_id if binding else None
    statement = select(Conversation).where(Conversation.id == cid, Conversation.owner_user_id == owner.id)
    target = db.scalar(statement.with_for_update() if lock else statement) if cid else None
    state = "new"
    if binding:
        if not target or target.status != "active" or target.deleted_at or canonical_stamp(db, cid) != binding.canonical_digest:
            state = "conflict"
        elif count == binding.message_count and digest == binding.source_digest:
            state = "unchanged"
        elif count <= binding.message_count or prefix != binding.source_digest or head["lineage"] != "tree":
            state = "conflict"
        else:
            state = "append"
    elif db.scalar(select(Conversation.id).where(Conversation.owner_user_id == owner.id,
                    Conversation.external_source_id == head["source_id"]).limit(1)):
        state = "conflict"
    shares = []
    if state == "append":
        shares = sorted(str(v) for v in db.scalars(select(Share.id).where(Share.conversation_id == cid,
            Share.scope == "conversation", Share.content_mode == "live", Share.revoked_at.is_(None),
            or_(Share.expires_at.is_(None), Share.expires_at > datetime.now(timezone.utc)))))
    summary = record.analysis_summary or {}
    destination = (summary.get("commit_options") or {}).get("project_id", summary.get("target_project_id"))
    source_proof = hashlib.sha256(json.dumps([key, digest, archives[0].sha256,
        (archives[0].parsed_summary or {}).get("classification_version"), destination]).encode()).hexdigest()
    receipt = hashlib.sha256(json.dumps([str(record.id), source_proof, state, str(cid),
        binding.source_digest if binding else None, shares, head["partial"]]).encode()).hexdigest()
    return (dict(action=state, conversation_id=cid, live_share=bool(shares), partial=head["partial"],
                 messages=count, previous=binding.message_count if binding else 0, receipt=receipt,
                 source_proof=source_proof), key, digest, binding, target)


class Tail:
    """Skip once during sequential iteration; no eager list slice in the bounded path."""
    def __init__(self, seq, skip):
        self.seq, self.skip = seq, skip
    def __len__(self):
        return len(self.seq) - self.skip
    def __iter__(self):
        return islice(iter(self.seq), self.skip, None)


def persist(db, record, artifacts, draft, progress, verified):
    from app.services.canonical import persistence as cp
    from app.services.canonical.stream_persistence import persist_stream_messages
    from app.services.conversation_revision import bump_offline_revision
    verify_archive_sources(record, verified)
    info, key, digest, binding, target = inspect(db, record, lock=True)
    decision = (record.analysis_summary or {}).get("extension_decision") or {}
    # Another worker may just have applied exactly this immutable source. This
    # transition writes nothing to the conversation; never substitute a new
    # target for a reviewed append or silently resolve a conflict/separate copy.
    if (info["action"] == "unchanged" and not decision.get("separate") and decision.get("receipt")
            and decision.get("source_proof") == info["source_proof"]
            and (decision.get("approved_action") == "new" or decision.get("approved_action") == "append"
                 and decision.get("approved_target") == str(target.id))
            and (not info["partial"] or decision.get("accept_partial"))):
        record.analysis_summary = {**record.analysis_summary, "extension_outcome": "unchanged"}
        return target, False, False
    if (decision.get("receipt") != info["receipt"] or info["partial"] and not decision.get("accept_partial")
            or info["live_share"] and not decision.get("accept_share")):
        raise cp.CommitImportError("Source, authorization or sharing changed. Review this import again.")
    copy = decision.get("separate") is True
    if info["action"] == "conflict" and not copy:
        raise cp.CommitImportError("Source diverged. The original was not changed.")
    if info["action"] == "new" or copy:
        target = cp._persist_conversation(record, artifacts, draft, db, progress_callback=progress,
              total_messages=len(draft.messages), verified_archive_sources=verified)
        if not copy:
            binding = ExtensionSource(owner_user_id=record.owner_user_id, source_key=key, conversation_id=target.id)
        attach_project = True
    elif info["action"] == "unchanged":
        record.analysis_summary = {**record.analysis_summary, "extension_outcome":"unchanged"}
        return target, False, False
    else:
        skip = binding.message_count
        old_by_path = {a.metadata_.get("archive_path"): a.id for a in
                       db.scalars(select(Attachment).where(Attachment.conversation_id == target.id, Attachment.deleted_at.is_(None)))}
        reused, fresh = {}, []
        for raw in draft.attachments:
            if raw.get("record_type") == "attachment" and (path := raw.get("metadata",{}).get("archive_path")) in old_by_path:
                reused[str(raw["id"])] = old_by_path[path]
            else:
                fresh.append(raw)
        suffix = replace(draft, messages=Tail(draft.messages, skip) if draft.stream_records is not None else draft.messages[skip:],
                         stream_records=Tail(draft.stream_records, skip) if draft.stream_records is not None else None,
                         attachments=fresh)
        ids = {**reused, **cp._persist_canjson_attachments(db, record, target, suffix, verified_archives=verified)}
        if suffix.stream_records is not None:
            persist_stream_messages(db, target, suffix, ids, progress, skip, len(draft.messages))
        else:
            messages = cp._rewrite_persistable_attachment_ids(suffix.messages, ids)
            identity = cp._persist_messages(target, messages, db,
                preserved_source_message_ids={m.source_message_id for m in messages}, progress_callback=progress,
                processed_before=skip, total_messages=len(draft.messages))
            cp._persist_canjson_private_content(db, target, suffix, identity, ids)
        target.message_count = len(draft.messages)
        target.turn_count = sum(m.role == "user" for m in draft.messages)
        from app.services.canonical.stream_persistence import conversation_hash
        from app.models.message_version import MessageVersion
        target.content_hash = conversation_hash(db.execute(select(MessageVersion.plain_text).join(Message,
            Message.current_version_id == MessageVersion.id).where(Message.conversation_id == target.id)
            .order_by(Message.order_key).execution_options(yield_per=8)))
        target.updated_at = datetime.now(timezone.utc)
        bump_offline_revision(target)
        attach_project = False
    if not copy:
        db.flush()
        binding.source_digest, binding.canonical_digest = digest, canonical_stamp(db, target.id)
        binding.message_count = info["messages"]
        db.add(binding)
    return target, attach_project, True
