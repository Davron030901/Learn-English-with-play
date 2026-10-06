"""The AI conversation partner, pure rules (docs/16 E21, docs/07 §6.2, docs/10 §8.9).

Everything here is deterministic and testable without a model: who the learner may talk to,
what the character knows, how hard the character's English may be, what a turn earns, and what
must never leave the learner's device in a prompt (contact details).

The cast are the story's characters. A character is available once the learner's unit has
reached the character's first episode, and knows only the story up to that unit — no spoilers.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Final

#: bump when persona sheets or the system prompt change in a way that matters for review
PROMPT_VERSION: Final = "partner-2026-10-04"

MODES: Final = frozenset({"fluency", "accuracy"})

# ------------------------------------------------------------------------- the cast


@dataclass(frozen=True, slots=True)
class Persona:
    id: str
    name: str
    #: who they are, in a line (shown in the app)
    role: dict[str, str]
    #: how they speak and behave (for the model only)
    sheet: str


CAST: Final[tuple[Persona, ...]] = (
    Persona(
        "sarah",
        "Sarah",
        {
            "en": "English teacher, new in Tashkent",
            "uz": "Ingliz tili oʻqituvchisi, Toshkentga yangi kelgan",
            "ru": "Учительница английского, недавно в Ташкенте",
        },
        "Sarah is an English teacher who has recently moved to Tashkent. She is warm, curious "
        "and patient, loves exploring the city, and is learning Uzbek herself, so she knows how "
        "it feels to learn a language. She asks friendly follow-up questions and celebrates "
        "small wins.",
    ),
    Persona(
        "aziz",
        "Aziz",
        {
            "en": "Student, Kamola's younger brother",
            "uz": "Talaba, Kamolaning ukasi",
            "ru": "Студент, младший брат Камолы",
        },
        "Aziz is a cheerful, hard-working student in Tashkent. He studies a lot, draws very "
        "well and likes music. He is a little shy at first, then enthusiastic. He speaks simply "
        "and often asks what the learner thinks.",
    ),
    Persona(
        "kamola",
        "Kamola",
        {
            "en": "Teacher, Sarah's friend",
            "uz": "Oʻqituvchi, Sarahning dugonasi",
            "ru": "Учительница, подруга Сары",
        },
        "Kamola is a teacher at a school in Tashkent and Sarah's good friend. She speaks Uzbek, "
        "Russian and English, loves books, makes tea for everyone and gives practical, caring "
        "advice. She is organised and kind, with a gentle sense of humour.",
    ),
    Persona(
        "bobur",
        "Bobur",
        {
            "en": "Friend who knows the city",
            "uz": "Shaharni yaxshi biladigan doʻst",
            "ru": "Друг, который знает город",
        },
        "Bobur is an outgoing friend of Aziz who knows every street and café in Tashkent. He "
        "loves food, plays football in the park on Sundays and is always ready to help with "
        "directions or shopping. He is energetic and jokes a lot.",
    ),
    Persona(
        "karimov",
        "Mr Karimov",
        {
            "en": "Senior teacher at Sarah's school",
            "uz": "Sarah ishlaydigan maktabning katta oʻqituvchisi",
            "ru": "Старший учитель в школе Сары",
        },
        "Mr Karimov is an experienced, polite and slightly formal senior teacher at the school "
        "where Sarah works. He works very hard, cares about his students and enjoys explaining "
        "things clearly. He uses polite forms and is encouraging.",
    ),
)
BY_ID: Final[dict[str, Persona]] = {p.id: p for p in CAST}
#: the speaker name in the story texts → persona id
SPEAKERS: Final[dict[str, str]] = {p.name: p.id for p in CAST}


def first_appearances(
    unit_order: Sequence[str], stories: Mapping[str, Sequence[str]]
) -> dict[str, str]:
    """Persona id → the first unit (in course order) whose story they speak in."""
    out: dict[str, str] = {}
    for unit_id in unit_order:
        for speaker in stories.get(unit_id, ()):
            pid = SPEAKERS.get(speaker)
            if pid is not None and pid not in out:
                out[pid] = unit_id
    return out


def available_cast(unit_id: str, unit_order: Sequence[str], firsts: Mapping[str, str]) -> list[str]:
    """Persona ids the learner has met by ``unit_id`` (their first episode is not later)."""
    if unit_id not in unit_order:
        return []
    position = {u: i for i, u in enumerate(unit_order)}
    here = position[unit_id]
    return [p.id for p in CAST if p.id in firsts and position[firsts[p.id]] <= here]


# ------------------------------------------------------------------------- the level controller

#: the most words a character's sentence may have at each band (docs/16 E21); None = free
MAX_SENTENCE_WORDS: Final[dict[str, int | None]] = {"A1": 8, "A2": 12, "B1": 16, "B2": 22}
#: the share of a reply's words the learner should already know
MIN_COVERAGE: Final[dict[str, float]] = {"A1": 0.95, "A2": 0.95, "B1": 0.90}

#: grammar words every learner meets in the first units, plus the cast's names
FUNCTION_WORDS: Final = frozenset(
    """a an the i you he she it we they me him her us them my your his its our their mine yours
    am is are was were be been being do does did have has had will would can could shall should
    may might must not no yes and or but so because if when then than that this these those
    there here what who where why how which whose of to in on at for from with by about as up
    down out over under into after before very too also just only some any all every much many
    more most lot lots please thank thanks hello hi bye goodbye ok okay oh well let let's sorry
    sarah aziz kamola bobur karimov mr mrs ms tashkent uzbekistan samarkand""".split()  # noqa: SIM905
)

_WORD = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
_SENTENCE = re.compile(r"[^.!?]+[.!?]*")
#: typographic apostrophes a phone keyboard or the model may type, read as the plain one
_APOSTROPHES: Final = str.maketrans({"’": "'", "‘": "'", "ʼ": "'"})
#: negative contractions whose base is not simply the word before "n't"
_NEGATIVES: Final = {"can't": "can", "won't": "will", "shan't": "shall", "ain't": "am"}


def band(cefr: str) -> str:
    return cefr[:2]


def words(text: str) -> list[str]:
    return [w.lower() for w in _WORD.findall(text.translate(_APOSTROPHES))]


def _stem(word: str) -> Iterable[str]:
    """The word and its likely base forms (a light, deterministic lemmatiser)."""
    yield word
    # don't → do, isn't → is, can't → can; I'm → i, she's → she
    base = _NEGATIVES.get(word, word[:-3]) if word.endswith("n't") else word.split("'")[0]
    yield base
    for suffix, repl in (
        ("ies", "y"), ("ied", "y"), ("ing", ""), ("ing", "e"), ("ed", ""), ("ed", "e"),
        ("es", ""), ("s", ""), ("er", ""), ("est", ""), ("ly", ""),
    ):  # fmt: skip
        if base.endswith(suffix) and len(base) - len(suffix) >= 2:
            yield base[: -len(suffix)] + repl
    if len(base) > 4 and base[-1] == base[-2]:  # running → runn → run
        yield base[:-1]


def known(word: str, vocabulary: frozenset[str]) -> bool:
    if word.isdigit():
        return True
    return any(form in vocabulary or form in FUNCTION_WORDS for form in _stem(word))


@dataclass(frozen=True, slots=True)
class LevelCheck:
    ok: bool
    coverage: float
    longest_sentence: int
    unknown: tuple[str, ...]


def check_level(text: str, cefr: str, vocabulary: frozenset[str]) -> LevelCheck:
    """Is the reply pitched at the learner? Sentence length and known-word coverage."""
    tokens = words(text)
    if not tokens:
        return LevelCheck(True, 1.0, 0, ())
    unknown = tuple(dict.fromkeys(w for w in tokens if not known(w, vocabulary)))
    coverage = 1 - sum(1 for w in tokens if not known(w, vocabulary)) / len(tokens)
    longest = max((len(words(s)) for s in _SENTENCE.findall(text)), default=0)
    limit = MAX_SENTENCE_WORDS.get(band(cefr))
    floor = MIN_COVERAGE.get(band(cefr))
    ok = (limit is None or longest <= limit) and (floor is None or coverage >= floor)
    return LevelCheck(ok, coverage, longest, unknown)


# ------------------------------------------------------------------------- privacy

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_URL = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)
#: top-level domains a link without a scheme ends in. Those that are also English words only
#: count with a path after them (t.me/…), so "I like tea.Me too" is left alone.
_TLDS: Final = "com|net|org|biz|uz|ru|kz|kg|tj|tm|su|ua|de|eu|tk|cc|xyz|gg|ly"
_WORDY_TLDS: Final = "me|by|uk|info|co|us|io|ai|tv|app|dev|link|site|online|store|shop|page"
_DOMAIN = re.compile(
    rf"(?<![\w@.])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+"
    rf"(?:(?:{_TLDS})\b(?:/\S*)?|(?:{_WORDY_TLDS})/\S*)",
    re.IGNORECASE,
)
#: a Telegram / Instagram handle is a contact detail too
_HANDLE = re.compile(r"(?<![\w@])@[A-Za-z0-9_]{3,32}\b")
_PHONE = re.compile(r"(?<!\w)\+?\d[\d\s().-]{6,}\d(?!\w)")
#: 1 500 000 or 150,000,000 — a price the learner is practising, not a phone number
_THOUSANDS = re.compile(r"\d{1,3}([ ,.])\d{3}(?:\1\d{3})*")


def _phone(m: re.Match[str]) -> str:
    """A phone number, unless it reads as a date (12.05.2010) or a price (1 500 000 so'm)."""
    found = m.group(0)
    digits = sum(c.isdigit() for c in found)
    if (found.startswith("+") and digits >= 7) or digits >= 10:
        return "[number]"
    if digits >= 9 and not _THOUSANDS.fullmatch(found):
        return "[number]"
    return found


def redact(text: str) -> str:
    """Contact details never reach the model or the transcript (docs/10 §8.9): emails, links
    (with or without a scheme), handles and phone numbers. Dates and prices stay."""
    text = _EMAIL.sub("[email]", text)
    text = _URL.sub("[link]", text)
    text = _DOMAIN.sub("[link]", text)
    text = _HANDLE.sub("[handle]", text)
    return _PHONE.sub(_phone, text)


def clean_reply(text: str) -> str:
    """A character never sends links or contact details, whatever the model wrote."""
    return redact(text).strip()


# ------------------------------------------------------------------------- goals, XP, summary


@dataclass(frozen=True, slots=True)
class Subgoal:
    id: str
    text: str


_CAN = re.compile(r"^\s*I can\s+", re.IGNORECASE)


def subgoals_for(can_do: Sequence[str], limit: int = 3) -> list[Subgoal]:
    """The scenario's goals are the unit's can-do statements ('I can order food' → 'Order food')."""
    out: list[Subgoal] = []
    for k, statement in enumerate(can_do[:limit]):
        text = _CAN.sub("", statement).rstrip(".").strip()
        if text:
            out.append(Subgoal(f"g{k + 1}", text[0].upper() + text[1:]))
    return out


#: production XP per learner turn of at least three words (docs/16 E21)
TURN_XP: Final = 3
TURN_MIN_WORDS: Final = 3


def turn_xp(text: str) -> int:
    return TURN_XP if len(words(text)) >= TURN_MIN_WORDS else 0


#: thinking and typing time a turn may count toward the daily goal, at most
MAX_TURN_MS: Final = 120_000
MIN_TURN_MS: Final = 2_000


def turn_active_ms(rt_ms: int | None, text: str) -> int:
    """Time on task for one turn: the client's measure, bounded; else ~1.5 s a word."""
    estimate = 1_500 * max(1, len(words(text)))
    value = rt_ms if rt_ms is not None else estimate
    return max(MIN_TURN_MS, min(MAX_TURN_MS, value))


def words_used(learner_texts: Iterable[str], unit_lemmas: Iterable[str]) -> list[str]:
    """The unit's words the learner used themselves, in the unit's order. A multi-word lemma
    ('thank you', 'in front of') counts when its words come in a row."""
    said = [[set(_stem(w)) for w in words(t)] for t in learner_texts]

    def used(lemma: str) -> bool:
        target = words(lemma)
        n = len(target)
        return n > 0 and any(
            all(target[j] in forms[i + j] for j in range(n))
            for forms in said
            for i in range(len(forms) - n + 1)
        )

    return [lemma for lemma in dict.fromkeys(unit_lemmas) if used(lemma)]


def focus_items(recasts: Sequence[Mapping[str, str]], limit: int = 2) -> list[dict[str, str]]:
    """Two things to work on (docs/07 §6.2): the latest distinct corrections."""
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for r in reversed(recasts):
        key = r.get("corrected", "").strip().lower()
        if not key or key in seen or key == r.get("original", "").strip().lower():
            continue
        seen.add(key)
        out.append({"original": r.get("original", ""), "corrected": r.get("corrected", "")})
        if len(out) == limit:
            break
    return out


def _utf16(text: str, index: int) -> int:
    return len(text[:index].encode("utf-16-le")) // 2


def span_of(reply: str, phrase: str) -> tuple[int, int] | None:
    """Where a recast's corrected form appears in the character's reply, for underlining.

    The offsets are UTF-16 code units — what the app's JavaScript ``String.slice`` counts — so
    an emoji before the phrase does not shift the underline."""
    wanted = phrase.strip()
    if not wanted:
        return None
    m = re.search(re.escape(wanted), reply, re.IGNORECASE)
    return None if m is None else (_utf16(reply, m.start()), _utf16(reply, m.end()))
