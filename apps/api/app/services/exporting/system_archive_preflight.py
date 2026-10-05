"""Read-only system archive graph/ownership inspection shared by preview and restore."""
from __future__ import annotations

import hashlib
import json
import zipfile
from contextlib import contextmanager

from sqlalchemy import inspect

from app.models.user import User
from app.services.auth import normalize_email
from app.services.exporting.archive_accounts import IDENTITY_FIELDS, ArchiveOwnershipError
from app.services.exporting.archive_preflight import PersonalArchive, _validate_row
from app.services.exporting.system_archive import (
    TABLE_MODELS, SYSTEM_ARCHIVE_FORMAT, SystemArchiveError, _ArchiveRows,
    _validate_members, _read_manifest, _validate_canonical_entries, _validate_asset_entries,
)
from app.services.exporting.system_archive_configuration import CONFIGURATION_MODELS, CONFIGURATION_VERSION, ACCOUNT_FIELDS, validate_system_configuration


class SystemArchive(PersonalArchive):
    def __init__(self, archive, heartbeat=None):
        self.archive, self.heartbeat = archive, heartbeat
        _validate_members(archive)
        self.manifest = _read_manifest(archive)
        self.version = self.manifest.get("version")
        if self.manifest.get("format") != SYSTEM_ARCHIVE_FORMAT or self.version not in {4, 5}:
            raise SystemArchiveError("Unsupported system archive format.")
        extension = self.manifest.get("configuration_version")
        if extension is not None and (extension != CONFIGURATION_VERSION or self.version != 5):
            raise SystemArchiveError("Unsupported system archive configuration version.")
        self.has_configuration = extension is not None
        self.table_models = {**TABLE_MODELS, **({"users": User} if self.version == 5 else {}),
                             **(CONFIGURATION_MODELS if self.has_configuration else {})}
        from app.services.exporting.archive_skill_bundles import bundle_table_models
        self.table_models = bundle_table_models(self.table_models, self.manifest)
        from app.services.exporting.archive_context import context_table_models
        self.table_models = context_table_models(self.table_models, self.manifest)
        from app.services.exporting.archive_support import support_table_models
        self.table_models = support_table_models(self.table_models, self.manifest)
        _validate_canonical_entries(archive, self.manifest, table_names=self.table_models, heartbeat=heartbeat)
        declared = sorted(self.manifest["canonical_entries"], key=lambda item: item["path"])
        self.counts = {item["path"][5:-6]: item["record_count"] for item in declared}
        self.content_digest = hashlib.sha256(json.dumps({
            "format": SYSTEM_ARCHIVE_FORMAT, "version": self.version, "configuration_version": extension,
            "entries": [{key: row[key] for key in ("path", "sha256", "byte_size", "record_count")} for row in declared],
        }, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        self.ids, self.referenced_owners = {}, set()
        self.parents = {name: {} for name in ("messages", "message_versions", "attachments", "annotations", "notebooks")}
        emails, roots = set(), 0
        for name, model in self.table_models.items():
            keys = set()
            pk = [inspect(model).get_property_by_column(column).key for column in inspect(model).primary_key]
            for row in self.rows(name):
                _validate_row(name, model, row)
                key = row["id"] if hasattr(model, "id") else row[pk[0]] if len(pk) == 1 else tuple(row[field] for field in pk)
                if key in keys:
                    raise SystemArchiveError("Archive contains duplicate record identities.")
                keys.add(key)
                if name in self.parents:
                    self.parents[name][row["id"]] = row["message_id"] if name == "message_versions" else row["conversation_id"]
                if name in {"projects", "conversations"}:
                    self.referenced_owners.add(row.get("owner_user_id") or "unowned")
                for field in ACCOUNT_FIELDS:
                    if row.get(field) is not None:
                        self.referenced_owners.add(row[field])
                if "subject_key" in row:
                    self.referenced_owners.add("unowned" if row["subject_key"] in {"owner", "local:default"} else row["subject_key"])
                if name == "users":
                    if set(row) - IDENTITY_FIELDS or row.get("role") not in {"USER", "ADMIN"} or row.get("status") not in {"ACTIVE", "PENDING", "DISABLED"} or row.get("approval_status", "APPROVED") not in {"APPROVED", "PENDING", "REJECTED"}:
                        raise SystemArchiveError("Archive contains invalid account metadata.")
                    roots += row["role"] == "ADMIN"
                    if row["role"] == "USER":
                        email = normalize_email(row["normalized_email"])
                        if email in emails:
                            raise SystemArchiveError("Archive contains duplicate account emails.")
                        emails.add(email)
            self.ids[name] = keys
        if roots > 1:
            raise SystemArchiveError("Archive contains ambiguous account identities.")
        if self.version == 5 and self.referenced_owners - self.ids["users"] - {"unowned"}:
            raise SystemArchiveError("Archive is missing a referenced account identity.")
        self._validate_references()
        if self.has_configuration:
            validate_system_configuration(self)
        _validate_asset_entries(archive, self.rows("asset_objects"), heartbeat=heartbeat)
        from app.services.exporting.archive_skill_bundles import validate_bundle_archive
        skill_paths = validate_bundle_archive(self)
        from app.services.exporting.archive_context import validate_context_archive
        skill_paths |= validate_context_archive(self)
        allowed = {"manifest.json", *skill_paths, *(f"data/{name}.jsonl" for name in self.table_models)}
        allowed.update(row["archive_path"] for row in self.rows("asset_objects") if row.get("archive_path"))
        if set(archive.namelist()) != allowed:
            raise SystemArchiveError("System archive contains unexpected or undeclared files.")

    def rows(self, name):
        if name not in self.counts:
            return ()
        return _ArchiveRows(self.archive, f"data/{name}.jsonl", self.counts[name], self.heartbeat)

    def preview(self):
        result = super().preview()
        result.pop("include_preferences_default")
        result.update(restore_mode="empty_instance_only", configuration_included=self.has_configuration,
                      archive_version=self.version, source_accounts=sorted(self.referenced_owners))
        return result


@contextmanager
def open_system_archive(path, *, heartbeat=None):
    try:
        with zipfile.ZipFile(path) as archive:
            yield SystemArchive(archive, heartbeat=heartbeat)
    except (zipfile.BadZipFile, KeyError, ValueError, TypeError, UnicodeError, RecursionError, AttributeError) as exc:
        if isinstance(exc, (SystemArchiveError, ArchiveOwnershipError)):
            raise
        raise SystemArchiveError("System archive is malformed or incomplete.") from exc


def inspect_system_archive(path, *, heartbeat=None):
    with open_system_archive(path, heartbeat=heartbeat) as archive:
        return archive.preview()
