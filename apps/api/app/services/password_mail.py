from email.message import EmailMessage
import smtplib

from app.core.config import Settings


def send_password_reset(settings: Settings, recipient: str, reset_url: str) -> None:
    if not settings.smtp_host or not settings.smtp_from_address:
        raise RuntimeError("SMTP is not configured.")
    message = EmailMessage()
    message["Subject"] = "Reset your Chat Reader password"
    message["From"] = settings.smtp_from_address
    message["To"] = recipient
    message.set_content(
        "A password reset was requested for your Chat Reader account.\n\n"
        f"Open this one-time link to continue:\n{reset_url}\n\n"
        "If you did not request this, you can ignore this message."
    )
    _deliver(settings, message)


def send_email_verification(settings: Settings, recipient: str, verification_url: str) -> None:
    if not settings.smtp_host or not settings.smtp_from_address:
        raise RuntimeError("SMTP is not configured.")
    message = EmailMessage()
    message["Subject"] = "Verify your Chat Reader email / 验证邮箱"
    message["From"] = settings.smtp_from_address
    message["To"] = recipient
    message.set_content(
        "Confirm your email on the following page. This one-time link expires in 30 minutes.\n"
        "请打开下方页面并确认邮箱。此链接只能使用一次，30 分钟后失效。\n\n"
        f"{verification_url}\n\n"
        "If you did not register, ignore this email. / 如果你没有注册，请忽略此邮件。"
    )
    _deliver(settings, message)


def _deliver(settings: Settings, message: EmailMessage) -> None:
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as client:
        if settings.smtp_starttls:
            client.starttls()
        if settings.smtp_username:
            client.login(settings.smtp_username, settings.smtp_password.get_secret_value() if settings.smtp_password else "")
        client.send_message(message)
