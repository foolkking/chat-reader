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
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as client:
        if settings.smtp_starttls:
            client.starttls()
        if settings.smtp_username:
            client.login(settings.smtp_username, settings.smtp_password.get_secret_value() if settings.smtp_password else "")
        client.send_message(message)
