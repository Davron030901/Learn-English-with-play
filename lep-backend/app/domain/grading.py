"""The grader (backend brief §7) — the server's authoritative verdict on one answer.

Pure. A line-for-line port of the app's optimistic grader (``src/grading/normalise.ts``,
``contractions.ts``, ``distance.ts``, ``grade.ts``): the learner must never see the device mark
an answer right that the server then marks wrong, or the reverse. ``test_grading_parity.py``
replays tens of thousands of verdicts the app's grader produced over the real corpus; any
change here or there must keep it green.

Normalisation (docs/09 §5), always in this order:

    (always)  NFKC · curly quotes and dashes folded · whitespace collapsed       rule 1
    contraction → case → punct → spacing → spelling_variant → typo1

``typo1`` is a comparison mode, applied last against the already-normalised accepted set:
exactly one word may differ by one Damerau–Levenshtein edit, the intended word has 4+
characters, the typed word is not itself a course word (form/from, quiet/quite), and never in
``spelling_bee``.

Free speech and free writing are never marked wrong here: a voice answer, ``write_sentence``
and an unlisted ``speak_prompt`` reply come back ``ungraded`` (a rubric or a human decides).
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Final

from app.domain.spelling import canonical_spelling, lexical_alternatives


class Verdict(StrEnum):
    CORRECT = "correct"
    INCORRECT = "incorrect"
    UNGRADED = "ungraded"


class InvalidSubmission(ValueError):
    """The submission's shape does not fit the item's exercise type."""


@dataclass(frozen=True, slots=True)
class GradeContext:
    #: The course's own English words — the real-word exclusion of typo rule 7.
    words: frozenset[str] = frozenset()
    #: Lemmas of the lexemes the item targets (lexical US/UK pairs apply only to these).
    target_lemmas: tuple[str, ...] = ()
    #: Exponents of the functions the item targets (speak_prompt accepts any of them).
    function_exponents: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class GradeResult:
    verdict: Verdict
    expected: str | None
    #: (typed word, intended word) when accepted with a spelling slip
    typo: tuple[str, str] | None = None
    #: (error_code, feedback) of the rejected_with_feedback row the answer matched
    rejected: tuple[str, str] | None = None
    #: why an answer was not graded, or was graded wrong without being wrong on its merits
    reason: str | None = None
    #: per-element result for order, pairs and bins
    elements: tuple[bool, ...] | None = field(default=None)


FAMILY: Final[dict[str, str]] = {
    "mcq_word_from_definition": "choice",
    "pragmatics_choose": "choice",
    "minimal_pair_discrimination": "choice",
    "grammaticality_judgement": "choice",
    "gap_fill_bank": "choice",
    "stress_tap": "choice",
    "phoneme_id": "choice",
    "odd_one_out": "choice",
    "read_scan_detail": "choice",
    "read_gist_mcq": "choice",
    "listen_gist_mcq": "choice",
    "listen_detail_gap": "choice",
    "type_from_l1": "text",
    "dictation_word": "text",
    "error_correct": "text",
    "dictation_sentence": "text",
    "spelling_bee": "text",
    "gap_fill_free": "text",
    "write_sentence": "text",
    "word_bank_build": "bank",
    "sentence_reorder": "bank",
    "listen_order_events": "order",
    "tap_pairs": "pairs",
    "memory_match": "pairs",
    "word_race": "pairs",
    "sort_bins": "bins",
    "repeat_after": "speak",
    "speak_prompt": "speak",
    "read_aloud": "speak",
    "speak_roleplay": "speak",
    "speak_retell": "speak",
}

_INDEX_TYPES: Final = frozenset(
    {
        "mcq_word_from_definition",
        "pragmatics_choose",
        "minimal_pair_discrimination",
        "grammaticality_judgement",
        "stress_tap",
        "phoneme_id",
        "odd_one_out",
        "read_scan_detail",
        "read_gist_mcq",
        "listen_gist_mcq",
        "listen_detail_gap",
    }
)
_TYPED_TEXT_TYPES: Final = frozenset(
    {
        "type_from_l1",
        "dictation_word",
        "dictation_sentence",
        "spelling_bee",
        "gap_fill_free",
        "error_correct",
    }
)
_SPEAK_TYPES: Final = frozenset(
    {"repeat_after", "read_aloud", "speak_prompt", "speak_roleplay", "speak_retell"}
)

#: Rules for a typed answer to a speaking item, which carries no normalise list of its own.
TYPED_SPEECH_RULES: Final = frozenset(
    {"contraction", "case", "punct", "spacing", "spelling_variant"}
)

# ------------------------------------------------------------------- rule 1

_QUOTES: Final[dict[str, str]] = {
    "‘": "'",
    "’": "'",
    "‚": "'",
    "‛": "'",
    "′": "'",
    "ʼ": "'",
    "ʹ": "'",
    "`": "'",
    "´": "'",
    "“": '"',
    "”": '"',
    "„": '"',
    "«": '"',
    "»": '"',
    "″": '"',
    "‐": "-",
    "‑": "-",
    "‒": "-",
    "–": "-",
    "—": "-",
    "―": "-",
    "−": "-",
    "…": "...",
    " ": " ",
}
_QUOTE_RE: Final = re.compile("[" + "".join(re.escape(c) for c in _QUOTES) + "]")
_WS: Final = re.compile(r"[\s\ufeff]+")  # JavaScript's \s includes U+FEFF


def base_normalise(s: str) -> str:
    """Rule 1, always applied."""
    s = unicodedata.normalize("NFKC", s)
    s = _QUOTE_RE.sub(lambda m: _QUOTES.get(m.group(0), m.group(0)), s)
    return _WS.sub(" ", s).strip()


def apply_case(s: str) -> str:
    return s.lower()


_PUNCT: Final = re.compile(r'[.,!?;:"]+')
_EDGE_APOSTROPHES: Final = re.compile(r"(^|\s)'+|'+(?=\s|$)")
_LONE_DASH: Final = re.compile(r"(^|\s)-+(?=\s|$)")


def apply_punct(s: str) -> str:
    """Sentence punctuation and quotation marks go; apostrophes and hyphens inside words stay."""
    s = _PUNCT.sub(" ", s)
    s = _EDGE_APOSTROPHES.sub(lambda m: m.group(1) or "", s)
    s = _LONE_DASH.sub(lambda m: m.group(1), s)
    return _WS.sub(" ", s).strip()


_SPACE_BEFORE_PUNCT: Final = re.compile(r"\s+([.,!?;:])")


def apply_spacing(s: str) -> str:
    s = _SPACE_BEFORE_PUNCT.sub(r"\1", s)
    return _WS.sub(" ", s).strip()


# ------------------------------------------------------------------- contractions (rule 5)

_CONTRACTIONS: Final[dict[str, tuple[str, ...]]] = {
    "i'm": ("i am",),
    "you're": ("you are",),
    "we're": ("we are",),
    "they're": ("they are",),
    "who're": ("who are",),
    "what're": ("what are",),
    "he's": ("he is", "he has"),
    "she's": ("she is", "she has"),
    "it's": ("it is", "it has"),
    "that's": ("that is", "that has"),
    "there's": ("there is", "there has"),
    "here's": ("here is",),
    "what's": ("what is", "what has"),
    "where's": ("where is", "where has"),
    "who's": ("who is", "who has"),
    "how's": ("how is", "how has"),
    "when's": ("when is", "when has"),
    "why's": ("why is",),
    "let's": ("let us",),
    "i've": ("i have",),
    "you've": ("you have",),
    "we've": ("we have",),
    "they've": ("they have",),
    "who've": ("who have",),
    "would've": ("would have",),
    "could've": ("could have",),
    "should've": ("should have",),
    "might've": ("might have",),
    "must've": ("must have",),
    "i'll": ("i will",),
    "you'll": ("you will",),
    "he'll": ("he will",),
    "she'll": ("she will",),
    "it'll": ("it will",),
    "we'll": ("we will",),
    "they'll": ("they will",),
    "that'll": ("that will",),
    "there'll": ("there will",),
    "who'll": ("who will",),
    "i'd": ("i would", "i had"),
    "you'd": ("you would", "you had"),
    "he'd": ("he would", "he had"),
    "she'd": ("she would", "she had"),
    "it'd": ("it would", "it had"),
    "we'd": ("we would", "we had"),
    "they'd": ("they would", "they had"),
    "who'd": ("who would", "who had"),
    "that'd": ("that would", "that had"),
    "isn't": ("is not",),
    "aren't": ("are not",),
    "wasn't": ("was not",),
    "weren't": ("were not",),
    "don't": ("do not",),
    "doesn't": ("does not",),
    "didn't": ("did not",),
    "haven't": ("have not",),
    "hasn't": ("has not",),
    "hadn't": ("had not",),
    "won't": ("will not",),
    "wouldn't": ("would not",),
    "shan't": ("shall not",),
    "shouldn't": ("should not",),
    "can't": ("can not",),
    "cannot": ("can not",),
    "couldn't": ("could not",),
    "mustn't": ("must not",),
    "needn't": ("need not",),
    "mightn't": ("might not",),
    "daren't": ("dare not",),
    "oughtn't": ("ought not",),
}
_MAX_VARIANTS: Final = 32
_CONTRACTION_TOKEN: Final = re.compile(r"^([^A-Za-z']*)([A-Za-z']+)([^A-Za-z']*)$")


def expand_contractions(text: str) -> list[str]:
    """Every reading of a string with each contraction expanded (he's → he is / he has)."""
    variants: list[list[str]] = [[]]
    for token in text.split(" "):
        m = _CONTRACTION_TOKEN.match(token)
        readings = _CONTRACTIONS.get(m.group(2).lower()) if m else None
        if m is None or readings is None:
            variants = [[*v, token] for v in variants]
            continue
        lead, core, trail = m.group(1), m.group(2), m.group(3)
        capitalised = core[:1].isascii() and core[:1].isupper()
        nxt: list[list[str]] = []
        for v in variants:
            for r in readings:
                cased = r[:1].upper() + r[1:] if capitalised else r
                nxt.append([*v, f"{lead}{cased}{trail}"])
                if len(nxt) >= _MAX_VARIANTS:
                    break
            if len(nxt) >= _MAX_VARIANTS:
                break
        variants = nxt
    return [" ".join(v) for v in variants]


def _canonical_cased(s: str) -> str:
    """Spelling canonicalisation that keeps the answer's own capitalisation when case matters."""
    out: list[str] = []
    for token in s.split(" "):
        lower = token.lower()
        canon = canonical_spelling(lower)
        if canon == lower:
            out.append(token)
        elif token[:1].isascii() and token[:1].isupper():
            out.append(canon[:1].upper() + canon[1:])
        else:
            out.append(canon)
    return " ".join(out)


def normalise_readings(raw: str, rules: frozenset[str]) -> list[str]:
    """All normalised readings of a string under an item's rules (several when a contraction is
    ambiguous). Two answers match when their reading sets intersect."""
    readings = [base_normalise(raw)]
    if "contraction" in rules:
        readings = [r for reading in readings for r in expand_contractions(reading)]
    if "case" in rules:
        readings = [apply_case(r) for r in readings]
    if "punct" in rules:
        readings = [apply_punct(r) for r in readings]
    if "spacing" in rules or "punct" in rules:
        readings = [apply_spacing(r) for r in readings]
    if "spelling_variant" in rules:
        fold = canonical_spelling if "case" in rules else _canonical_cased
        readings = [fold(r) for r in readings]
    return list(dict.fromkeys(readings))


# ------------------------------------------------------------------- typo tolerance (rule 7)


def within_one_edit(a: str, b: str) -> bool:
    """Optimal-string-alignment distance ≤ 1: one insertion, deletion, substitution, or
    transposition of two adjacent characters."""
    if a == b:
        return True
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    if la == lb:
        diffs = [i for i in range(la) if a[i] != b[i]]
        if len(diffs) == 1:
            return True
        if len(diffs) == 2:
            i, j = diffs
            return j == i + 1 and a[i] == b[j] and a[j] == b[i]
        return False
    long_, short = (a, b) if la > lb else (b, a)
    i = j = 0
    skipped = False
    while i < len(long_) and j < len(short):
        if long_[i] == short[j]:
            i += 1
            j += 1
        elif not skipped:
            skipped = True
            i += 1
        else:
            return False
    return True


_EDGES: Final = re.compile(r"^[^A-Za-z']+|[^A-Za-z']+$")


def _strip_edges(w: str) -> str:
    return _EDGES.sub("", w)


@dataclass(frozen=True, slots=True)
class TextMatch:
    ok: bool
    typo: tuple[str, str] | None = None


def match_text(
    typed_raw: str,
    accepted: Sequence[str],
    rules: frozenset[str],
    ctx: GradeContext,
    *,
    allow_typo: bool,
) -> TextMatch:
    typed = normalise_readings(typed_raw, rules)
    accepted_readings = [r for a in accepted for r in normalise_readings(a, rules)]
    accepted_set = set(accepted_readings)
    if any(t and t in accepted_set for t in typed):
        return TextMatch(True)
    if not allow_typo:
        return TextMatch(False)
    for t in typed:
        tw = t.split(" ")
        for a in accepted_readings:
            aw = a.split(" ")
            if len(tw) != len(aw):
                continue
            diffs = [i for i in range(len(tw)) if tw[i] != aw[i]]
            if len(diffs) != 1:
                continue
            typed_word = _strip_edges(tw[diffs[0]])
            key_word = _strip_edges(aw[diffs[0]])
            if len(key_word) < 4:
                continue
            if not within_one_edit(typed_word.lower(), key_word.lower()):
                continue
            if typed_word.lower() in ctx.words:
                continue
            return TextMatch(True, (typed_word, key_word))
    return TextMatch(False)


# ------------------------------------------------------------------- items


def join_tiles(tiles: Sequence[str]) -> str:
    """Bank tiles as written text: punctuation tiles attach to the word before them."""
    out = ""
    for t in tiles:
        if out == "" or re.match(r"^[.,!?;:)\]'’]", t) or re.fullmatch(r"n't", t, re.I):
            out += t
        else:
            out += f" {t}"
    return out


def gradable_offline(type_id: str, answer: Mapping[str, Any]) -> bool:
    if type_id in ("write_sentence", "speak_roleplay", "speak_retell"):
        return False
    if type_id == "speak_prompt":
        return bool(answer.get("key"))
    return True


def expected_answer(
    type_id: str, prompt: Mapping[str, Any], answer: Mapping[str, Any]
) -> str | None:
    if type_id in _INDEX_TYPES:
        choices = prompt.get("syllables" if type_id == "stress_tap" else "options") or []
        index = answer.get("index", -1)
        return str(choices[index]) if 0 <= index < len(choices) else None
    if type_id == "listen_order_events":
        return " / ".join(answer.get("key") or [])
    if FAMILY.get(type_id) in ("pairs", "bins"):
        return None
    key = answer.get("key") or []
    return str(key[0]) if key else None


def _rules(answer: Mapping[str, Any]) -> frozenset[str]:
    return frozenset(answer.get("normalise") or ())


def _accepted_forms(answer: Mapping[str, Any], ctx: GradeContext) -> list[str]:
    base = [*(answer.get("key") or []), *(answer.get("accepted") or [])]
    if not ctx.target_lemmas or "spelling_variant" not in _rules(answer):
        return base
    return base + [alt for k in base for alt in lexical_alternatives(k, ctx.target_lemmas)]


def _int(value: Any, name: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise InvalidSubmission(f"{name} must be an integer")
    return value


def _ints(value: Any, name: str) -> list[int]:
    if not isinstance(value, list):
        raise InvalidSubmission(f"{name} must be a list of integers")
    return [_int(v, name) for v in value]


def grade(
    type_id: str,
    prompt: Mapping[str, Any],
    answer: Mapping[str, Any],
    submission: Mapping[str, Any],
    ctx: GradeContext,
) -> GradeResult:
    """Grade one submission. ``submission`` is the app's outbox shape: ``{"kind": ..., ...}``."""
    kind = submission.get("kind")
    expected = expected_answer(type_id, prompt, answer)
    if kind == "timeout":
        return GradeResult(Verdict.INCORRECT, expected, reason="timeout")

    if type_id in _INDEX_TYPES:
        if kind != "choice":
            raise InvalidSubmission(f"{type_id} needs a choice")
        ok = _int(submission.get("index"), "index") == answer.get("index")
        return GradeResult(Verdict.CORRECT if ok else Verdict.INCORRECT, expected)

    if type_id == "gap_fill_bank":
        if kind != "text":
            raise InvalidSubmission("gap_fill_bank needs the chosen word as text")
        m = match_text(
            str(submission.get("text", "")),
            _accepted_forms(answer, ctx),
            _rules(answer),
            ctx,
            allow_typo=False,
        )
        return GradeResult(Verdict.CORRECT if m.ok else Verdict.INCORRECT, expected)

    if type_id in _TYPED_TEXT_TYPES:
        if kind != "text":
            raise InvalidSubmission(f"{type_id} needs text")
        text = str(submission.get("text", ""))
        rules = _rules(answer)
        if type_id == "error_correct":
            # The sentence handed back unchanged is never right, even when its only error is
            # punctuation the item's punct rule would wash away.
            typed = base_normalise(text).lower()
            for row in answer.get("rejected_with_feedback") or []:
                if base_normalise(str(row.get("pattern", ""))).lower() == typed:
                    return GradeResult(
                        Verdict.INCORRECT,
                        expected,
                        rejected=(str(row.get("error_code", "")), str(row.get("feedback", ""))),
                    )
        allow_typo = "typo1" in rules and type_id != "spelling_bee"
        m = match_text(text, _accepted_forms(answer, ctx), rules, ctx, allow_typo=allow_typo)
        if m.ok:
            return GradeResult(Verdict.CORRECT, expected, typo=m.typo)
        rejected: tuple[str, str] | None = None
        if type_id == "error_correct":
            for row in answer.get("rejected_with_feedback") or []:
                if match_text(text, [str(row.get("pattern", ""))], rules, ctx, allow_typo=False).ok:
                    rejected = (str(row.get("error_code", "")), str(row.get("feedback", "")))
                    break
        return GradeResult(Verdict.INCORRECT, expected, rejected=rejected)

    if type_id == "write_sentence":
        if kind != "text":
            raise InvalidSubmission("write_sentence needs text")
        return GradeResult(Verdict.UNGRADED, None, reason="free_response")

    if type_id in ("word_bank_build", "sentence_reorder"):
        if kind != "tiles":
            raise InvalidSubmission(f"{type_id} needs tiles")
        bank = prompt.get("bank") or []
        # The text is rebuilt from the indices; the text the client sent is never trusted.
        tiles = [
            str(bank[i]) if 0 <= i < len(bank) else ""
            for i in _ints(submission.get("indices"), "indices")
        ]
        m = match_text(
            join_tiles(tiles), _accepted_forms(answer, ctx), _rules(answer), ctx, allow_typo=False
        )
        return GradeResult(Verdict.CORRECT if m.ok else Verdict.INCORRECT, expected)

    if type_id == "listen_order_events":
        if kind != "order":
            raise InvalidSubmission("listen_order_events needs an order")
        options = prompt.get("options") or []
        chosen = [
            options[i] if 0 <= i < len(options) else None
            for i in _ints(submission.get("indices"), "indices")
        ]
        key = answer.get("key") or []
        elements = tuple(i < len(chosen) and chosen[i] == line for i, line in enumerate(key))
        ok = len(chosen) == len(key) and all(elements)
        return GradeResult(
            Verdict.CORRECT if ok else Verdict.INCORRECT, expected, elements=elements
        )

    if type_id in ("tap_pairs", "memory_match", "word_race"):
        if kind != "pairs":
            raise InvalidSubmission(f"{type_id} needs pairs")
        pairs = prompt.get("pairs") or []
        mapping = answer.get("mapping") or {}
        raw_matches = submission.get("matches")
        if not isinstance(raw_matches, list):
            raise InvalidSubmission("matches must be a list of [left, right] pairs")
        results: list[bool] = []
        for match in raw_matches:
            if not isinstance(match, list) or len(match) != 2:
                raise InvalidSubmission("matches must be a list of [left, right] pairs")
            left_i, right_i = _int(match[0], "matches"), _int(match[1], "matches")
            left = pairs[left_i][0] if 0 <= left_i < len(pairs) else None
            right = pairs[right_i][1] if 0 <= right_i < len(pairs) else None
            results.append(left is not None and right is not None and mapping.get(left) == right)
        reason = "timeout" if submission.get("timed_out") is True else None
        mistakes = submission.get("mistakes", 0)
        if type_id == "tap_pairs" and isinstance(mistakes, int) and mistakes > 0:
            # docs/09 #1: any mismatch is Again on the item; the confused pairs are marked.
            confused: set[int] = set()
            for a in submission.get("attempts") or []:
                if isinstance(a, list) and len(a) == 2 and a[0] != a[1]:
                    confused.update(x for x in a if isinstance(x, int))
            marked = tuple(
                ok_ and not (isinstance(m, list) and bool(m) and m[0] in confused)
                for ok_, m in zip(results, raw_matches, strict=True)
            )
            return GradeResult(Verdict.INCORRECT, None, reason=reason, elements=marked)
        complete = submission.get("complete") is True
        ok = complete and len(raw_matches) == len(pairs) and all(results)
        return GradeResult(
            Verdict.CORRECT if ok else Verdict.INCORRECT,
            None,
            reason=reason,
            elements=tuple(results),
        )

    if type_id == "sort_bins":
        if kind != "bins":
            raise InvalidSubmission("sort_bins needs an assignment")
        options = prompt.get("options") or []
        bins = prompt.get("bins") or []
        mapping = answer.get("mapping") or {}
        raw = submission.get("assignment")
        if not isinstance(raw, dict):
            raise InvalidSubmission("assignment must map option index to bin index")
        assignment: dict[int, int] = {}
        for k, v in raw.items():
            try:
                assignment[int(k)] = _int(v, "assignment")
            except ValueError:
                raise InvalidSubmission("assignment keys must be option indexes") from None
        results = []
        for i, word in enumerate(options):
            b = assignment.get(i)
            results.append(b is not None and 0 <= b < len(bins) and bins[b] == mapping.get(word))
        complete = all(i in assignment for i in range(len(options)))
        ok = complete and all(results)
        return GradeResult(
            Verdict.CORRECT if ok else Verdict.INCORRECT, None, elements=tuple(results)
        )

    if type_id in _SPEAK_TYPES:
        if kind != "speech":
            raise InvalidSubmission(f"{type_id} needs speech")
        if submission.get("modality") == "voice":
            return GradeResult(Verdict.UNGRADED, expected, reason="voice")
        key = answer.get("key") or []
        if not key:
            return GradeResult(Verdict.UNGRADED, None, reason="free_response")
        text = str(submission.get("text") or "")
        if type_id == "speak_prompt":
            forms = [*key, *ctx.function_exponents]
            if match_text(text, forms, TYPED_SPEECH_RULES, ctx, allow_typo=False).ok:
                return GradeResult(Verdict.CORRECT, expected)
            return GradeResult(Verdict.UNGRADED, expected, reason="free_response")
        ok = match_text(text, key, TYPED_SPEECH_RULES, ctx, allow_typo=False).ok
        return GradeResult(Verdict.CORRECT if ok else Verdict.INCORRECT, expected)

    raise InvalidSubmission(f"unknown exercise type {type_id}")
