"""Versioned archive extension for non-executable Skill members and history."""
from __future__ import annotations

import hashlib
import re
import uuid

from app.models.skill_bundle import SkillBundleMember, SkillBundleRevision
from app.services.skill_bundles import Bundle, MAX_MEMBER, MAX_EXPANDED, MAX_MEMBERS, _object, _parse_bundle, encode_bundle
from app.services.exporting.system_archive import SystemArchiveError, _decode_payload

BUNDLE_TABLES = {"skill_file_objects", "skill_bundle_revisions", "skill_bundle_members"}


def bundle_table_models(models, manifest):
    version = manifest.get("skill_bundle_version")
    if version is not None and (type(version) is not int or version != 1 or not BUNDLE_TABLES <= models.keys()):
        raise SystemArchiveError("Unsupported Skill archive extension.")
    return {name: model for name, model in models.items() if version is not None or name not in BUNDLE_TABLES}


def _read_object(archive, row):
    with archive.archive.open(row["archive_path"]) as source:
        data = source.read(MAX_MEMBER + 1)
    if len(data) != row["byte_size"] or hashlib.sha256(data).hexdigest() != row["sha256"]:
        raise SystemArchiveError("Archived Skill member failed checksum or size validation.")
    return data


def _bundle(archive, revision, members, objects):
    return Bundle(revision["root_name"], {row["path"]: _read_object(archive, objects[row["object_sha256"]])
                                         for row in members}, revision["source_kind"])


def validate_bundle_archive(archive):
    skills = {("user", row["id"]): row for row in archive.rows("skills")}
    skills.update({("system", row["id"]): row for row in archive.rows("system_skills")})
    if "skill_bundle_revisions" not in archive.table_models:
        if any(row.get("bundle_revision", 0) or row.get("bundle_digest") for row in skills.values()):
            raise SystemArchiveError("Archive has Skill version pointers but no Bundle history.")
        return set()
    objects = {row["sha256"]: row for row in archive.rows("skill_file_objects")}
    for digest, row in objects.items():
        if (not re.fullmatch(r"[0-9a-f]{64}", digest) or row["byte_size"] < 0 or row["byte_size"] > MAX_MEMBER
                or row.get("archive_path") != f"skills/objects/{digest[:2]}/{digest}"):
            raise SystemArchiveError("Archive contains invalid Skill object metadata.")
        _read_object(archive, row)
        if archive.heartbeat: archive.heartbeat()
    members = {}
    used = set()
    for row in archive.rows("skill_bundle_members"):
        members.setdefault(row["revision_id"], []).append(row)
        used.add(row["object_sha256"])
    if used != set(objects):
        raise SystemArchiveError("Archive contains unreferenced or missing Skill objects.")
    revisions, seen = {}, set()
    for row in archive.rows("skill_bundle_revisions"):
        if bool(row.get("user_skill_id")) == bool(row.get("system_skill_id")):
            raise SystemArchiveError("Archive Skill revision requires exactly one owner.")
        owner = ("user", row["user_skill_id"]) if row.get("user_skill_id") else ("system", row["system_skill_id"])
        key = (*owner, row["revision"])
        if owner not in skills or row["revision"] < 1 or key in seen or row["source_kind"] not in {"BUNDLE", "LEGACY_MARKDOWN"}:
            raise SystemArchiveError("Archive contains invalid Skill version ownership.")
        seen.add(key)
        entries = members.get(row["id"], [])
        if len(entries) > MAX_MEMBERS or sum(objects[item["object_sha256"]]["byte_size"] for item in entries) > MAX_EXPANDED:
            raise SystemArchiveError("Archive Skill version exceeds resource limits.")
        bundle = _bundle(archive, row, entries, objects)
        # The same structural validator used by uploads; this never executes a member.
        _parse_bundle(encode_bundle(bundle), "archive.zip", max_upload=MAX_EXPANDED + MAX_MEMBERS * 1024)
        if bundle.digest != row["digest"] or sum(map(len, bundle.members.values())) != row["byte_size"]:
            raise SystemArchiveError("Archive Skill version failed integrity validation.")
        owner_skill = skills[owner]
        if owner_skill.get("bundle_revision", 0) == row["revision"] and bundle.content != owner_skill.get("content"):
            raise SystemArchiveError("Archive Skill current content does not match its revision.")
        revisions[key] = row
        if archive.heartbeat: archive.heartbeat()
    for owner, skill in skills.items():
        current = skill.get("bundle_revision", 0)
        if not current:
            if skill.get("bundle_digest"):
                raise SystemArchiveError("Archive Skill digest has no selected revision.")
            continue
        selected = revisions.get((*owner, current))
        if selected is None:
            raise SystemArchiveError("Archive Skill current content does not match its revision.")
        expected = selected["digest"] if selected["source_kind"] == "BUNDLE" else None
        if owner[0] == "user" and skill.get("bundle_digest") != expected:
            raise SystemArchiveError("Archive Skill identity does not match its Bundle.")
    return {row["archive_path"] for row in objects.values()}


def restore_bundle_history(db, archive, user_targets, *, system_targets=None, preserve_current=()):
    """Merge immutable history; remap revision numbers only where the target conflicts."""
    if "skill_bundle_revisions" not in archive.table_models:
        return
    from app.models.user_skill import UserSkill
    from app.models.administration import SystemSkill
    system_targets = system_targets or {}
    objects = {row["sha256"]: row for row in archive.rows("skill_file_objects")}
    members = {}
    for row in archive.rows("skill_bundle_members"):
        members.setdefault(row["revision_id"], []).append(row)
    current = {(False, row["id"]): row.get("bundle_revision", 0) for row in archive.rows("skills")}
    current.update({(True, row["id"]): row.get("bundle_revision", 0) for row in archive.rows("system_skills")})
    for raw in sorted(archive.rows("skill_bundle_revisions"), key=lambda row: row["revision"]):
        system = raw.get("system_skill_id") is not None
        source = raw["system_skill_id" if system else "user_skill_id"]
        target = (system_targets if system else user_targets)[source]
        model = SystemSkill if system else UserSkill
        item = db.get(model, target)
        column = SkillBundleRevision.system_skill_id if system else SkillBundleRevision.user_skill_id
        existing = db.query(SkillBundleRevision).filter(column == target, SkillBundleRevision.digest == raw["digest"],
                                                       SkillBundleRevision.source_kind == raw["source_kind"]).first()
        if existing is None:
            latest = db.query(SkillBundleRevision).filter(column == target).order_by(SkillBundleRevision.revision.desc()).first()
            number = max(raw["revision"], (latest.revision + 1) if latest else 1)
            values = _decode_payload(SkillBundleRevision, raw)
            values.update(id=uuid.uuid4(), user_skill_id=None if system else target,
                          system_skill_id=target if system else None, revision=number)
            existing = SkillBundleRevision(**values)
            db.add(existing); db.flush()
            for member in members[raw["id"]]:
                obj = _object(db, _read_object(archive, objects[member["object_sha256"]]))
                db.add(SkillBundleMember(revision_id=existing.id, path=member["path"], object_sha256=obj.sha256))
            db.flush()
        if current[(system, source)] == raw["revision"] and target not in preserve_current:
            item.bundle_revision = existing.revision
        if archive.heartbeat: archive.heartbeat()
    db.flush()
