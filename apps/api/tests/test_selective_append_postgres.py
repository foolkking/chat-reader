"""Synthetic append confirmations, legacy receipts and source locks on disposable PG."""
import hashlib
import hmac
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import sessionmaker

from app.core import auth_middleware
from app.core.config import get_settings
from app.core.database import get_db
from app.main import app
from app.models.conversation import Conversation
from app.models.import_record import ImportRecord
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.user import User
from app.services import selective_append as service
from app.services.auth import provision_owner
from app.services.editing.message_edit_service import edit_message
from test_auth import owner_login
from test_import_profile_postgres import isolated_schema  # noqa: F401
from test_selective_append import contents, endpoint, review, run, stage, target

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
                               reason="explicit disposable PostgreSQL required")


@pytest.fixture
def pg_client(isolated_schema, monkeypatch, tmp_path):
    engine, migrate = isolated_schema
    migrate("head")
    settings = {
        "APP_ENV": "test", "AUTH_ENABLED": "true", "AUTH_COOKIE_SECURE": "false",
        "AUTH_SESSION_SECRET": "synthetic-append-test-only-012345678901234567890",
        "PUBLIC_WEB_BASE_URL": "http://testserver", "IMPORT_COMMIT_INLINE": "false",
        "AUTH_ACTIVITY_TOUCH_INTERVAL_SECONDS": "600", "AUTH_INACTIVITY_TIMEOUT_SECONDS": "172800",
        "DATABASE_URL": engine.url.render_as_string(hide_password=False),
        "ATTACHMENT_SCANNER": "disabled",
    }
    for kind in ("IMPORT", "ASSET", "OFFLINE", "EXPORT"):
        settings[kind + "_STORAGE_DIR"] = str(tmp_path / kind)
    for name, value in settings.items():
        monkeypatch.setenv(name, value)
    get_settings.cache_clear()
    factory = sessionmaker(bind=engine, autoflush=False)
    monkeypatch.setattr(auth_middleware, "SessionLocal", factory)

    def database():
        with factory() as db:
            yield db

    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = database
    try:
        with factory() as db:
            owner = provision_owner(db, "correct horse battery staple", get_settings())
            db.get(User, owner.user_id).normalized_email = "admin@example.test"
            db.commit()
        with TestClient(app) as client:
            client.headers.update({"Origin": "http://testserver"})
            assert owner_login(client).status_code == 200
            yield client, factory
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)
        get_settings.cache_clear()


def editable_tail(client, cid, body="Synthetic original edited tail"):
    tail = contents(cid)[-1]
    result = client.patch(f"/api/messages/{tail.id}", json={
        "content_markdown": body, "base_version_id": str(tail.current_version_id),
    })
    assert result.status_code == 200
    return tail.id, uuid.UUID(result.json()["current_version_id"])


def replacement(body, version, previous):
    return {"content_markdown": body, "base_version_id": str(version), "save_mode": "replace_current",
            "base_content_hash": hashlib.sha256(previous.encode()).hexdigest()}


def selection(client, cid):
    iid, coordinates = stage(client, cid, [("user", "Synthetic selected question"),
                                         ("assistant", "Synthetic selected answer [report](assets/report.csv)")])
    return iid, {**coordinates, "indexes": [0, 1]}


