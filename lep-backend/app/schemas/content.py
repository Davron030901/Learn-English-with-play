"""Course content responses (brief §12: GET /v1/course, GET /v1/units/{unit_id}).

The endpoints send pre-serialised bytes from the catalog; these models are the documented
shape (the OpenAPI document the app's client is generated from). ``prompt``, ``answer``,
``feedback`` and ``constraints`` keep the build's per-type keys (backend brief §7.3) and are
documented as objects.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

NodeKind = Literal["lesson", "story", "speak", "immersion", "review"]


class Instruction(BaseModel):
    en: str
    uz: str | None = None


class CourseTotals(BaseModel):
    sections: int
    units: int
    nodes: int
    node_tiers: int = Field(description="Populated node-tiers (lesson plays).")
    items: int
    lexemes: int
    stories: int
    memory_items: int


class StoryRef(BaseModel):
    id: str
    title: str


class NodeOutline(BaseModel):
    id: str
    position: int = Field(ge=1, le=8)
    kind: NodeKind
    focus: str | None
    title: str
    tier_counts: dict[str, int] = Field(description="Items per populated tier, keyed '1'…'3'.")


class UnitOutline(BaseModel):
    id: str
    section_id: str
    n: int
    cefr: str
    title: dict[str, str]
    can_do: list[str]
    minutes: dict[str, float]
    lexeme_count: int
    grammar_count: int
    item_count: int
    story: StoryRef
    nodes: list[NodeOutline]


class SectionOut(BaseModel):
    id: str
    cefr: str
    units: list[UnitOutline]


class CourseOut(BaseModel):
    content_version: str = Field(
        description="Hash of the content served; the app sends it with every answer."
    )
    totals: CourseTotals
    instructions: dict[str, Instruction]
    sections: list[SectionOut]


class ItemOut(BaseModel):
    id: str
    type_id: str
    unit_id: str
    node_id: str
    tier: int = Field(ge=1, le=3)
    instruction_key: str
    targets: dict[str, list[str]]
    memory_items: list[str] = Field(
        description="One review-log row per entry (backend brief §3.2)."
    )
    prompt: dict[str, Any]
    answer: dict[str, Any]
    feedback: dict[str, Any]
    constraints: dict[str, Any]
    say: str | None


class NodeOut(BaseModel):
    id: str
    position: int = Field(ge=1, le=8)
    kind: NodeKind
    focus: str | None
    title: str
    tiers: dict[str, list[ItemOut]]


class LexemeOut(BaseModel):
    id: str
    lemma: str
    pos: str
    ipa: str
    gloss: dict[str, str]
    examples: list[str]
    unit_id: str
    definition_en: str | None = Field(description="Null for most lexemes below B2 (brief §14.4).")


class UnitOut(BaseModel):
    content_version: str
    id: str
    section_id: str
    n: int
    cefr: str
    title: dict[str, str]
    can_do: list[str]
    minutes: dict[str, float]
    nodes: list[NodeOut]
    lexemes: list[LexemeOut]
    grammar: list[dict[str, Any]]
    phonology: list[dict[str, Any]]
    functions: list[dict[str, Any]]
    story: dict[str, Any]
