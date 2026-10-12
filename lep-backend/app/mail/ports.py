"""The mail port. A message is plain text in one language; nothing in it is HTML."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class MailUnavailable(RuntimeError):
    """The message could not be handed to the relay. The message never appears in the error."""


@dataclass(frozen=True, slots=True)
class Message:
    to: str
    subject: str
    text: str


class Mailer(Protocol):
    async def send(self, message: Message) -> None: ...
