"""Bounded, opt-in email delivery; never retry an ambiguous SMTP acceptance."""
from email.message import EmailMessage
import smtplib
import uuid

from sqlalchemy import select

from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.import_record import utc_now
from app.models.support_request import SupportMessage, SupportRequest
from app.models.user import User
from app.services.auth import ROOT_ADMIN_USER_ID, normalize_email
from app.services.password_mail import _deliver


def recover_notification(db, job):
    message = db.scalar(select(SupportMessage).where(SupportMessage.notification_job_id == job.id))
    if message and message.mail_state == "SENDING":
        message.mail_state = "UNKNOWN"
    elif message and message.mail_state == "QUEUED":
        message.mail_state = "FAILED"
    state = message.mail_state if message else "UNAVAILABLE"
    job.status = "committed" if state == "ACCEPTED" else "failed"
    job.phase = "completed" if state == "ACCEPTED" else "failed"
    job.result = {"mail_state": state}
    job.error_message = None if state == "ACCEPTED" else "SUPPORT_MAIL_INTERRUPTED"
    job.completed_at = job.heartbeat_at = utc_now()


def process_notification(db, job):
    message_id = uuid.UUID(job.payload["message_id"])
    message = db.get(SupportMessage, message_id)
    row = db.get(SupportRequest, message.request_id) if message else None
    if not message or not row or row.owner_user_id != job.owner_user_id or str(row.id) != job.payload["request_id"]:
        return {"mail_state": "UNAVAILABLE"}
    if message.notification_job_id != job.id:
        return {"mail_state": "SUPERSEDED"}
    if message.mail_state != "QUEUED":
        # A committed send marker is intentionally not a license to send again.
        if message.mail_state == "SENDING":
            message.mail_state = "UNKNOWN"
        return {"mail_state": message.mail_state}
    settings = get_settings()
    owner = db.get(User, row.owner_user_id, populate_existing=True)
    actor = db.get(User, message.author_user_id) if message.author_user_id else None
    root = db.get(User, ROOT_ADMIN_USER_ID, populate_existing=True)
    if (not owner or not owner.can_login or not actor or not actor.can_login or row.status == "IMPORTED"
            or not settings.smtp_host or not settings.smtp_from_address or not root or not root.can_login
            or (message.author_role == "ADMIN" and not row.notify_replies)):
        message.mail_state = "UNAVAILABLE"
        return {"mail_state": message.mail_state}
    try:
        recipient = normalize_email(owner.normalized_email or "") if message.author_role == "ADMIN" else normalize_email(root.normalized_email or "")
    except ValueError:
        message.mail_state = "UNAVAILABLE"
        return {"mail_state": message.mail_state}
    email = EmailMessage()
    email["From"] = settings.smtp_from_address
    email["To"] = recipient
    email["Subject"] = "Chat Reader request update / 请求有更新"
    email["Message-ID"] = f"<support-{message.id}@chat-reader.invalid>"
    # No title/body, diagnostic, account email, or attachment appears in the notification.
    link = f"{settings.public_web_base_url.rstrip('/')}/#support-request={row.id}"
    email.set_content("A request has an update. Sign in to view it. / 请登录查看请求更新。\n\n" + link)
    message.mail_state = "SENDING"
    message.notification_attempts += 1
    job.phase, job.heartbeat_at = "sending_notification", utc_now()
    db.commit()
    # SMTP and our transaction cannot commit atomically. A crash after this marker
    # produces UNKNOWN, never an automatic duplicate notification.
    try:
        _deliver(settings, email)
        state = "ACCEPTED"
    except (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused,
            smtplib.SMTPDataError, smtplib.SMTPAuthenticationError, smtplib.SMTPConnectError):
        state = "FAILED"  # explicit negative SMTP result; user may retry at most 3 attempts
    except Exception:
        state = "UNKNOWN"  # transport interruption may occur after SMTP acceptance
    current = db.scalar(select(SupportMessage).where(SupportMessage.id == message_id,
        SupportMessage.notification_job_id == job.id).execution_options(populate_existing=True))
    if current:
        current.mail_state = state
    return {"mail_state": state}
