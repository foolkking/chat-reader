"""Synthetic private requests, real persisted approvals and upload enforcement."""
import json
import smtplib
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core import auth_middleware
from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.support_request import SupportMessage, SupportRequest, UserLimitOverride
from app.models.user import User
from app.models.import_record import utc_now
from app.services.auth import issue_session, register_user
from app.services.background_jobs import claim_next_job, process_background_job, recover_stale_jobs
from test_auth import auth_client, owner_login  # noqa: F401


def user(client):
    with auth_middleware.SessionLocal() as db:
        row, principal = register_user(db, f"support-{uuid.uuid4()}@example.test", "synthetic support passphrase")
        token, _ = issue_session(db, principal, get_settings())
        identity = row.id
    sign_in(client, token)
    return identity, token


def sign_in(client, token):
    client.cookies.clear()
    client.cookies.set("chat_reader_session", token)
    client.cookies.set("chat_reader_session_present", "1")


def create(client, *, key="create", **changes):
    body = {"kind": "ISSUE", "title": "Synthetic issue", "body": "Synthetic private support body", **changes}
    return client.post("/api/me/requests", headers={"Idempotency-Key": key}, json=body)


def decision(client, row, *, key="decision", action="APPROVE", limits=None, **changes):
    return client.post(f"/api/admin/requests/{row['id']}/decision", headers={"Idempotency-Key": key},
        json={"action": action, "base_revision": row["revision"], "body": "Synthetic decision",
              "limits": limits or {}, **changes})


def test_private_create_retries_roles_and_state_conflicts(auth_client):
    first, token = user(auth_client)
    response = create(auth_client)
    assert response.status_code == 201, response.text
    row = response.json()
    assert row["status"] == "OPEN" and row["messages"][0]["body"] == "Synthetic private support body"
    assert create(auth_client).json()["id"] == row["id"]
    assert create(auth_client, body="different").status_code == 409
    with auth_middleware.SessionLocal() as db:
        assert db.query(SupportRequest).count() == db.query(SupportMessage).count() == 1
    _, other = user(auth_client)
    assert auth_client.get(f"/api/me/requests/{row['id']}").status_code == 404
    assert auth_client.get("/api/me/requests").json()["total"] == 0
    assert auth_client.get("/api/admin/requests").status_code == 404
    # Mutable role is insufficient to become the deployment root.
    with auth_middleware.SessionLocal() as db:
        db.get(User, first).role = "ADMIN"
        db.commit()
    sign_in(auth_client, token)
    assert auth_client.get("/api/admin/requests").status_code == 404
    with auth_middleware.SessionLocal() as db:
        db.get(User, first).role = "USER"
        db.commit()
    assert owner_login(auth_client).status_code == 200
    assert create(auth_client).status_code == 403
    reply = auth_client.post(f"/api/admin/requests/{row['id']}/messages", headers={"Idempotency-Key": "reply"},
        json={"base_revision": 1, "body": "Please give reproduction steps"})
    assert reply.status_code == 200, reply.text
    assert reply.json()["status"] == "WAITING" and reply.json()["revision"] == 2
    assert decision(auth_client, row, action="RESOLVE").status_code == 409
    sign_in(auth_client, token)
    assert auth_client.post(f"/api/me/requests/{row['id']}/decision", headers={"Idempotency-Key": "bad"},
        json={"base_revision": 2, "action": "APPROVE", "body": "not allowed"}).status_code == 403
    result = auth_client.post(f"/api/me/requests/{row['id']}/decision", headers={"Idempotency-Key": "withdraw"},
        json={"base_revision": 2, "action": "WITHDRAW", "body": "No longer needed"})
    assert result.json()["status"] == "WITHDRAWN"
    assert len(auth_client.get(f"/api/me/requests/{row['id']}?offset=1&limit=1").json()["messages"]) == 1


