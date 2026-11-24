"""Two transactions from one synthetic owner. Never run against an existing Reader."""
import json
import os
import queue
import secrets
import threading
import time
import uuid

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.core.database import SessionLocal
from app.models import _register_all_models
from app.models.conversation import Conversation
from app.models.message import Message
from app.services.auth import register_user
from app.services.editing.message_edit_service import MessageEditError, create_manual_conversation, insert_manual_messages
from app.services.ownership import OwnershipScope


def check():
    assert os.environ["APP_ENV"] == "test" and os.environ["IMPORT_STORAGE_DIR"] == "/data/imports"
    assert os.environ["PUBLIC_WEB_BASE_URL"] == os.environ["SYNTHETIC_ORIGIN"] == "http://127.0.0.1:18483"
    _register_all_models()
    with SessionLocal() as session:
        bind = session.get_bind()
        assert bind.url.database == "extension_beta" and bind.dialect.name == "postgresql"
        owner, _ = register_user(session, f"tail-check-{uuid.uuid4().hex}@example.test", secrets.token_urlsafe(32))
        result = create_manual_conversation(session, title="Two-device write test", user_text="Opening",
            assistant_text="Initial end", ownership_scope=OwnershipScope(owner.id))
        session.commit()
        cid, anchor, revision = result.conversation.id, result.messages[-1].id, result.conversation.offline_revision

    def change(db, body):
        return insert_manual_messages(db, conversation_id=cid, anchor_message_id=anchor, position="after",
            mode="single", messages=[("user", body)], expected_offline_revision=revision)

    ready, outcome = queue.Queue(), queue.Queue()

    def second():
        try:
            with SessionLocal() as db:
                db.execute(text("set local statement_timeout='12s'"))
                cached = db.get(Conversation, cid)
                assert cached.offline_revision == revision
                ready.put(db.scalar(text("select pg_backend_pid()")))
                change(db, "Second device saw old revision")
                db.commit()
                outcome.put("committed")
        except MessageEditError as e:
            outcome.put("conflict_409" if e.status_code == 409 else "different_domain_error")
        except IntegrityError:
            outcome.put("database_constraint_error")
        except Exception as e:
            outcome.put(type(e).__name__)  # No SQL, IDs or private connection details in evidence.

    with SessionLocal() as first, SessionLocal() as observer:
        first.execute(text("set local statement_timeout='12s'"))
        first.scalar(select(Conversation).where(Conversation.id == cid).with_for_update())
        holder = first.scalar(text("select pg_backend_pid()"))
        change(first, "Committed from the first device")
        first.flush()
        thread = threading.Thread(target=second, daemon=True)
        thread.start()
        waiter = ready.get(timeout=5)
        deadline = time.monotonic() + 5
        while holder not in observer.scalar(text("select pg_blocking_pids(:pid)"), {"pid": waiter}):
            assert time.monotonic() < deadline, "A real row/transaction lock wait was not observed"
            time.sleep(0.025)
        first.commit()
        thread.join(12)
        assert not thread.is_alive()
        rows = observer.scalars(select(Message).where(Message.conversation_id == cid, Message.is_deleted.is_(False))).all()
        state = {"real_lock_wait": True, "second_writer": outcome.get_nowait(), "stored_rows": len(rows),
                 "revision_advanced": observer.get(Conversation, cid).offline_revision > revision}
        print(json.dumps(state), flush=True)
        assert state["second_writer"] == "conflict_409" and len(rows) == 3 and state["revision_advanced"]


if __name__ == "__main__":
    check()
