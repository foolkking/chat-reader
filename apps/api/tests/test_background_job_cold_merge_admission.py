"""Merge admission resolves its policy without another test warming an export."""
import pytest

from test_worker_optional_dependency_imports import _fresh


@pytest.mark.parametrize(("mode", "accepted", "limit"), [
    ("default", True, 1000),
    ("instance", False, 3),
    ("owner_override", True, 5),
    ("other_owner_override", False, 3),
])
def test_first_cold_merge_uses_the_real_owned_policy(mode, accepted, limit, tmp_path):
    result = _fresh(tmp_path, """
        import uuid
        from sqlalchemy import create_engine, event
        from sqlalchemy.orm import Session
        from app.core.database import Base
        from app.models.administration import InstanceFeaturePolicy
        from app.models.background_job import BackgroundJob
        from app.models.conversation import Conversation
        from app.models.message import Message
        from app.models.support_request import UserLimitOverride
        from app.models.user import User
        from app.services import background_jobs as jobs
        from app.services.editing.errors import MessageEditError
        from app.services.ownership import OwnershipScope

        assert "app.services.feature_policies" not in sys.modules
        assert "effective_limits" not in jobs.__dict__
        mode = sys.argv[3]
        accepted = mode in ("default", "owner_override")
        expected_limit = 1000 if mode == "default" else 5 if mode == "owner_override" else 3
        engine = create_engine("sqlite:///:memory:")
        @event.listens_for(engine, "connect")
        def enable_foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
        try:
            Base.metadata.create_all(engine)
            with Session(engine) as db:
                owner, other_owner = uuid.uuid4(), uuid.uuid4()
                db.add_all([User(id=owner), User(id=other_owner)])
                db.flush()
                if mode != "default":
                    db.add(InstanceFeaturePolicy(id=1, maximum_merge_message_count=3))
                if mode in ("owner_override", "other_owner_override"):
                    db.add(UserLimitOverride(
                        user_id=owner if mode == "owner_override" else other_owner,
                        merge_message_count=5,
                    ))
                ids = []
                for index in range(2):
                    conversation = Conversation(
                        owner_user_id=owner, title=f"Synthetic cold source {index}",
                        display_title=f"Synthetic cold source {index}",
                        source_type="manual", source_profile="manual",
                        parser_version="synthetic-cold-merge", message_count=2,
                    )
                    db.add(conversation)
                    db.flush()
                    ids.append(conversation.id)
                    db.add_all([
                        Message(conversation_id=conversation.id, role=role, order_key=str(sequence))
                        for sequence, role in enumerate(("user", "assistant"), start=1)
                    ])
                db.add(Message(conversation_id=ids[0], role="user", order_key="3", is_deleted=True))
                db.commit()
                assert "app.services.feature_policies" not in sys.modules
                try:
                    job = jobs.queue_conversation_merge(
                        db, conversation_ids=ids, title="Synthetic cold merge",
                        project_id=None, idempotency_key=str(uuid.uuid4()),
                        ownership_scope=OwnershipScope(owner),
                    )
                except MessageEditError as error:
                    assert not accepted
                    assert type(error) is MessageEditError
                    assert error.status_code == 422
                    assert error.code == "MERGE_MESSAGE_LIMIT"
                    assert "administrator limit is 3" in str(error)
                    assert db.query(BackgroundJob).count() == 0
                else:
                    assert accepted
                    assert job.owner_user_id == owner
                    assert job.status == "queued"
                    assert job.total_items == 4
                    assert job.payload["accepted_message_limit"] == expected_limit
                    assert db.query(BackgroundJob).count() == 1
                assert "app.services.feature_policies" in sys.modules
                assert "effective_limits" not in jobs.__dict__
                # Explicit compatibility access must still return the actual object,
                # but happens only after the unprimed business call.
                assert jobs.effective_limits is sys.modules["app.services.feature_policies"].effective_limits
                print(json.dumps({"accepted": accepted, "limit": expected_limit, "cold_policy_resolved": True}))
        finally:
            engine.dispose()
    """, mode)
    assert result == {"accepted": accepted, "limit": limit, "cold_policy_resolved": True}


@pytest.mark.parametrize("changed_payload", [False, True])
def test_cold_receipt_replay_precedes_policy_and_source_loading(changed_payload, tmp_path):
    result = _fresh(tmp_path, """
        import uuid
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session
        from app.core.database import Base
        from app.models.administration import InstanceFeaturePolicy
        from app.models.background_job import BackgroundJob
        from app.models.user import User
        from app.services import background_jobs as jobs
        from app.services.editing.errors import MessageEditError
        from app.services.ownership import OwnershipScope

        assert "app.services.feature_policies" not in sys.modules
        assert "effective_limits" not in jobs.__dict__
        changed = sys.argv[3] == "True"
        engine = create_engine("sqlite:///:memory:")
        try:
            Base.metadata.create_all(engine)
            with Session(engine) as db:
                owner, ids, key = uuid.uuid4(), [uuid.uuid4(), uuid.uuid4()], str(uuid.uuid4())
                db.add(User(id=owner))
                db.flush()
                original = BackgroundJob(
                    owner_user_id=owner, job_type="conversation_merge", status="failed",
                    phase="failed", total_items=4, idempotency_key=key,
                    payload={"conversation_ids": [str(item) for item in ids],
                             "title": "Synthetic retained cold merge", "project_id": None,
                             "accepted_message_limit": 7},
                )
                db.add(original)
                db.commit()
                try:
                    replay = jobs.queue_conversation_merge(
                        db, conversation_ids=ids,
                        title="Synthetic changed title" if changed else "Synthetic retained cold merge",
                        project_id=None, idempotency_key=key, ownership_scope=OwnershipScope(owner),
                    )
                except MessageEditError as error:
                    assert changed
                    assert error.status_code == 409
                    assert error.code == "MERGE_REQUEST_CONFLICT"
                else:
                    assert not changed
                    assert replay is original
                    assert replay.status == "failed"
                    assert replay.payload["accepted_message_limit"] == 7
                assert db.query(BackgroundJob).count() == 1
                assert db.query(InstanceFeaturePolicy).count() == 0
                assert "app.services.feature_policies" not in sys.modules
                assert "effective_limits" not in jobs.__dict__
                print(json.dumps({"conflict": changed, "unselected_policy_loaded": False}))
        finally:
            engine.dispose()
    """, str(changed_payload))
    assert result == {"conflict": changed_payload, "unselected_policy_loaded": False}


@pytest.mark.parametrize("role", ["app.workers.import_worker", "app.workers.execution_child"])
def test_passive_standard_worker_merge_service_does_not_load_policy(role, tmp_path):
    result = _fresh(tmp_path, """
        from importlib.machinery import ModuleSpec
        sys.modules["__main__"].__spec__ = ModuleSpec(sys.argv[3], None)
        blocked += ("app.services.feature_policies",)
        import sqlalchemy
        sqlalchemy.engine.Engine.connect = forbidden
        from app.services import background_jobs as jobs
        assert callable(jobs.queue_conversation_merge)
        assert "app.services.feature_policies" not in sys.modules
        assert "effective_limits" not in jobs.__dict__
        print(json.dumps({"passive_policy_loaded": False, "role": sys.argv[3]}))
    """, role)
    assert result == {"passive_policy_loaded": False, "role": role}
