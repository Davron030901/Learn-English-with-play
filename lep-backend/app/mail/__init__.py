"""Email: a port and the two ways this service sends it (SMTP, and a file outbox for tests)."""

from __future__ import annotations

from pathlib import Path

from app.config import Settings
from app.mail.outbox import FileMailer
from app.mail.ports import Mailer, MailUnavailable, Message
from app.mail.smtp import SmtpMailer


def build_mailer(settings: Settings) -> Mailer | None:
    """The configured mailer, or None when ``LEP_MAIL_BACKEND=none`` (the feature is off)."""
    sender = settings.mail_from or ""
    if settings.mail_backend == "smtp" and settings.smtp_host is not None:
        return SmtpMailer(
            host=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_username,
            password=settings.smtp_password,
            tls=settings.smtp_tls,
            sender=sender,
            timeout_s=settings.smtp_timeout_s,
        )
    if settings.mail_backend == "file":
        return FileMailer(Path(settings.mail_outbox_dir), sender=sender)
    return None


__all__ = ["FileMailer", "MailUnavailable", "Mailer", "Message", "SmtpMailer", "build_mailer"]
