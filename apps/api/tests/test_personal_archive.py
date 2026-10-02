import json
import uuid
import zipfile
import hashlib

import pytest

from app.models.annotation import ConversationAnnotation, ConversationNotebook
from app.models.content_cleanup import (
    ContentCleanupException, ContentCleanupRule, ContentCleanupRuleGrant,
    ContentCleanupRulePreference, ContentCleanupRuleRevision,
)
from app.models.import_profile import ImportProfileRevision
from app.models.reading_position import ReadingPosition
from app.models.user_preference import UserPreference
from app.models.user_skill import UserSkill, UserSkillSelection
from app.services.adaptive_import.analysis import default_mapping
from app.services.adaptive_import.profile_access import grant_revision
from app.services.adaptive_import.profiles import create_verified_revision
from app.services.content_cleanup import ensure_builtin_rules
from app.services.cleanup_rule_identity import configuration_digest_v1
from app.services.exporting.personal_archive import PERSONAL_TABLE_MODELS, create_personal_archive
from app.services.exporting.system_archive import SystemArchiveError, _read_jsonl, _validate_canonical_entries, _model_payload, _decode_payload
from test_import_profile_postgres import analysis_fixture
from test_system_archive_integrity import archive_db, seed_archive_source  # noqa: F401


def seed_personal_data(db):
    users, conversations, job, _ = seed_archive_source(db)
    a, b = users
    for user in users:
        subject = str(user.id)
        db.add(UserPreference(subject_key=subject, theme_mode="dark" if user == a else "light"))
        db.add(ConversationAnnotation(subject_key=subject, conversation_id=conversations[0].id, comment_markdown=f"Synthetic annotation {user.normalized_email}"))
        db.add(ConversationNotebook(subject_key=subject, conversation_id=conversations[0].id, title=f"Synthetic notebook {user.normalized_email}"))
        db.add(ReadingPosition(subject_key=subject, conversation_id=conversations[0].id))
        body = f"Synthetic skill {user.normalized_email}"
        skill = UserSkill(subject_key=subject, category="EXPORT_CONTEXT", locale="en", name="Synthetic skill", content=body, content_digest=hashlib.sha256(body.encode()).hexdigest(), byte_size=len(body.encode()), status="DISABLED")
        db.add(skill); db.flush()
        db.add(UserSkillSelection(subject_key=subject, category=skill.category, locale=skill.locale, skill_id=skill.id))
    analysis = analysis_fixture()
    profile, revision = create_verified_revision(
        db, analysis=analysis, mapping_spec=default_mapping(analysis), validation_spec={},
        verification_summary={"valid": True, "group_count": 1, "sample": "OTHER_ACCOUNT_SAMPLE"},
        name="OTHER_ACCOUNT_PROFILE_NAME", owner_user_id=b.id,
    )
    grant_revision(db, a.id, revision, reason="USED", display_name="My learned format")
    unheld = _model_payload(revision)
    unheld.update(id=str(uuid.uuid4()), revision=2, mapping_spec={"private": "OTHER_ACCOUNT_MAPPING"})
    second = ImportProfileRevision(**_decode_payload(ImportProfileRevision, unheld))
    db.add(second); db.flush(); profile.current_revision_id = second.id
    learned = ContentCleanupRule(owner_user_id=b.id, name="OTHER_ACCOUNT_RULE_NAME", kind="USER_LITERAL")
    builtin_revision = ensure_builtin_rules(db)[0]
    builtin = db.get(ContentCleanupRule, builtin_revision.rule_id)
    db.add(learned); db.flush()
    held_rule = ContentCleanupRuleRevision(rule_id=learned.id, revision=1, match_value="<synthetic-noise>", created_by_user_id=b.id)
    hidden_rule = ContentCleanupRuleRevision(rule_id=learned.id, revision=2, match_value="OTHER_ACCOUNT_RULE", created_by_user_id=b.id)
    db.add_all([held_rule, hidden_rule]); db.flush()
    held_rule.configuration_digest = configuration_digest_v1(_model_payload(held_rule))
    db.add(ContentCleanupRuleGrant(user_id=a.id, revision_id=held_rule.id, reason="USED"))
    db.add(ContentCleanupRulePreference(user_id=a.id, rule_id=learned.id, display_name="My noise rule", enabled=False, current_revision_id=held_rule.id))
    db.add(ContentCleanupRulePreference(user_id=a.id, rule_id=builtin.id, enabled=False))
    db.add(ContentCleanupException(owner_user_id=a.id, rule_revision_id=builtin_revision.id, scope_digest="synthetic-exception", role="assistant", match_value="<synthetic-builtin>", context_before="Synthetic before", context_after="Synthetic after", at_start=False, at_end=False))
    db.commit()
    return users, conversations, job


