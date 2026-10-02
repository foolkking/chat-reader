"""Bounded personal archive validation before any canonical writes."""
from __future__ import annotations

import hashlib
import json
import uuid
import zipfile
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import Boolean, DateTime, Integer, JSON, String, Uuid, inspect

from app.services.editing.attachment_reference_rewriter import attachment_data_ids
from app.services.exporting.personal_archive import PERSONAL_ARCHIVE_FORMAT, PERSONAL_ARCHIVE_VERSION, PERSONAL_TABLE_MODELS
from app.services.exporting.system_archive import (
    SystemArchiveError, _ArchiveRows, _decode_payload, _read_manifest,
    _validate_asset_entries, _validate_canonical_entries, _validate_members,
)


EXTRA_REFERENCES = {
    ("messages", "current_version_id"): "message_versions",
    ("message_versions", "based_on_version_id"): "message_versions",
}
EMBEDDED_REFERENCES = {
    "conversation_id": "conversations", "conversationId": "conversations",
    "message_id": "messages", "messageId": "messages",
    "message_version_id": "message_versions", "messageVersionId": "message_versions",
    "current_version_id": "message_versions", "version_id": "message_versions",
    "annotation_id": "annotations", "annotationId": "annotations",
    "attachment_id": "attachments", "attachmentId": "attachments",
}
EMBEDDED_COLUMNS = {
    "notebooks": ("blocks",), "reading_positions": ("anchor_data",),
    "annotations": ("metadata_",), "attachments": ("metadata_",),
}


def references_for(name, model, table_models=PERSONAL_TABLE_MODELS):
    result = {}
    tables = {value.__tablename__: key for key, value in table_models.items()}
    for prop in inspect(model).column_attrs:
        for foreign in prop.columns[0].foreign_keys:
            target = tables.get(foreign.column.table.name)
            if target:
                result[prop.key] = target
            elif foreign.column.table.name != "users":
                result[prop.key] = None
    result.update({field: target for (table, field), target in EXTRA_REFERENCES.items() if table == name})
    return result


def _validate_row(name, model, payload):
    for prop in inspect(model).column_attrs:
        column = prop.columns[0]
        if prop.key not in payload:
            if name == "asset_objects" and prop.key in {"storage_key", "storage_backend"}:
                continue
            if not column.nullable and column.default is None and column.server_default is None:
                raise SystemArchiveError("Archive is missing a required record field.")
            continue
        value = payload[prop.key]
        if value is None:
            if not column.nullable:
                raise SystemArchiveError("Archive contains an empty required field.")
            continue
        kind = column.type
        valid = True
        if isinstance(kind, Boolean): valid = isinstance(value, bool)
        elif isinstance(kind, Integer): valid = isinstance(value, int) and not isinstance(value, bool)
        elif isinstance(kind, (String, DateTime, Uuid)): valid = isinstance(value, str)
        elif isinstance(kind, JSON): valid = isinstance(value, (dict, list))
        if isinstance(kind, String) and kind.length and isinstance(value, str): valid = len(value) <= kind.length
        if not valid:
            raise SystemArchiveError("Archive contains an invalid record field type.")
    _decode_payload(model, payload)  # UUID/date syntax, without trusting unknown columns.
    if name == "preferences":
        from app.schemas.preferences import UserPreferenceUpdate
        UserPreferenceUpdate.model_validate({key: payload[key] for key in UserPreferenceUpdate.model_fields if key in payload})
    if name == "notebooks":
        from app.schemas.annotation import NotebookPut
        NotebookPut.model_validate({"title": payload.get("title"), "blocks": payload["blocks"]})
    if name == "skills":
        from app.services.skills import MAX_SKILL_BYTES
        body = payload["content"].encode("utf-8")
        if (len(body) > MAX_SKILL_BYTES or not body.strip() or len(body) != payload["byte_size"]
                or hashlib.sha256(body).hexdigest() != payload["content_digest"]
                or payload["category"] not in {"EXPORT_CONTEXT", "CONVERSATION_RESCUE"}
                or payload["locale"] not in {"zh-CN", "en"} or payload["status"] not in {"ACTIVE", "DISABLED"}):
            raise SystemArchiveError("Archive contains an invalid personal Skill.")