@pytest.mark.parametrize("after", [
    "Synthetic original edited tail changed",
    "Synthetic original edited tail  \n",
])
def test_same_version_body_change_invalidates_review_and_keeps_selection(pg_client, after):
    client, factory = pg_client
    cid = target(client)
    before = "Synthetic original edited tail"
    mid, version = editable_tail(client, cid, before)
    iid, chosen = selection(client, cid)
    consent = review(client, iid, chosen)
    with factory() as db:
        old_hash = db.get(MessageVersion, version).content_hash
    edit = client.patch(f"/api/messages/{mid}", json=replacement(after, version, before))
    assert edit.status_code == 200 and edit.json()["current_version_id"] == str(version)
    with factory() as db:
        # Normalized hashes change for text, but intentionally ignore trailing spaces.
        assert (db.get(MessageVersion, version).content_hash == old_hash) == after.endswith("\n")
    stale = client.post(endpoint(iid, "confirm"), json={**chosen, "receipt": consent["receipt"]})
    assert stale.status_code == 409, "A same-version edit must not accept the old confirmation."
    detail = stale.json()["detail"]
    assert detail["code"] == "APPEND_REVIEW_CHANGED"
    assert detail["review"]["receipt"] != consent["receipt"]
    assert len(contents(cid)) == 2
    assert client.get(f"/api/append-imports/{iid}").json()["status"] == "previewed"
    # Coordinates remain valid: no reupload or changed selection is required.
    approved = {**chosen, "receipt": detail["review"]["receipt"]}
    assert client.post(endpoint(iid, "confirm"), json=approved).status_code == 202
    assert client.get(f"/api/append-imports/{iid}").json()["submitted_selection"] == chosen
    run(iid)
    assert len(contents(cid)) == 4
    assert client.post(endpoint(iid, "confirm"), json=approved).status_code == 200


def test_queued_same_version_edit_beyond_preview_rolls_back_then_reconfirms(pg_client):
    client, _factory = pg_client
    cid = target(client)
    before = "Synthetic prefix " * 100 + "original"
    after = "Synthetic prefix " * 100 + "changed"
    mid, version = editable_tail(client, cid, before)
    iid, chosen = selection(client, cid)
    consent = review(client, iid, chosen)
    approved = {**chosen, "receipt": consent["receipt"]}
    assert client.post(endpoint(iid, "confirm"), json=approved).status_code == 202
    assert client.patch(f"/api/messages/{mid}", json=replacement(after, version, before)).status_code == 200
    run(iid)
    failed = client.get(f"/api/append-imports/{iid}").json()
    assert (failed["status"], failed["state"], failed["phase"]) == ("failed", "FAILED", "failed")
    assert failed["submitted_selection"] == chosen and failed["pending_receipt"] == consent["receipt"]
    assert failed["result"] is None and len(contents(cid)) == 2
    latest = review(client, iid, chosen)
    assert latest["tail"] == consent["tail"], "The full body, not the 1024-character excerpt, binds consent."
    assert latest["receipt"] != consent["receipt"]
    assert client.post(endpoint(iid, "confirm"), json=approved).status_code == 409
    assert client.post(endpoint(iid, "confirm"), json={**chosen, "receipt": latest["receipt"]}).status_code == 202
    run(iid)
    assert len(contents(cid)) == 4
    assert client.get(f"/api/append-imports/{iid}").json()["submitted_selection"] is None


def legacy_review(db, record, cid, volume, indexes, *, lock=False):
    """Actual pre-tail/range-fix signature for a new no-share synthetic source."""
    info, conversation, source, fresh = service._current_review_for_test(db, record, cid, volume, indexes, lock=lock)
    last = db.execute(select(Message.id, Message.current_version_id, Message.order_key).where(
        Message.conversation_id == conversation.id, Message.is_deleted.is_(False)
    ).order_by(Message.order_key.desc()).limit(1)).first()
    revision = service.choices.digest([str(conversation.id), conversation.display_title or conversation.title,
                                      [str(value) for value in last] if last else None, []])
    rows = list(service.choices.selected(record, source, indexes))
    assert info["skip"] == info["changed"] == 0
    proof = service.choices.digest([str(record.owner_user_id), str(record.id), str(cid), volume, record.draft_sha256,
        source["generation"], [(row["index"], row["signature"]) for row in rows], [row["index"] for row in rows],
        0, info["missing"], revision, source["source_partial"]])
    receipt = hmac.new(get_settings().auth_secret_value().encode(), ("tail-v1:" + proof).encode(), hashlib.sha256).hexdigest()
    return {**info, "receipt": receipt}, conversation, source, fresh


