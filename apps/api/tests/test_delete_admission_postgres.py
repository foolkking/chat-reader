"""Uses only the existing disposable PostgreSQL harness; never production."""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy.orm import Session

from app.models.background_job import BackgroundJob
from app.models.user import User
from app.services.background_jobs import queue_conversation_batch_delete
from app.services.editing.message_edit_service import MessageEditError, create_manual_conversation
from app.services.ownership import OwnershipScope
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")


@pytest.mark.parametrize("changed_payload", [False, True])
def test_concurrent_delete_admission_is_serial_and_order_bound(isolated_schema, changed_payload):
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as db:
        user = User(normalized_email="synthetic-delete-admission@example.test")
        db.add(user)
        db.flush()
        owner, ids = user.id, []
        for title in ("Synthetic first", "Synthetic second"):
            created = create_manual_conversation(
                db, title=title, user_text="Synthetic question", assistant_text="Synthetic answer",
                ownership_scope=OwnershipScope(owner),
            )
            ids.append(created.conversation.id)
        db.commit()
    key, barrier = str(uuid.uuid4()), Barrier(2)

    def admit(index):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            try:
                job = queue_conversation_batch_delete(
                    db, conversation_ids=list(reversed(ids)) if changed_payload and index else ids,
                    idempotency_key=key, ownership_scope=OwnershipScope(owner),
                )
                db.commit()
                return "accepted", job.id
            except MessageEditError as error:
                db.rollback()
                return error.code, None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(admit, range(2)))
    if changed_payload:
        assert sorted(result[0] for result in results) == ["DELETE_REQUEST_CONFLICT", "accepted"]
    else:
        assert results[0] == results[1]
    with Session(engine) as db:
        assert db.query(BackgroundJob).filter_by(owner_user_id=owner, job_type="conversation_batch_delete", idempotency_key=key).count() == 1
