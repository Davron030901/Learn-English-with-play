"""Accessibility profiles (docs/00 §6; backend brief §13: "the scheduler must respect an
accessibility profile when selecting exercise types"). Pure: no I/O.

No exercise type may be the only route to an item: a learner who cannot hear needs a non-audio
path to every syllabus item, a learner who cannot see a non-visual one. The app presents every
type in a form the profile allows where one exists (frontend ``src/a11y/profile.ts``, the same
table); the server's part is to *choose* well:

* a type with no form for the profile is never chosen, and a lesson item of that type is left
  out of the plan and reported, not shown;
* a type the profile can only meet through a degraded route (a listening item read from its
  transcript, a visual game turned into a list) is chosen only when no other exercise reviews
  the same memory item;
* a node-tier is passed on the share of the items the profile can be shown.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from typing import Final


@dataclass(frozen=True, slots=True)
class A11yProfile:
    no_audio: bool = False
    no_vision: bool = False

    @property
    def any(self) -> bool:
        return self.no_audio or self.no_vision


NO_PROFILE: Final = A11yProfile()

#: No text route tests the same thing: left out without audio. The phonology points they
#: practise stay reachable through their explanation and ``stress_tap``.
EXCLUDED_WITHOUT_AUDIO: Final = frozenset({"minimal_pair_discrimination", "phoneme_id"})

#: Without audio these are answered from the transcript or shown as a copy task — a route, but a
#: weaker one; another exercise for the same memory item is preferred.
TEXT_ROUTE_WITHOUT_AUDIO: Final = frozenset(
    {
        "dictation_word",
        "dictation_sentence",
        "spelling_bee",
        "listen_gist_mcq",
        "listen_detail_gap",
        "listen_order_events",
    }
)

#: Without vision the visual-memory game and the timed race become a plain list; another
#: exercise for the same memory item is preferred.
LIST_ROUTE_WITHOUT_VISION: Final = frozenset({"memory_match", "word_race"})


def presentable(type_id: str, profile: A11yProfile) -> bool:
    """Can this exercise type be shown to a learner with this profile at all?"""
    return not (profile.no_audio and type_id in EXCLUDED_WITHOUT_AUDIO)


def degraded(type_id: str, profile: A11yProfile) -> bool:
    """Shown only through a weaker route for this profile."""
    return (profile.no_audio and type_id in TEXT_ROUTE_WITHOUT_AUDIO) or (
        profile.no_vision and type_id in LIST_ROUTE_WITHOUT_VISION
    )


def preferred[T](
    candidates: Iterable[T], type_of: Callable[[T], str], profile: A11yProfile
) -> list[T]:
    """The candidates the profile can be shown, full routes first, each group in its order."""
    shown = [c for c in candidates if presentable(type_of(c), profile)]
    if not profile.any:
        return shown
    return [c for c in shown if not degraded(type_of(c), profile)] + [
        c for c in shown if degraded(type_of(c), profile)
    ]


def shown_items(item_types: Sequence[tuple[str, str]], profile: A11yProfile) -> list[str]:
    """The ids of ``(item_id, type_id)`` pairs the profile can be shown, in order."""
    return [i for i, t in item_types if presentable(t, profile)]


__all__ = [
    "EXCLUDED_WITHOUT_AUDIO",
    "LIST_ROUTE_WITHOUT_VISION",
    "NO_PROFILE",
    "TEXT_ROUTE_WITHOUT_AUDIO",
    "A11yProfile",
    "degraded",
    "preferred",
    "presentable",
    "shown_items",
]