def test_personal_archive_contains_only_owned_data_and_held_versions(archive_db):
    users, _, job = seed_personal_data(archive_db)
    artifact = create_personal_archive(archive_db, job_id=job.id, owner_user_id=users[0].id)
    archive_db.commit()
    with zipfile.ZipFile(artifact.storage_uri) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["format"] == "chat-reader-personal-archive"
        assert manifest["restore_mode"] == "additive"
        _validate_canonical_entries(archive, manifest, table_names=PERSONAL_TABLE_MODELS)
        rows = {name: list(_read_jsonl(archive, f"data/{name}.jsonl")) for name in PERSONAL_TABLE_MODELS}
        assert len(rows["projects"]) == len(rows["conversations"]) == 1
        assert len(rows["message_versions"]) == 2
        for name in ("annotations", "notebooks", "reading_positions", "preferences", "skills", "skill_selections", "profiles", "profile_revisions", "profile_grants", "rule_grants", "rule_exceptions"):
            assert len(rows[name]) == 1, name
        assert len(rows["rules"]) == len(rows["rule_revisions"]) == len(rows["rule_preferences"]) == 2
        assert rows["profiles"][0]["name"] == "My learned format"
        assert rows["profiles"][0]["current_revision_id"] is None  # Unheld newer revision stays private.
        assert rows["profiles"][0]["owner_user_id"] is None
        assert rows["profile_revisions"][0]["created_by_user_id"] is None
        assert rows["skills"][0]["status"] == "DISABLED"
        all_data = b"".join(archive.read(name) for name in archive.namelist())
        assert str(users[1].id).encode() not in all_data
        assert users[1].normalized_email.encode() not in all_data
        assert b"OTHER_ACCOUNT" not in all_data
        assert not set(archive.namelist()).intersection({"data/users.jsonl", "data/auth_principals.jsonl", "data/auth_sessions.jsonl", "data/shares.jsonl", "data/profile_publications.jsonl", "data/rule_publications.jsonl"})


@pytest.mark.parametrize("include_archived", [False, True])
def test_personal_archive_archived_filter_applies_to_owned_graph(archive_db, include_archived):
    users, conversations, job, _ = seed_archive_source(archive_db)
    conversations[0].status = "archived"
    archive_db.commit()
    artifact = create_personal_archive(archive_db, job_id=job.id, owner_user_id=users[0].id, include_archived=include_archived)
    with zipfile.ZipFile(artifact.storage_uri) as archive:
        for name in ("conversations", "messages", "attachments", "asset_objects", "attachment_occurrences"):
            assert bool(list(_read_jsonl(archive, f"data/{name}.jsonl"))) is include_archived
        assert len(list(_read_jsonl(archive, "data/projects.jsonl"))) == 1  # Empty projects are included.


def test_unavailable_account_cannot_generate_personal_archive(archive_db):
    users, _, job, _ = seed_archive_source(archive_db)
    users[0].status = "DISABLED"; archive_db.commit()
    for owner in (users[0].id, uuid.uuid4()):
        with pytest.raises(SystemArchiveError) as error:
            create_personal_archive(archive_db, job_id=job.id, owner_user_id=owner)
        assert error.value.status_code == 403
