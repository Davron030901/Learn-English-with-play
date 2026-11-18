# ruff: noqa: RUF001 — IPA symbols are the point of these tests
"""Pronunciation policy and audio QC (backend brief Phase 8)."""

from __future__ import annotations

import math

import pytest

from app.domain import audio_qc
from app.domain.pronunciation import Measurement, Phone, Word, judge, phonology_band, word_score


def _sine(amplitude: float, seconds: float = 3.0, hz: float = 997.0) -> list[float]:
    n = int(seconds * audio_qc.SAMPLE_RATE)
    return [amplitude * math.sin(2 * math.pi * hz * i / audio_qc.SAMPLE_RATE) for i in range(n)]


# ------------------------------------------------------------------- loudness (BS.1770-4)


def test_a_full_scale_997_hz_sine_reads_minus_3_lufs() -> None:
    """The standard's own calibration point: 0 dBFS at 997 Hz on one channel is -3.01 LUFS."""
    assert audio_qc.integrated_loudness(_sine(1.0)) == pytest.approx(-3.01, abs=0.1)


def test_a_master_at_minus_16_lufs_passes_qc() -> None:
    amplitude = 10 ** ((-16 + 3.01) / 20)
    report = audio_qc.check(_sine(amplitude), rate=48_000, channels=1, encoded_bytes=40_000)
    assert report.loudness_lufs == pytest.approx(-16, abs=0.2)
    assert report.passed, report.problems


def test_qc_rejects_what_the_targets_forbid() -> None:
    loud = audio_qc.check(_sine(0.9), rate=48_000, channels=1)
    assert any(p.startswith("loudness") for p in loud.problems)
    clipped = audio_qc.check([*_sine(0.22), 1.0], rate=48_000, channels=1)
    assert "clipping" in clipped.problems
    padded = audio_qc.check(
        [0.0] * 30_000 + _sine(0.2244) + [0.0] * 30_000, rate=48_000, channels=1
    )
    assert "silence not trimmed" in padded.problems
    stereo = audio_qc.check(_sine(0.2244), rate=44_100, channels=2, encoded_bytes=90_000)
    assert len(stereo.problems) >= 3
    assert audio_qc.integrated_loudness([0.0] * 48_000) == -math.inf


# ------------------------------------------------------------------- pronunciation


def _word(text: str, *phones: Phone, stress: tuple[int | None, int | None] = (None, None)) -> Word:
    return Word(text, phones, stress[0], stress[1])


def test_an_accented_but_right_phoneme_is_not_an_error() -> None:
    # a trilled /r/ the aligner rates low but recognises as /r/
    accented = _word(
        "red",
        Phone("r", "r", 35, contrastive=True, substituted=False),
        Phone("e", "e", 90),
        Phone("d", "d", 88),
    )
    assert word_score(accented) >= 70
    m = Measurement((accented,), independent_wer=0.0, transcript="red")
    assert judge(m, "B1").passed is True
    assert judge(m, "B1").notes == ()


def test_a_substituted_contrastive_phoneme_fails_and_is_named() -> None:
    ship = _word(
        "ship",
        Phone("ʃ", "ʃ", 90),
        Phone("ɪ", "iː", 10, contrastive=True, substituted=True),
        Phone("p", "p", 90),
    )
    m = Measurement((ship,), independent_wer=1.0, transcript="sheep")
    verdict = judge(m, "A2")
    assert verdict.passed is False
    assert verdict.notes == ("In 'ship', /ɪ/ sounded like /iː/.",)


def test_at_most_two_notes_and_one_headline() -> None:
    words = tuple(
        _word(w, Phone("θ", "s", 5, contrastive=True, substituted=True), stress=(0, 1))
        for w in ("think", "thank", "three", "thing")
    )
    verdict = judge(Measurement(words, independent_wer=0.5, transcript="sink sank tree sing"), "B1")
    assert len(verdict.notes) <= 2
    assert 0 <= verdict.headline <= 100
    assert len(verdict.word_scores) == 4


def test_the_bar_rises_with_the_level() -> None:
    w = _word(
        "cat",
        Phone("k", "k", 62),
        Phone("æ", "æ", 62, contrastive=True, substituted=True),
        Phone("t", "t", 62),
    )
    m = Measurement((w,), independent_wer=0.12, transcript="cat")
    assert judge(m, "B1").passed is True
    assert judge(m, "C1").passed is False


def test_phonology_band() -> None:
    assert phonology_band(0) == 1
    assert phonology_band(100) == 6
    assert phonology_band(50) == 3.5


# ------------------------------------------------------------------- regressions from review


def test_an_accented_learner_who_says_every_phoneme_right_passes_at_c1_and_c2() -> None:
    think = _word("think", *(Phone(x, x, 35, contrastive=True) for x in ("θ", "ɪ", "ŋ", "k")))
    m = Measurement((think,), independent_wer=0.0, transcript="think")
    for level in ("A1", "B2", "C1", "C2"):
        assert judge(m, level).passed is True, level


def test_one_contrastive_substitution_fails_the_sentence_it_is_not_averaged_away() -> None:
    good = [_word(w, Phone("x", "x", 90)) for w in ("I", "saw", "a", "big")]
    ship = _word(
        "ship", Phone("ʃ", "ʃ", 90), Phone("ɪ", "iː", 10, contrastive=True, substituted=True)
    )
    verdict = judge(
        Measurement((*good, ship), independent_wer=0.2, transcript="I saw a big sheep"), "A2"
    )
    assert verdict.passed is False
    assert verdict.notes == ("In 'ship', /ɪ/ sounded like /iː/.",)


def test_free_speech_is_judged_on_intelligibility_only() -> None:
    m = Measurement((), independent_wer=0.05, transcript="I like my city because it is green")
    verdict = judge(m, "C1", free=True)
    assert verdict.headline == 95
    assert verdict.passed is True
    assert verdict.word_scores == ()
    # a C2 speaker understood every time can reach the top phonology band
    assert phonology_band(judge(Measurement((), 0.0, "x"), "C2", free=True).headline) == 6
