"""The name other learners may see (docs/16 E15, E23).

Only a learner who joins something social needs one, and it is never derived from the email.
A name is NFKC-normalised, trimmed, its spaces collapsed; 2–24 characters of letters (any
script, the Uzbek apostrophes U+02BB and U+02BC among them), digits, spaces, ``_``, ``-`` and
``'``, with at least one letter that is not a modifier. No ``@``, no dot and no control or
direction-override character, so a name cannot be an email address, a link or text that
reorders what is around it.
"""

from __future__ import annotations

import unicodedata
from typing import Final

MIN_LENGTH: Final = 2
MAX_LENGTH: Final = 24
_PUNCTUATION: Final = frozenset(" _-'")


class InvalidDisplayName(ValueError):
    pass


def normalise_display_name(raw: str) -> str:
    name = " ".join(unicodedata.normalize("NFKC", raw).split())
    if not MIN_LENGTH <= len(name) <= MAX_LENGTH:
        raise InvalidDisplayName(f"{MIN_LENGTH}–{MAX_LENGTH} characters")
    for ch in name:
        category = unicodedata.category(ch)
        if not (category[0] in "LM" or category == "Nd" or ch in _PUNCTUATION):
            raise InvalidDisplayName("letters, digits, spaces, _ - and apostrophes only")
    if not any(unicodedata.category(ch) in ("Lu", "Ll", "Lt", "Lo") for ch in name):
        raise InvalidDisplayName("at least one letter")
    return name
