import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.database import Base
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.import_profile import ImportProfile
from app.models.import_record import ImportRecord
from app.models.project import Project
from app.models.user import User
from app.services.background_jobs import queue_conversation_merge
from app.services.conversations.conversation_deletion import delete_conversation_record
from app.services.editing.message_edit_service import MessageEditError, create_manual_conversation
from app.services.ownership import (
    LEGACY_OWNER_USER_ID,
    LEGACY_OWNERSHIP_SCOPE,
    OwnershipScope,
    assign_owner,
    get_owned,
)
from app.services.projects.project_service import (
    ProjectServiceError,
    create_project,
    ensure_default_project,
    list_project_conversations,
    list_projects,
    move_conversation_to_project,
)


def _user(user_id: uuid.UUID, email: str) -> User:
    return User(
        id=user_id,
        normalized_email=email,
        display_name=email.split("@", 1)[0],
        role="USER",
        status="ACTIVE",
    )


def _conversation(db: Session, scope: OwnershipScope, title: str) -> Conversation:
    return create_manual_conversation(
        db,
        title=title,
        user_text=f"{title} user",
        assistant_text=f"{title} assistant",
        ownership_scope=scope,
    ).conversation


def test_project_conversation_and_task_resources_are_account_isolated(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'ownership.db'}")
    Base.metadata.create_all(engine)

    user_a_id = uuid.uuid4()
    user_b_id = uuid.uuid4()
    scope_a = OwnershipScope(user_a_id)
    scope_b = OwnershipScope(user_b_id)

    with Session(engine) as db:
        db.add_all([_user(user_a_id, "a@example.test"), _user(user_b_id, "b@example.test")])
        db.flush()

        inbox_a = ensure_default_project(db, scope_a)
        inbox_b = ensure_default_project(db, scope_b)
        assert inbox_a.id != inbox_b.id
        assert inbox_a.owner_user_id == user_a_id
        assert inbox_b.owner_user_id == user_b_id

        # Names and ordering are private to an account, not globally unique.
        project_a = create_project(
            db,
            name="Research",
            description=None,
            color=None,
            icon=None,
            ownership_scope=scope_a,
        )
        project_b = create_project(
            db,
            name="Research",
            description=None,
            color=None,
            icon=None,
            ownership_scope=scope_b,
        )

        conversations_a = [_conversation(db, scope_a, f"A {index}") for index in range(2)]
        conversations_b = [_conversation(db, scope_b, f"B {index}") for index in range(2)]
        db.flush()

        assert {item.id for item in list_projects(db, ownership_scope=scope_a)} == {inbox_a.id, project_a.id}
        assert {item.id for item in list_projects(db, ownership_scope=scope_b)} == {inbox_b.id, project_b.id}
        assert get_owned(db, Project, project_b.id, scope_a) is None
        assert get_owned(db, Conversation, conversations_b[0].id, scope_a) is None

        assert {row.conversation_id for row in list_project_conversations(
            db,
            inbox_a.id,
            limit=50,
            offset=0,
            ownership_scope=scope_a,
        )} == {item.id for item in conversations_a}

        with pytest.raises(ProjectServiceError, match="Project not found"):
            move_conversation_to_project(
                db,
                conversation_id=conversations_a[0].id,
                project_id=project_b.id,
                ownership_scope=scope_a,
            )

        with pytest.raises(MessageEditError, match="not found"):
            queue_conversation_merge(
                db,
                conversation_ids=[conversations_a[0].id, conversations_b[0].id],
                title="Cross-account merge",
                project_id=None,
                idempotency_key="same-key",
                ownership_scope=scope_a,
            )

        job_a = queue_conversation_merge(
            db,
            conversation_ids=[item.id for item in conversations_a],
            title="A merge",
            project_id=None,
            idempotency_key="same-key",
            ownership_scope=scope_a,
        )
        job_b = queue_conversation_merge(
            db,
            conversation_ids=[item.id for item in conversations_b],
            title="B merge",
            project_id=None,
            idempotency_key="same-key",
            ownership_scope=scope_b,
        )
        assert job_a.id != job_b.id
        assert job_a.owner_user_id == user_a_id
        assert job_b.owner_user_id == user_b_id

        with pytest.raises(LookupError, match="not found"):
            delete_conversation_record(db, conversations_b[0].id, scope_a)
        assert db.get(Conversation, conversations_b[0].id) is not None


def test_direct_resource_owner_fields_and_legacy_window(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'owner-fields.db'}")
    Base.metadata.create_all(engine)
    user_id = uuid.uuid4()
    user_scope = OwnershipScope(user_id)
    owner_migration_scope = OwnershipScope(user_id, include_legacy_unowned=True)

    with Session(engine) as db:
        db.add(_user(user_id, "owner@example.test"))
        legacy_project = Project(name="Legacy", is_default=False)
        db.add(legacy_project)

        import_record = ImportRecord(source_profile="test", source_fingerprint="test")
        job = BackgroundJob(job_type="test")
        profile = ImportProfile(name="Learned", source_mode="JSON")
        for resource in (import_record, job, profile):
            assign_owner(resource, user_scope)
            db.add(resource)
        db.flush()

        assert import_record.owner_user_id == user_id
        assert job.owner_user_id == user_id
        assert profile.owner_user_id == user_id
        assert get_owned(db, Project, legacy_project.id, user_scope) is None
        assert get_owned(db, Project, legacy_project.id, owner_migration_scope) is legacy_project


def test_auth_disabled_compatibility_writes_to_the_migrated_administrator(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy-owner.db'}")
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        db.add(_user(LEGACY_OWNER_USER_ID, "legacy-owner@example.test"))
        project = ensure_default_project(db)
        db.flush()

        assert LEGACY_OWNERSHIP_SCOPE.include_legacy_unowned is True
        assert project.owner_user_id == LEGACY_OWNER_USER_ID