@pytest.mark.parametrize("already_committed", [False, True])
def test_legacy_pending_receipt_fails_closed_but_completed_replay_still_works(pg_client, monkeypatch, already_committed):
    client, _factory = pg_client
    cid = target(client)
    iid, chosen = selection(client, cid)
    with monkeypatch.context() as old:
        old.setattr(service, "_current_review_for_test", service.review, raising=False)
        old.setattr(service, "review", legacy_review)
        previous = review(client, iid, chosen)
        approved = {**chosen, "receipt": previous["receipt"]}
        assert client.post(endpoint(iid, "confirm"), json=approved).status_code == 202
        if already_committed:
            run(iid)
    if already_committed:
        assert client.post(endpoint(iid, "confirm"), json=approved).status_code == 200
        assert len(contents(cid)) == 4
        return
    run(iid)
    failed = client.get(f"/api/append-imports/{iid}").json()
    assert failed["status"] == "failed" and failed["submitted_selection"] == chosen
    assert failed["error"] == "APPEND_REVIEW_CHANGED"
    assert failed["failure"] == {"code": "APPEND_REVIEW_CHANGED", "stage": "commit", "recovery": "review_in_reader"}
    assert len(contents(cid)) == 2
    latest = review(client, iid, chosen)
    assert latest["receipt"] != previous["receipt"]
    assert client.post(endpoint(iid, "confirm"), json={**chosen, "receipt": latest["receipt"]}).status_code == 202
    run(iid)
    assert len(contents(cid)) == 4


def blocks(factory, waiting_pid, blocker_pid, future):
    deadline = time.monotonic() + 5
    with factory() as observer:
        while time.monotonic() < deadline and not future.done():
            if blocker_pid in observer.scalar(text("SELECT pg_blocking_pids(:pid)"), {"pid": waiting_pid}):
                return True
            time.sleep(0.01)
    return False


def test_edit_first_confirm_waits_for_message_then_rejects_without_lock_inversion(pg_client, monkeypatch):
    client, factory = pg_client
    cid = target(client)
    before = "Synthetic original edited tail"
    mid, version = editable_tail(client, cid, before)
    iid, chosen = selection(client, cid)
    consent = review(client, iid, chosen)
    entered = Event()
    pids = {}
    original = service.target_for

    def observe(db, *args, **kwargs):
        if kwargs.get("lock"):
            pids["confirm"] = db.scalar(text("SELECT pg_backend_pid()"))
            entered.set()
        return original(db, *args, **kwargs)

    monkeypatch.setattr(service, "target_for", observe)
    with factory() as editor, ThreadPoolExecutor(max_workers=1) as pool:
        blocker = editor.scalar(text("SELECT pg_backend_pid()"))
        editor.execute(select(Message.id).where(Message.id == mid).with_for_update(of=Message, key_share=True)).one()
        future = pool.submit(client.post, endpoint(iid, "confirm"), json={**chosen, "receipt": consent["receipt"]})
        try:
            assert entered.wait(5)
            waited = blocks(factory, pids["confirm"], blocker, future)
            # Real edit takes the same Message -> Conversation write path before commit.
            edit_message(editor, mid, "Synthetic concurrent replacement", base_version_id=version,
                         base_content_hash=hashlib.sha256(before.encode()).hexdigest(),
                         save_mode="replace_current", rebuild_derived=False)
            editor.commit()
        finally:
            editor.rollback()
        result = future.result(timeout=10)
    assert waited, "Confirmation must serialize behind the real source-write lock."
    assert result.status_code == 409 and result.json()["detail"]["code"] == "APPEND_REVIEW_CHANGED"
    assert len(contents(cid)) == 2