class PersonalArchive:
    table_models = PERSONAL_TABLE_MODELS

    def __init__(self, archive, heartbeat=None):
        self.archive = archive
        self.heartbeat = heartbeat
        _validate_members(archive)
        self.manifest = _read_manifest(archive)
        if (self.manifest.get("format") != PERSONAL_ARCHIVE_FORMAT or
                self.manifest.get("version") != PERSONAL_ARCHIVE_VERSION or
                self.manifest.get("restore_mode") != "additive"):
            raise SystemArchiveError("Select a personal data archive for additive restore.")
        _validate_canonical_entries(archive, self.manifest, table_names=PERSONAL_TABLE_MODELS, heartbeat=heartbeat)
        declared = sorted(self.manifest["canonical_entries"], key=lambda row: row["path"])
        self.content_digest = hashlib.sha256(json.dumps({
            "format": PERSONAL_ARCHIVE_FORMAT, "version": PERSONAL_ARCHIVE_VERSION,
            "entries": [{key: row[key] for key in ("path", "sha256", "byte_size", "record_count")} for row in declared],
        }, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        self.counts = {row["path"][5:-6]: row["record_count"] for row in declared}
        self.ids = {}
        self.parents = {name: {} for name in ("messages", "message_versions", "attachments", "annotations", "notebooks")}
        source_owners = set()
        for name, model in self.table_models.items():
            keys = set()
            has_id = hasattr(model, "id")
            pk = [inspect(model).get_property_by_column(column).key for column in inspect(model).primary_key]
            for row in self.rows(name):
                _validate_row(name, model, row)
                key = row["id"] if has_id else tuple(row[field] for field in pk)
                if key in keys:
                    raise SystemArchiveError("Archive contains duplicate record identities.")
                keys.add(key)
                for field in ("owner_user_id", "subject_key", "user_id"):
                    if row.get(field) is not None:
                        source_owners.add(row[field])
                if name in self.parents:
                    self.parents[name][row["id"]] = row["message_id"] if name == "message_versions" else row["conversation_id"]
            self.ids[name] = keys
        if len(source_owners) > 1:
            raise SystemArchiveError("A personal archive cannot mix account ownership.")
        if self.counts["preferences"] > 1:
            raise SystemArchiveError("Archive contains multiple account preferences.")
        self._validate_references()
        self._validate_configurations()
        _validate_asset_entries(archive, self.rows("asset_objects"), heartbeat=heartbeat)
        allowed = {"manifest.json", *(f"data/{name}.jsonl" for name in PERSONAL_TABLE_MODELS)}
        allowed.update(row["archive_path"] for row in self.rows("asset_objects") if row.get("archive_path"))
        if set(archive.namelist()) != allowed:
            raise SystemArchiveError("Personal archive contains unexpected or undeclared files.")

    def rows(self, name):
        return _ArchiveRows(self.archive, f"data/{name}.jsonl", self.counts[name], self.heartbeat)

    def _reference(self, table, value):
        if value is not None and (table is None or value not in self.ids[table]):
            raise SystemArchiveError("Archive contains a missing internal reference.")

    def _embedded(self, value):
        if isinstance(value, dict):
            for key, item in value.items():
                if key in EMBEDDED_REFERENCES:
                    self._reference(EMBEDDED_REFERENCES[key], item)
                self._embedded(item)
        elif isinstance(value, list):
            for item in value: self._embedded(item)

    def _validate_references(self):
        attachment_ids = {uuid.UUID(value) for value in self.ids["attachments"]}
        for name, model in self.table_models.items():
            for row in self.rows(name):
                for field, table in references_for(name, model, self.table_models).items():
                    self._reference(table, row.get(field))
                for field in EMBEDDED_COLUMNS.get(name, ()):
                    self._embedded(row.get(field))
                if name in {"message_versions", "annotations", "notebooks", "conversations"}:
                    fields = {key: row.get(key) for key in ("display_text", "comment_markdown", "blocks", "description_markdown", "summary")}
                    if attachment_data_ids(fields) - attachment_ids:
                        raise SystemArchiveError("Archive contains an attachment outside its restore scope.")
                if name == "messages" and row.get("current_version_id"):
                    if self.parents["message_versions"][row["current_version_id"]] != row["id"]:
                        raise SystemArchiveError("Archive current version belongs to another message.")
                if name == "attachment_occurrences":
                    message = self.parents["message_versions"][row["message_version_id"]]
                    if self.parents["attachments"][row["attachment_id"]] != self.parents["messages"][message]:
                        raise SystemArchiveError("Archive attachment occurrence crosses conversations.")
                if name in {"annotations", "reading_positions"} and row.get("message_id"):
                    if self.parents["messages"][row["message_id"]] != row["conversation_id"]:
                        raise SystemArchiveError("Archive Reader state crosses conversations.")
                if name == "annotations" and row.get("message_version_id"):
                    if self.parents["message_versions"][row["message_version_id"]] != row.get("message_id"):
                        raise SystemArchiveError("Archive annotation belongs to another message version.")

    def _validate_configurations(self):
        from app.services.adaptive_import.profile_identity import configuration_digest_v1 as profile_digest
        from app.services.cleanup_rule_identity import MATCH_FIELDS, configuration_digest_v1 as rule_digest
        from app.services.content_cleanup import BUILTIN_RULES, validate_literal_rule
        from app.schemas.content_cleanup import CleanupRuleCreate
        profiles = {row["id"]: row for row in self.rows("profiles")}
        rules = {row["id"]: row for row in self.rows("rules")}
        for row in self.rows("profile_revisions"):
            profile = profiles[row["profile_id"]]
            if profile["kind"] != "LEARNED" or profile["source_mode"] not in {"JSON", "MARKDOWN", "JSON_MARKDOWN"} or row["status"] not in {"VERIFIED", "SUPERSEDED"}:
                raise SystemArchiveError("Archive contains an unsupported import format revision.")
            digest = profile_digest(source_mode=profile["source_mode"], **{key: row[key] for key in (
                "source_signature", "match_spec", "mapping_spec", "validation_spec", "matcher_version", "normalizer_version")})
            if row.get("configuration_digest") and digest != row["configuration_digest"]:
                raise SystemArchiveError("Archive import format configuration checksum mismatch.")
        for row in self.rows("rule_revisions"):
            rule = rules[row["rule_id"]]
            if rule["kind"] == "BUILTIN":
                if rule["detector_id"] not in {item[0] for item in BUILTIN_RULES}:
                    raise SystemArchiveError("Archive references an unavailable built-in noise detector.")
                continue
            if rule["kind"] != "USER_LITERAL" or rule["scope"] != "MESSAGE":
                raise SystemArchiveError("Archive contains an unsupported personal noise rule.")
            CleanupRuleCreate.model_validate({"name": rule["name"], **{key: row[key] for key in (
                "match_value", "case_sensitive", "role_filter", "matcher_mode", "boundary_mode")}})
            validate_literal_rule(row["match_value"] or "", row["matcher_mode"])
            digest = rule_digest({key: row[key] for key in MATCH_FIELDS}, scope=rule["scope"])
            if row.get("configuration_digest") and digest != row["configuration_digest"]:
                raise SystemArchiveError("Archive noise rule configuration checksum mismatch.")
        for name, source_field, target_field in (("profile_aliases", "old_profile_id", "canonical_profile_id"), ("rule_aliases", "old_rule_id", "canonical_rule_id")):
            aliases = {row[source_field]: row[target_field] for row in self.rows(name)}
            for source in aliases:
                seen = set()
                while source in aliases:
                    if source in seen: raise SystemArchiveError("Archive contains a configuration alias cycle.")
                    seen.add(source); source = aliases[source]

    def preview(self):
        projects, conversations = [], []
        for row in self.rows("projects"):
            if len(projects) < 50: projects.append({"name": row["name"], "archived": row.get("is_archived", False)})
        for row in self.rows("conversations"):
            if len(conversations) < 50: conversations.append({"title": row["display_title"], "archived": row.get("status") == "archived"})
        missing_ids = {row["id"] for row in self.rows("asset_objects") if not row.get("archive_path")}
        unbacked = sum(not row.get("asset_object_id") for row in self.rows("attachments"))
        missing_attachments = sum(not row.get("asset_object_id") or row["asset_object_id"] in missing_ids for row in self.rows("attachments"))
        return {"content_digest": self.content_digest, "counts": self.counts, "projects": projects,
                "conversations": conversations, "preview_limit": 50, "missing_assets": len(missing_ids) + unbacked,
                "missing_attachments": missing_attachments,
                "include_preferences_default": False, "restore_mode": "additive"}


@contextmanager
def open_personal_archive(path: Path, *, heartbeat=None):
    try:
        with zipfile.ZipFile(path) as archive:
            yield PersonalArchive(archive, heartbeat=heartbeat)
    except (zipfile.BadZipFile, KeyError, ValueError, TypeError, UnicodeError, RecursionError) as exc:
        if isinstance(exc, SystemArchiveError): raise
        raise SystemArchiveError("Personal archive is malformed or incomplete.") from exc


def inspect_personal_archive(path: Path, *, heartbeat=None):
    with open_personal_archive(path, heartbeat=heartbeat) as archive:
        return archive.preview()
