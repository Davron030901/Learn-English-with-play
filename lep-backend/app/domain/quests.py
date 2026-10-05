"""Daily (3) and weekly (2) quests, generated from what the scheduler wants anyway (docs/10 §10,
docs/16 E10, E18). Pure and deterministic: the same learner on the same day always gets the
same quests, so a quest never changes under the learner's feet and never needs storing to be
known.

Targets scale with the learner's own daily goal (5/10/20/40 minutes): a five-minute learner is
never handed a forty-minute quest. No quest has a countdown, and none can be bought.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Final

#: metric → (title in en, uz, ru) — {n} is the target
DAILY_TEMPLATES: Final[dict[str, tuple[int, str, str, str]]] = {
    # metric: (base target at a 10-minute goal, en, uz, ru)
    "answers": (
        20,
        "Answer {n} questions",
        "{n} ta savolga javob bering",
        "Ответьте на {n} вопросов",
    ),
    "correct": (
        15,
        "Get {n} answers right",
        "{n} ta to'g'ri javob bering",
        "Дайте {n} правильных ответов",
    ),
    "best_run": (
        8,
        "Get {n} right in a row",
        "Ketma-ket {n} ta to'g'ri javob",
        "{n} правильных подряд",
    ),
    "speaking": (3, "Speak {n} times", "{n} marta gapiring", "Говорите {n} раза"),
    "listening": (
        5,
        "Do {n} listening exercises",
        "{n} ta tinglash mashqi",
        "{n} упражнений на слух",
    ),
    "reviewed_due": (
        10,
        "Water {n} wilting words",
        "{n} ta so'lgan so'zni sug'oring",
        "Полейте {n} увядающих слов",
    ),
    "xp": (30, "Earn {n} XP", "{n} XP to'plang", "Заработайте {n} XP"),
}
WEEKLY_TEMPLATES: Final[dict[str, tuple[int, str, str, str]]] = {
    "xp": (
        200,
        "Earn {n} XP this week",
        "Bu hafta {n} XP to'plang",
        "Заработайте {n} XP за неделю",
    ),
    "active_days": (
        5,
        "Learn on {n} days this week",
        "Bu hafta {n} kun o'qing",
        "Занимайтесь {n} дней на этой неделе",
    ),
    "nodes": (
        6,
        "Finish {n} lessons this week",
        "Bu hafta {n} ta darsni tugating",
        "Пройдите {n} уроков за неделю",
    ),
}
#: Targets scale with the daily goal; active days do not.
GOAL_SCALE: Final[dict[int, float]] = {5: 0.5, 10: 1.0, 20: 1.5, 40: 2.0}
UNSCALED: Final = frozenset({"best_run", "active_days"})
DAILY_COUNT: Final = 3
WEEKLY_COUNT: Final = 2
QUEST_GEMS: Final = 15  # docs/10 §9


@dataclass(frozen=True, slots=True)
class Quest:
    period: str  # "day" or "week"
    period_start: date
    slot: int
    metric: str
    target: int
    title: dict[str, str]


def week_start(day: date) -> date:
    """Weeks start on Monday (ISO)."""
    return day - timedelta(days=day.isoweekday() - 1)


def _rank(key: str) -> int:
    return int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], "big")


def _target(metric: str, base: int, daily_goal_min: int) -> int:
    if metric in UNSCALED:
        return base
    return max(1, round(base * GOAL_SCALE.get(daily_goal_min, 1.0)))


def _make(
    templates: dict[str, tuple[int, str, str, str]],
    period: str,
    start: date,
    count: int,
    learner_id: str,
    daily_goal_min: int,
    exclude: frozenset[str],
) -> list[Quest]:
    metrics = sorted(
        (m for m in templates if m not in exclude),
        key=lambda m: _rank(f"{learner_id}:{period}:{start.isoformat()}:{m}"),
    )[:count]
    out: list[Quest] = []
    for slot, m in enumerate(sorted(metrics)):
        base, en, uz, ru = templates[m]
        n = _target(m, base, daily_goal_min)
        out.append(
            Quest(
                period=period,
                period_start=start,
                slot=slot,
                metric=m,
                target=n,
                title={"en": en.format(n=n), "uz": uz.format(n=n), "ru": ru.format(n=n)},
            )
        )
    return out


def daily_quests(
    learner_id: str, day: date, daily_goal_min: int, *, can_speak: bool = True
) -> list[Quest]:
    """Three quests for the learner's local day. Speaking is never required of a learner who
    practises without a microphone (docs/10 §12)."""
    exclude = frozenset() if can_speak else frozenset({"speaking"})
    return _make(DAILY_TEMPLATES, "day", day, DAILY_COUNT, learner_id, daily_goal_min, exclude)


def weekly_quests(learner_id: str, day: date, daily_goal_min: int) -> list[Quest]:
    return _make(
        WEEKLY_TEMPLATES,
        "week",
        week_start(day),
        WEEKLY_COUNT,
        learner_id,
        daily_goal_min,
        frozenset(),
    )
