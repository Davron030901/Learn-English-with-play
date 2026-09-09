# Content repository — Learn English with Play

This is the **content-as-code** repository described in `docs/11-CONTENT-DATA-MODEL.md`.
Hand-authored sources live under `content/`; everything under `build/` is generated
and should never be edited by hand.

```
content/
  schemas/      JSON Schemas — the contract for every content object
  syllabus/     grammar-a1.json (74 points) · phonology-a1.json (30) · functions-a1.json (42)
  lexemes/      src-*.json — the compact lexeme sources (800 A1 lexemes)
  units/        spec-s01.json — the unit specification for Section 1
  texts/        stories-s01.json (12 episodes) · story-questions-s01.json
tools/
  build_lexemes.py   compact sources        -> build/lexemes.json
  build_units.py     unit spec + lexicon    -> build/units/*.json
  build_items.py     all of the above       -> build/items/*.json
  validate.py        the CI gates (docs/11 §5) — exit 1 blocks a merge
  report.py          build/BUILD-REPORT.md
build/            generated; safe to delete and rebuild
build.sh          runs the whole pipeline
```

Run everything with `./build.sh`.

---

## Why the sources look the way they do

**Lexemes are authored in a compact format, not in the full schema.** One line per
lexeme — lemma, POS, IPA, Uzbek and Russian gloss, two examples, collocations, topic
tags, frequency band, plus flags for countability, irregular forms, chunks, false-friend
warnings and interference partners. `build_lexemes.py` expands each line into the full
record from `docs/04-LEXIS-SPEC.md §11`: ids, syllable count, stress position, inflected
forms, audio paths, and the cross-links. Authors edit 40 characters, not 40 lines.

**Units are specified, not written.** `spec-s01.json` says what a unit teaches — title,
theme, can-do statements, grammar/phonology/function ids, the five authored lesson
titles. `build_units.py` lays out the eight nodes, assigns each syllabus item exactly
one home node (so nothing is triple-taught), pulls the unit's lexemes from the index,
and computes the tier times.

**Items are generated from the syllabus, then filtered.** `build_items.py` holds one
template per exercise type. Every generated item is checked against the vocabulary
available at its unit before it is kept; anything that would show the learner an
untaught word is dropped and counted. That filter is what keeps a generated bank
honest, and its drop list is the authoring backlog.

---

## The rules the pipeline enforces

| Rule | Where | Effect |
|---|---|---|
| **Vocabulary gate** (`docs/00 §4.2`) | generator + `validate.py` | An item may not show a word taught later than its unit. Phonology items, taught chunks and function exponents are exempt — there the word is a vehicle for a sound or a formula and is glossed on screen. |
| **One home node per syllabus item** | `build_units.py` | Prevents the same grammar point generating three near-identical sets of items. |
| **Interference separation** (`docs/08 §8`) | `build_units.py` + distractor picker | `he/she`, `in/on`, `big/small`, `teach/learn` and 113 other pairs are never introduced in the same node. The interference partner is **withheld** from distractors at tiers 1-2 and **deliberately used** at tier 3 — acquisition first, discrimination after. |
| **Tier shape** (`docs/08 §4.3`) | generator | Tier 1 recognition-led, tier 2 recall, tier 3 production and timed. |
| **Interleaving** (`docs/07 §2.4`) | generator | No two adjacent items of the same exercise type; no run of three on one target, except in single-target clinic nodes. |
| **Deterministic builds** | `random.seed(20260908)` | The same sources always produce the same item ids, so a rebuild is a clean diff. |
| **Answer normalisation** (`docs/09 §5`) | item records | Every typed answer carries its normalisation flags; US and UK spellings are always both accepted; one-character typos are forgiven except in spelling exercises. |

---

## Adding the next section

1. Add the unit spec to `content/units/spec-s02.json` (same shape as `spec-s01.json`).
2. Write the story episodes and their comprehension questions.
3. `./build.sh` — the 400 Section 2 lexemes are already in `content/lexemes/`.
4. Fix whatever the gates report, then commit.

The pipeline is section-agnostic; nothing above assumes Section 1.

---

## Current state

See `build/BUILD-REPORT.md` — regenerated on every build. In short: the full A1
lexicon (800 lexemes) plus Section 1 built end-to-end into **2,661 exercise items**
across 12 units, 96 nodes and 3 mastery tiers, with all blocking gates passing and
19 warnings recorded as the authoring backlog.
