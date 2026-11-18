"""The level-exam report's pure parts (docs/12 §9.2, §9.3)."""

from __future__ import annotations

from app.domain.exam_report import (
    NEXT_LEVEL,
    READING_WPM,
    SPEECH_WPM,
    Answer,
    band,
    error_types,
    kind_of,
    papers,
    target_of,
    timeline,
    work_on,
)
from app.domain.level_award import EXAM_PASS


def _a(item: str, paper: str, correct: bool, *memory: str, rt: int = 4_000) -> Answer:
    return Answer(item, paper, correct, rt, memory)


def test_bands_follow_the_pass_standard() -> None:
    assert band(0.85, "A1") == "secure"
    assert band(0.80, "A1") == "pass"
    assert band(0.75, "A1") == "pass"
    assert band(0.60, "A1") == "borderline"
    assert band(0.59, "A1") == "below"
    assert band(0.80, "C2") == "pass", "C2 asks 80 % overall and 70 % a paper"
    assert band(0.70, "C2") == "borderline"
    assert band(0.69, "C2") == "below"


def test_papers_count_the_unanswered_as_asked_and_time_only_answers() -> None:
    asked = {"reading": ["r1", "r2", "r3", "r4"], "listening": ["l1", "l2"], "empty": []}
    answers = [
        _a("r1", "reading", True, rt=2_000),
        _a("r2", "reading", True, rt=4_000),
        _a("r3", "reading", False, rt=9_000),
    ]
    out = {p.paper: p for p in papers("A1", asked, answers)}
    assert set(out) == {"reading", "listening"}
    assert (out["reading"].score, out["reading"].answered, out["reading"].correct) == (0.5, 3, 2)
    assert out["reading"].median_seconds == 4.0
    assert out["reading"].band == "below"
    assert out["listening"].median_seconds is None
    assert (out["listening"].paper_bar, out["listening"].overall_bar) == EXAM_PASS["A1"][::-1]


def test_error_types_count_each_kind_once_per_item() -> None:
    answers = [
        _a("1", "reading", False, "lex.00001.recog", "lex.00002.recog", "G-001.form"),
        _a("2", "reading", True, "G-001.form"),
        _a("3", "listening", False, "txt.S01U01.comp"),
        _a("4", "reading", False, "unknown.x"),
    ]
    got = {e.kind: (e.asked, e.wrong) for e in error_types(answers)}
    assert got == {"vocabulary": (1, 1), "grammar": (2, 1), "comprehension": (1, 1)}


def test_work_on_ranks_the_most_wrong_then_the_syllabus_and_stops_at_five() -> None:
    answers = [
        _a("1", "r", False, "G-002.form"),
        _a("2", "r", False, "G-002.form"),
        _a("3", "r", False, "lex.00009.recog"),
        _a("4", "r", False, "lex.00003.recog"),
        _a("5", "r", True, "lex.00003.recog"),
        _a("6", "r", False, "F-010.use"),
        _a("7", "r", False, "P-001.disc"),
        _a("8", "r", False, "P-002.disc"),
        _a("9", "r", False, "txt.S01U01.comp"),
        _a("10", "r", True, "G-003.form"),
    ]
    order = {"lex.00009": 0, "lex.00003": 1, "F-010": 2, "P-001": 3, "P-002": 4, "G-002": 9}
    got = work_on(answers, order)
    assert [w.target for w in got] == ["G-002", "lex.00009", "F-010", "P-001", "P-002"]
    assert got[0].wrong == 2
    assert all(w.kind != "comprehension" for w in got), "a story is not a target to drill"


def test_the_timeline_is_the_learners_own_pace_or_none() -> None:
    assert timeline("C2", 0, 3).reason == "top_level"
    stalled = timeline("A1", 12, 0)
    assert (stalled.next_level, stalled.weeks, stalled.reason) == ("A2", None, "no_pace")
    steady = timeline("A1", 12, 8)  # 8 units in 4 weeks = 2 a week
    assert (steady.units_per_week, steady.weeks, steady.reason) == (2.0, 6, "")
    there = timeline("B1", 0, 0)
    assert (there.weeks, there.reason) == (0, "")


def test_ids_and_tables() -> None:
    assert kind_of("lex.00001.recog") == "vocabulary"
    assert kind_of("G-075.form") == "grammar"
    assert kind_of("F-048.use") == "function"
    assert kind_of("P-032.disc") == "pronunciation"
    assert kind_of("txt.S01U01.comp") == "comprehension"
    assert kind_of("other") is None
    assert target_of("G-075.form") == "G-075"
    assert target_of("plain") == "plain"
    assert set(READING_WPM) == set(SPEECH_WPM) == set(NEXT_LEVEL) == set(EXAM_PASS)