def test_worker_first_blocks_same_tail_edit_until_atomic_append_commits(pg_client, monkeypatch):
    from app.services.canonical import stream_persistence
    client, factory = pg_client
    cid = target(client)
    before = "Synthetic original edited tail"
    mid, version = editable_tail(client, cid, before)
    iid, chosen = selection(client, cid)
    consent = review(client, iid, chosen)
    assert client.post(endpoint(iid, "confirm"), json={**chosen, "receipt": consent["receipt"]}).status_code == 202
    entered, release = Event(), Event()
    pids = {}
    original = stream_persistence._persist_one

    def paused(db, *args, **kwargs):
        if not entered.is_set():
            pids["worker"] = db.scalar(text("SELECT pg_backend_pid()"))
            entered.set()
            assert release.wait(10)
        return original(db, *args, **kwargs)

    monkeypatch.setattr(stream_persistence, "_persist_one", paused)

    def edit():
        with factory() as db:
            pids["editor"] = db.scalar(text("SELECT pg_backend_pid()"))
            edit_message(db, mid, "Synthetic edit after append", base_version_id=version,
                         base_content_hash=hashlib.sha256(before.encode()).hexdigest(),
                         save_mode="replace_current", rebuild_derived=False)
            db.commit()

    with ThreadPoolExecutor(max_workers=2) as pool:
        worker = pool.submit(run, iid)
        try:
            assert entered.wait(10)
            editor = pool.submit(edit)
            deadline = time.monotonic() + 5
            while "editor" not in pids and time.monotonic() < deadline:
                time.sleep(0.01)
            waited = blocks(factory, pids["editor"], pids["worker"], editor)
        finally:
            release.set()
        worker.result(timeout=15)
        editor.result(timeout=15)
    assert waited
    assert client.get(f"/api/append-imports/{iid}").json()["status"] == "committed"
    assert len(contents(cid)) == 4
    with factory() as db:
        assert db.get(MessageVersion, version).display_text == "Synthetic edit after append"
        assert db.get(Conversation, uuid.UUID(cid)).message_count == 4
        assert db.get(ImportRecord, uuid.UUID(iid)).analysis_summary["append_result"]["added"] == 2


def test_confirm_waiting_on_previous_tail_gets_fresh_409_after_worker_installs_new_tail(pg_client, monkeypatch):
    from app.services.canonical import stream_persistence
    client, factory = pg_client
    cid = target(client)
    iid, chosen = selection(client, cid)
    waiting_id, waiting_selection = selection(client, cid)
    accepted = review(client, iid, chosen)
    waiting_review = review(client, waiting_id, waiting_selection)
    assert client.post(endpoint(iid, "confirm"), json={**chosen, "receipt": accepted["receipt"]}).status_code == 202
    entered, confirming, release = Event(), Event(), Event()
    pids = {}
    real_write, real_target = stream_persistence._persist_one, service.target_for

    def paused(db, *args, **kwargs):
        if not entered.is_set():
            pids["worker"] = db.scalar(text("SELECT pg_backend_pid()"))
            entered.set()
            assert release.wait(10)
        return real_write(db, *args, **kwargs)

    def observe(db, record, *args, **kwargs):
        if str(record.id) == waiting_id and kwargs.get("lock"):
            pids["confirm"] = db.scalar(text("SELECT pg_backend_pid()"))
            confirming.set()
        return real_target(db, record, *args, **kwargs)

    monkeypatch.setattr(stream_persistence, "_persist_one", paused)
    monkeypatch.setattr(service, "target_for", observe)
    with ThreadPoolExecutor(max_workers=2) as pool:
        worker = pool.submit(run, iid)
        try:
            assert entered.wait(10)
            confirm = pool.submit(client.post, endpoint(waiting_id, "confirm"),
                                  json={**waiting_selection, "receipt": waiting_review["receipt"]})
            assert confirming.wait(5)
            waited = blocks(factory, pids["confirm"], pids["worker"], confirm)
        finally:
            release.set()
        worker.result(timeout=15)
        result = confirm.result(timeout=15)
    assert waited and result.status_code == 409
    current = result.json()["detail"]
    assert current["code"] == "APPEND_REVIEW_CHANGED"
    assert current["review"]["receipt"] != waiting_review["receipt"]
    assert (current["review"]["add"], current["review"]["skip"]) == (0, 2)
    assert len(contents(cid)) == 4
    assert client.get(f"/api/append-imports/{waiting_id}").json()["status"] == "previewed"
