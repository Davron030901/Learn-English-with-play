"""A mailer that writes each message to a directory as an ``.eml`` file.

For local and test stacks only (configuration refuses it in production): a developer opens the
file to follow a reset link, and the tests read the link from it. Files are readable by the
service's user alone.
"""

from __future__ import annotations

import asyncio
import os
from email.message import EmailMessage
from email.utils import formatdate
from pathlib import Path

from app.ids import uuid7
from app.mail.ports import MailUnavailable, Message


class FileMailer:
    def __init__(self, directory: Path, *, sender: str) -> None:
        self._directory = directory
        self._sender = sender

    @property
    def directory(self) -> Path:
        return self._directory

    async def send(self, message: Message) -> None:
        mail = EmailMessage()
        mail["From"] = self._sender
        mail["To"] = message.to
        mail["Subject"] = message.subject
        mail["Date"] = formatdate(localtime=False)
        mail.set_content(message.text)
        try:
            await asyncio.to_thread(self._write, mail)
        except OSError as exc:
            raise MailUnavailable(
                f"the outbox could not be written: {type(exc).__name__}"
            ) from None

    def _write(self, mail: EmailMessage) -> None:
        self._directory.mkdir(parents=True, exist_ok=True)
        path = self._directory / f"{uuid7()}.eml"
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as out:
            out.write(mail.as_bytes())