def test_approved_limits_enforce_real_upload_and_revoke(auth_client):
    assert owner_login(auth_client).status_code == 200
    assert auth_client.put("/api/admin/features", json={"maximum_import_size_mb": 1, "maximum_merge_message_count": 2}).status_code == 200
    identity, token = user(auth_client)
    source = json.dumps({"metadata": {"powered_by": "ChatGPT Exporter"},
        "messages": [{"role": "Prompt", "say": "x" * (1024 * 1024 + 1)}]}).encode()
    upload = lambda: auth_client.post("/api/imports/preview", files={"files": ("synthetic.json", source, "application/json")})
    assert upload().status_code == 413
    row = create(auth_client, kind="LIMIT", limits={"import_size_mb": 2, "merge_message_count": 4}).json()
    assert create(auth_client, key="duplicate-active", kind="LIMIT", limits={"import_size_mb": 3}).status_code == 409
    assert owner_login(auth_client).status_code == 200
    approved = decision(auth_client, row, limits={"import_size_mb": 2, "merge_message_count": 4})
    assert approved.status_code == 200, approved.text
    assert approved.json()["limits"]["effective"] == {"import_size_mb": 2, "merge_message_count": 4}
    assert decision(auth_client, row, limits={"import_size_mb": 2, "merge_message_count": 4}).status_code == 200
    with auth_middleware.SessionLocal() as db:
        assert db.get(UserLimitOverride, identity).revision == 1
        assert db.query(SupportMessage).count() == 2
    sign_in(auth_client, token)
    assert auth_client.get("/api/auth/capabilities").json()["maximum_import_size_mb"] == 2
    assert upload().status_code == 200
    _, second = user(auth_client)
    assert auth_client.get("/api/auth/capabilities").json()["maximum_import_size_mb"] == 1
    assert upload().status_code == 413
    assert owner_login(auth_client).status_code == 200
    revoked = auth_client.put(f"/api/admin/users/{identity}/limit-overrides", headers={"Idempotency-Key": "revoke"},
        json={"base_revision": 1, "limits": {}, "reason": "Synthetic explicit reset"})
    assert revoked.status_code == 200, revoked.text
    assert revoked.json()["effective"]["import_size_mb"] == 1
    sign_in(auth_client, token)
    assert upload().status_code == 413


def test_hard_bounds_feature_gate_and_mail_unavailable(auth_client, monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "")
    monkeypatch.setenv("IMPORT_GATEWAY_FILE_LIMIT_MB", "3")
    get_settings.cache_clear()
    assert owner_login(auth_client).status_code == 200
    assert auth_client.put("/api/admin/features", json={"maximum_import_size_mb": 1}).status_code == 200
    identity, token = user(auth_client)
    assert create(auth_client, kind="LIMIT", limits={"import_size_mb": 4}).status_code == 422
    result = create(auth_client, kind="LIMIT", limits={"import_size_mb": 3}, notify_admin=True)
    assert result.status_code == 201, result.text
    row = result.json()
    assert row["messages"][0]["mail_state"] == "UNAVAILABLE"
    assert row["limits"]["hard_bounds"]["import_size_mb"] == 3
    assert owner_login(auth_client).status_code == 200
    assert decision(auth_client, row, limits={"import_size_mb": 4}).status_code == 422
    assert decision(auth_client, row, limits={"import_size_mb": 3}).status_code == 200
    assert auth_client.put("/api/admin/features", json={"allow_user_import": False}).status_code == 200
    sign_in(auth_client, token)
    assert auth_client.post("/api/imports/preview", files={"files": ("synthetic.json", b"{}", "application/json")}).status_code == 403


