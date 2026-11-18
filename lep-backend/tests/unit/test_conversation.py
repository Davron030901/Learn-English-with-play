"""The AI partner's pure rules and the Claude adapter's handling of what comes back."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.ai.partner import OUTPUT_FORMAT, ClaudePartner, Exchange
from app.domain.conversation import check_level, redact, span_of, words_used

VOCABULARY = frozenset({"worry", "nice", "like", "tea", "go", "bazaar", "want"})


@pytest.mark.parametrize(
    "reply",
    [
        "Don't worry! Is it nice?",
        "Isn't it nice? Do you like tea?",
        "I didn't go to the bazaar. Do you want tea?",
        "Don’t worry! I’m nice.",  # noqa: RUF001 — typographic apostrophes
        "Doesn't it? We won't go. Can't you?",
    ],
)
def test_contractions_are_the_words_they_contract(reply: str) -> None:
    check = check_level(reply, "A1", VOCABULARY)
    assert check.ok, check
    assert check.unknown == ()


@pytest.mark.parametrize(
    ("said", "kept", "gone"),
    [
        ("my telegram t.me/aziz2010", "my telegram [link]", "aziz2010"),
        ("find me at instagram.com/aziz", "[link]", "instagram"),
        ("see tashkent-cafe.uz today", "see [link] today", "tashkent-cafe"),
        ("write to @aziz_2010", "write to [handle]", "aziz_2010"),
        ("call +998 90 123 45 67", "call [number]", "123 45 67"),
        ("call 90 123 45 67", "call [number]", "123 45 67"),
        ("mail ali@example.com", "mail [email]", "example"),
    ],
)
def test_contact_details_are_redacted(said: str, kept: str, gone: str) -> None:
    out = redact(said)
    assert kept in out
    assert gone not in out


@pytest.mark.parametrize(
    "said",
    [
        "I was born on 12.05.2010",
        "It costs 1 500 000 sum",
        "The flat is 150 000 000 so'm",
        "I like tea.Me too",
        "I get up at 7.30",
        "I went home.By the way, I like tea.",
        "I am fine.Info is here",
        "Thanks.Uk is far",
    ],
)
def test_dates_prices_and_typos_the_learner_practises_stay(said: str) -> None:
    assert redact(said) == said


def test_multi_word_lemmas_count_when_said_in_a_row() -> None:
    used = words_used(
        ["thank you very much, I like ice cream", "the T-shirt is in front of me"],
        ["thank you", "ice cream", "like", "in front of", "T-shirt", "excuse me"],
    )
    assert used == ["thank you", "ice cream", "like", "in front of", "T-shirt"]


def test_spans_are_utf16_offsets_for_the_app() -> None:
    reply = "Great! \U0001f60a\U0001f60a Yesterday you went to the bazaar?"
    span = span_of(reply, "went")
    assert span is not None
    utf16 = reply.encode("utf-16-le")
    start, end = span
    assert utf16[2 * start : 2 * end].decode("utf-16-le") == "went"
    assert span_of(reply, "WENT") == span
    assert span_of(reply, "gone") is None


# ------------------------------------------------------------------------- the Claude adapter


class _Messages:
    def __init__(self, response: Any) -> None:
        self.response = response
        self.kwargs: dict[str, Any] = {}

    async def create(self, **kwargs: Any) -> Any:
        self.kwargs = kwargs
        return self.response


def _partner(text: str, stop_reason: str) -> tuple[ClaudePartner, _Messages]:
    partner = ClaudePartner(
        api_key="test", model="claude-opus-5-5", effort="low", timeout_s=5, fallbacks=False
    )
    usage = SimpleNamespace(
        input_tokens=120, output_tokens=30, cache_read_input_tokens=0, cache_creation_input_tokens=0
    )
    messages = _Messages(
        SimpleNamespace(
            content=[SimpleNamespace(type="text", text=text)],
            stop_reason=stop_reason,
            usage=usage,
        )
    )
    partner._client = SimpleNamespace(beta=SimpleNamespace(messages=messages))  # type: ignore[assignment]
    return partner, messages


async def test_a_well_formed_reply_is_parsed() -> None:
    partner, messages = _partner(
        '{"reply": "Hi! How are you?", "recasts": [], "subgoals_met": ["g1"], "off_limits": false}',
        "end_turn",
    )
    turn = await partner.respond(system="s", history=[Exchange("learner", "Hello")])
    assert not turn.refused
    assert turn.turn.reply == "Hi! How are you?"
    assert turn.turn.subgoals_met == ["g1"]
    assert messages.kwargs["output_config"]["format"] == OUTPUT_FORMAT


@pytest.mark.parametrize(
    ("text", "stop_reason"),
    [
        ('{"reply": "Oh, you went to', "refusal"),  # refused after some output
        ('{"reply": "Oh, you went to the baz', "max_tokens"),  # cut off
        ("not json at all", "end_turn"),
        ('{"reply": "Hi"}', "end_turn"),  # does not fit the schema
    ],
)
async def test_refusals_and_broken_replies_are_refusals_with_their_tokens(
    text: str, stop_reason: str
) -> None:
    partner, _ = _partner(text, stop_reason)
    turn = await partner.respond(system="s", history=[Exchange("learner", "Hello")])
    assert turn.refused
    assert turn.input_tokens == 120
    assert turn.output_tokens == 30


async def test_an_empty_message_is_never_sent_and_the_note_comes_last() -> None:
    partner, messages = _partner(
        '{"reply": "x", "recasts": [], "subgoals_met": [], "off_limits": false}', "end_turn"
    )
    await partner.respond(
        system="s",
        history=[Exchange("character", "  "), Exchange("learner", "Hello")],
        note="simpler, please",
    )
    sent = messages.kwargs["messages"]
    assert all(m["content"].strip() for m in sent)
    assert sent[-1] == {"role": "system", "content": "simpler, please"}
    assert sent[-2]["role"] == "user"
