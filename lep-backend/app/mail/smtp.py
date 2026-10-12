"""SMTP, the one protocol every mail provider speaks — so choosing a provider is configuration.

``smtplib`` blocks, so each message is sent in a worker thread. TLS is required in production
(``starttls`` on 587 or implicit ``ssl`` on 465, both verifying the relay's certificate); ``none``
is for a local catcher such as Mailpit.
"""

from __future__ import annotations

import asyncio
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from typing import Literal

from pydantic import SecretStr

from app.mail.ports import MailUnavailable, Message


class SmtpMailer:
    def __init__(
        self,
        *,
        host: str,
        port: int,
        username: str | None,
        password: SecretStr | None,
        tls: Literal["starttls", "ssl", "none"],
        sender: str,
        timeout_s: float,
    ) -> None:
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        self._tls = tls
        self._sender = sender
        self._timeout_s = timeout_s

    def build(self, message: Message) -> EmailMessage:
        mail = EmailMessage()
        mail["From"] = self._sender
        mail["To"] = message.to
        mail["Subject"] = message.subject
        mail["Date"] = formatdate(localtime=False)
        mail["Message-ID"] = make_msgid(domain=self._sender.rpartition("@")[2].strip("> ") or None)
        mail["Auto-Submitted"] = "auto-generated"
        mail.set_content(message.text)
        return mail

    async def send(self, message: Message) -> None:
        mail = self.build(message)
        try:
            await asyncio.to_thread(self._send, mail)
        except (smtplib.SMTPException, OSError) as exc:
            raise MailUnavailable(
                f"the mail relay refused or could not be reached: {type(exc).__name__}"
            ) from None

    def _send(self, mail: EmailMessage) -> None:
        context = ssl.create_default_context()
        client: smtplib.SMTP
        if self._tls == "ssl":
            client = smtplib.SMTP_SSL(
                self._host, self._port, timeout=self._timeout_s, context=context
            )
        else:
            client = smtplib.SMTP(self._host, self._port, timeout=self._timeout_s)
        with client:
            if self._tls == "starttls":
                client.starttls(context=context)
            if self._username is not None and self._password is not None:
                client.login(self._username, self._password.get_secret_value())
            client.send_message(mail)