@pytest.mark.parametrize("outcome,state", [(None, "ACCEPTED"), (smtplib.SMTPDataError(451, b"synthetic rejection"), "FAILED"), (TimeoutError(), "UNKNOWN")])
def test_mail_worker_has_separate_persisted_state(auth_client, monkeypatch, outcome, state):
    from app.services import support_notifications
    monkeypatch.setenv("SMTP_HOST", "smtp.example.test")
    monkeypatch.setenv("SMTP_FROM_ADDRESS", "notifications@example.test")
    get_settings.cache_clear()
    received = []
    def deliver(settings, mail):
        received.append(mail)
        if outcome:
            raise outcome
    monkeypatch.setattr(support_notifications, "_deliver", deliver)
    identity, _ = user(auth_client)
    created = create(auth_client, notify_admin=True).json()
    assert created["messages"][0]["mail_state"] == "QUEUED"
    assert auth_client.get("/api/tasks/active").json() == []
    with auth_middleware.SessionLocal() as db:
        job_id = claim_next_job(db, job_type="support_notification")
        db.commit()
    process_background_job(job_id, auth_middleware.SessionLocal)
    with auth_middleware.SessionLocal() as db:
        assert db.get(SupportRequest, uuid.UUID(created["id"])).status == "OPEN"
        message = db.query(SupportMessage).one()
        assert message.mail_state == state and message.notification_attempts == 1
        job = db.get(BackgroundJob, job_id)
        assert job.result["mail_state"] == state and job.status == "committed"
    assert len(received) == 1
    assert received[0]["To"] == "admin@example.test"
    assert "Synthetic private support body" not in received[0].as_string()
    assert "Synthetic issue" not in received[0].as_string()
    # Re-entering a completed job does not repeat external delivery.
    process_background_job(job_id, auth_middleware.SessionLocal)
    assert len(received) == 1


def test_worker_crash_after_send_marker_is_not_replayed(auth_client, monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.example.test")
    monkeypatch.setenv("SMTP_FROM_ADDRESS", "notifications@example.test")
    get_settings.cache_clear()
    user(auth_client)
    created = create(auth_client, notify_admin=True).json()
    with auth_middleware.SessionLocal() as db:
        job = db.query(BackgroundJob).one()
        job.status = "processing"
        job.heartbeat_at = utc_now() - timedelta(hours=1)
        db.query(SupportMessage).one().mail_state = "SENDING"
        db.commit()
        assert recover_stale_jobs(db, 60) == 1
        db.commit()
        assert db.query(SupportMessage).one().mail_state == "UNKNOWN"
        assert db.query(BackgroundJob).one().status == "failed"
        assert claim_next_job(db, job_type="support_notification") is None
    retry = auth_client.post(f"/api/me/requests/{created['id']}/messages/{created['messages'][0]['id']}/retry-mail",
                            headers={"Idempotency-Key": "retry"})
    assert retry.status_code == 409


def test_mail_failure_can_retry_idempotently_with_three_attempt_ceiling(auth_client, monkeypatch):
    from app.services import support_notifications
    monkeypatch.setenv("SMTP_HOST", "smtp.example.test")
    monkeypatch.setenv("SMTP_FROM_ADDRESS", "notifications@example.test")
    get_settings.cache_clear()
    def rejected(*_):
        raise smtplib.SMTPDataError(451, b"synthetic rejection")
    monkeypatch.setattr(support_notifications, "_deliver", rejected)
    user(auth_client)
    created = create(auth_client, notify_admin=True).json()
    path = f"/api/me/requests/{created['id']}/messages/{created['messages'][0]['id']}/retry-mail"
    for attempt in range(3):
        if attempt:
            response = auth_client.post(path, headers={"Idempotency-Key": f"retry-{attempt}"})
            assert response.status_code == 200, response.text
            assert auth_client.post(path, headers={"Idempotency-Key": f"retry-{attempt}"}).status_code == 200
        with auth_middleware.SessionLocal() as db:
            job = claim_next_job(db, job_type="support_notification")
            db.commit()
        assert job
        process_background_job(job, auth_middleware.SessionLocal)
    assert auth_client.post(path, headers={"Idempotency-Key": "fourth"}).status_code == 429
    with auth_middleware.SessionLocal() as db:
        assert db.query(SupportMessage).one().notification_attempts == 3
        assert db.query(BackgroundJob).count() == 3
        assert db.query(SupportRequest).one().status == "OPEN"


def test_opt_in_notifications_use_real_local_smtp_without_private_body(auth_client, monkeypatch):
    import socketserver
    from email import policy
    from email.parser import BytesParser
    from threading import Thread
    received = []
    class Handler(socketserver.StreamRequestHandler):
        def handle(self):
            self.connection.settimeout(5)
            self.wfile.write(b"220 synthetic SMTP\r\n")
            while line := self.rfile.readline(8192):
                command = line.upper().split(b" ")[0].strip()
                if command == b"DATA":
                    self.wfile.write(b"354 send\r\n")
                    content = bytearray()
                    while part := self.rfile.readline(8192):
                        if part == b".\r\n":
                            break
                        content.extend(part[1:] if part.startswith(b"..") else part)
                        assert len(content) < 65536
                    received.append(BytesParser(policy=policy.default).parsebytes(bytes(content)))
                    self.wfile.write(b"250 accepted\r\n")
                elif command == b"QUIT":
                    self.wfile.write(b"221 bye\r\n")
                    break
                else:
                    self.wfile.write(b"250 local\r\n")
    with socketserver.ThreadingTCPServer(("127.0.0.1", 0), Handler) as server:
        runner = Thread(target=server.serve_forever, daemon=True)
        runner.start()
        try:
            for key, value in {"SMTP_HOST": "127.0.0.1", "SMTP_PORT": str(server.server_address[1]),
                               "SMTP_STARTTLS": "false", "SMTP_USERNAME": "", "SMTP_FROM_ADDRESS": "notice@example.test"}.items():
                monkeypatch.setenv(key, value)
            get_settings.cache_clear()
            identity, token = user(auth_client)
            created = create(auth_client, notify_admin=True, notify_replies=True).json()
            with auth_middleware.SessionLocal() as db:
                job = claim_next_job(db, job_type="support_notification"); db.commit()
            process_background_job(job, auth_middleware.SessionLocal)
            assert owner_login(auth_client).status_code == 200
            reply = auth_client.post(f"/api/admin/requests/{created['id']}/messages", headers={"Idempotency-Key": "mail-reply"},
                json={"base_revision": 1, "body": "Synthetic private administrator reply", "notify": True})
            assert reply.status_code == 200, reply.text
            with auth_middleware.SessionLocal() as db:
                job = claim_next_job(db, job_type="support_notification"); db.commit()
                email = db.get(User, identity).normalized_email
            process_background_job(job, auth_middleware.SessionLocal)
            assert [mail["To"] for mail in received] == ["admin@example.test", email]
            assert all("Synthetic private" not in mail.get_content() for mail in received)
            assert all(f"/#support-request={created['id']}" in mail.get_content() for mail in received)
            sign_in(auth_client, token)
            readback = auth_client.get(f"/api/me/requests/{created['id']}").json()
            assert [m["mail_state"] for m in readback["messages"]] == ["ACCEPTED", "ACCEPTED"]
        finally:
            server.shutdown()
            runner.join(timeout=5)


def test_approval_rollback_and_audit_do_not_store_private_text(auth_client, monkeypatch):
    from app.services import support_requests
    from app.models.administration import AdminAuditLog
    assert owner_login(auth_client).status_code == 200
    assert auth_client.put("/api/admin/features", json={"maximum_import_size_mb": 1}).status_code == 200
    identity, _ = user(auth_client)
    created = create(auth_client, kind="LIMIT", limits={"import_size_mb": 2}).json()
    assert owner_login(auth_client).status_code == 200
    original = support_requests._message
    def interrupted(*args, **kwargs):
        raise RuntimeError("Synthetic database publication interruption")
    monkeypatch.setattr(support_requests, "_message", interrupted)
    assert decision(auth_client, created, limits={"import_size_mb": 2}).status_code == 500
    with auth_middleware.SessionLocal() as db:
        assert db.get(UserLimitOverride, identity) is None
        assert db.get(SupportRequest, uuid.UUID(created["id"])).status == "OPEN"
        assert db.query(SupportMessage).count() == 1
    monkeypatch.setattr(support_requests, "_message", original)
    assert decision(auth_client, created, limits={"import_size_mb": 2}).status_code == 200
    with auth_middleware.SessionLocal() as db:
        for row in db.query(AdminAuditLog).all():
            assert "Synthetic" not in json.dumps(row.event_metadata)


def test_personal_merge_limit_is_locked_when_accepted(auth_client):
    from app.models.conversation import Conversation
    assert owner_login(auth_client).status_code == 200
    assert auth_client.put("/api/admin/features", json={"maximum_merge_message_count": 2}).status_code == 200
    identity, token = user(auth_client)
    ids = []
    for i in range(2):
        response = auth_client.post("/api/conversations", json={"title": f"Synthetic merge {i}", "messages": [
            {"role": "user", "content_markdown": "Synthetic question"},
            {"role": "assistant", "content_markdown": "Synthetic answer"}]})
        assert response.status_code == 201, response.text
        ids.append(response.json()["conversation"]["id"])
    request_body = {"conversation_ids": ids, "title": "Synthetic accepted merge"}
    assert auth_client.post("/api/conversations/merge", json=request_body).status_code == 422
    row = create(auth_client, kind="LIMIT", limits={"merge_message_count": 4}).json()
    assert owner_login(auth_client).status_code == 200
    assert decision(auth_client, row, limits={"merge_message_count": 4}).status_code == 200
    sign_in(auth_client, token)
    accepted = auth_client.post("/api/conversations/merge", json=request_body)
    assert accepted.status_code == 202, accepted.text
    job_id = uuid.UUID(accepted.json()["job_id"])
    with auth_middleware.SessionLocal() as db:
        assert db.get(BackgroundJob, job_id).payload["accepted_message_limit"] == 4
        # Explicit future revocation does not retroactively change an admitted job.
        db.get(UserLimitOverride, identity).merge_message_count = None
        db.commit()
        assert claim_next_job(db, job_type="conversation_merge") == job_id
        db.commit()
    process_background_job(job_id, auth_middleware.SessionLocal)
    with auth_middleware.SessionLocal() as db:
        result = db.get(BackgroundJob, job_id)
        assert result.status == "committed", result.error_message
        assert result.result["message_count"] == 4
        assert db.get(Conversation, uuid.UUID(result.result["conversation_id"])).owner_user_id == identity


@pytest.mark.parametrize("endpoint", ["/api/imports/preview", "/api/adaptive-import/sessions"])
def test_combined_import_budget_rejects_before_publishing(auth_client, monkeypatch, endpoint):
    from app.models.import_record import ImportRecord
    monkeypatch.setenv("IMPORT_GATEWAY_FILE_LIMIT_MB", "1")
    get_settings.cache_clear()
    user(auth_client)
    caps = auth_client.get("/api/auth/capabilities").json()
    assert caps["maximum_import_total_mb"] == caps["limit_hard_bounds"]["import_size_mb"] == 1
    content = json.dumps({"metadata": {"powered_by": "ChatGPT Exporter"},
        "messages": [{"role": "Prompt", "say": "x" * (600 * 1024)}]}).encode()
    response = auth_client.post(endpoint, files=[("files", ("synthetic-a.json", content, "application/json")),
                                                ("files", ("synthetic-b.json", content, "application/json"))])
    assert response.status_code == 413, response.text
    assert response.json()["detail"]["code"] == "IMPORT_TOTAL_SIZE_LIMIT"
    with auth_middleware.SessionLocal() as db:
        assert db.query(ImportRecord).count() == 0
