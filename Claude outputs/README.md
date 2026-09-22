# Learn English with Play — Curriculum & Product Specification

A complete, buildable specification for a gamified English course that takes a learner from **zero to CEFR C2**.

Written as a working syllabus hand-over: every linguistic item the learner must acquire is enumerated, every item is tagged to a level, every level has measurable exit criteria, and every exit criterion has an assessment that produces it.

## The documents    

| # | File | What it fixes |
|---|------|---------------|
| 00 | [`docs/00-MASTER-SPEC.md`](docs/00-MASTER-SPEC.md) | Product thesis, scope, level map, hour budget, global content rules, glossary |
| 01 | [`docs/01-CEFR-LEVEL-ARCHITECTURE.md`](docs/01-CEFR-LEVEL-ARCHITECTURE.md) | 10 sections, sub-level descriptors, can-do statements, exit gates, external-exam mapping |
| 02 | [`docs/02-PHONOLOGY-SPEC.md`](docs/02-PHONOLOGY-SPEC.md) | Full sound system: 24 consonants, 17 vowels, allophony, stress, weak forms, connected speech, intonation, phonics, 165 minimal-pair sets, pronunciation scoring |
| 03 | [`docs/03-GRAMMAR-SYLLABUS.md`](docs/03-GRAMMAR-SYLLABUS.md) | All **412** grammar points G-001→G-412, A1→C2, with sequencing rules, 34 contrast clinics, 180 irregular verbs |
| 04 | [`docs/04-LEXIS-SPEC.md`](docs/04-LEXIS-SPEC.md) | 12,000 productive / 20,000+ receptive lexemes, coverage maths, collocation, 300 phrasal verbs, 800 idioms, word formation, near-synonym sets |
| 05 | [`docs/05-FUNCTIONS-NOTIONS-PRAGMATICS.md`](docs/05-FUNCTIONS-NOTIONS-PRAGMATICS.md) | 320 communicative functions with ranked exponents, notions, discourse competence, register, politeness, mediation |
| 06 | [`docs/06-SKILLS-SPEC.md`](docs/06-SKILLS-SPEC.md) | Listening / reading / speaking / writing / mediation with exact text-length, speed and accuracy parameters per level; the Immersion Engine |
| 07 | [`docs/07-PEDAGOGY-ENGINE.md`](docs/07-PEDAGOGY-ENGINE.md) | The learning science stated as product requirements: retrieval, spacing, interleaving, error treatment, fossilisation prevention, motivation |
| 08 | [`docs/08-SRS-MASTERY-ALGORITHM.md`](docs/08-SRS-MASTERY-ALGORITHM.md) | FSRS-6 memory model with formulas, item states, session composition, leech handling, knowledge tracing |
| 09 | [`docs/09-EXERCISE-TYPE-CATALOGUE.md`](docs/09-EXERCISE-TYPE-CATALOGUE.md) | All **71** exercise types with inputs, scoring, level ranges, authoring and answer-normalisation rules |
| 10 | [`docs/10-GAMIFICATION-SPEC.md`](docs/10-GAMIFICATION-SPEC.md) | XP, streaks, leagues, quests, economy, onboarding — and the ethical guardrails, incl. a reasoned position on Duolingo's current Energy system |
| 11 | [`docs/11-CONTENT-DATA-MODEL.md`](docs/11-CONTENT-DATA-MODEL.md) | JSON schemas, ID conventions, storage, the content pipeline and 20 automated CI validation gates |
| 12 | [`docs/12-ASSESSMENT-SPEC.md`](docs/12-ASSESSMENT-SPEC.md) | Placement CAT, checkpoints, six level exams, writing/speaking/mediation rubrics, automatic scoring, validity and fairness requirements |
| 13 | [`docs/13-COURSE-MAP.md`](docs/13-COURSE-MAP.md) | Unit-by-unit scope and sequence for all **168 units / 1,344 nodes** |
| 14 | [`docs/14-L1-UZBEK-CONTRASTIVE.md`](docs/14-L1-UZBEK-CONTRASTIVE.md) | Uzbek/Russian → English transfer errors, false friends, pragmatic differences, difficulty weightings, and 11 other L1 profiles |
| 15 | [`docs/15-PRODUCTION-ROADMAP.md`](docs/15-PRODUCTION-ROADMAP.md) | Content volume maths (~31,550 person-hours), team, build/buy, 5-phase plan, KPIs, risk register, first 30 days |

**Reading order for a new team member:** 00 → 01 → 13 → 09 → 11.

## The headline numbers

| | |
|---|---|
| Sections / units / nodes | 10 / 168 / 1,344 |
| Lesson plays (3 mastery tiers per node) | 4,032 |
| Unique exercise items to author | ~48,000 |
| Grammar points | 412 |
| Lexemes | 12,000 productive · 20,000+ receptive |
| Exercise types | 71 |
| Communicative functions | 320 |
| Hours to C2 (guided + self-directed) | ~1,200 |
| Build estimate for the full course | 3–4 years · ~20 person-years of content |

## The three design commitments

1. **Two engines.** A tapping tree alone plateaus at B1. The Structured Engine (lessons + SRS) dominates at A1–A2; the Immersion Engine (reading, listening, speaking, writing at volume) dominates at B2–C2. The share shifts by level as a product requirement, not a suggestion.
2. **The scheduler is the product.** FSRS-6, one memory item per aspect of knowing a word, mastery measured by the *weakest* aspect — not the strongest.
3. **Honest numbers.** Every figure shown to a learner must survive a surprise retention audit. The app tells learners how long C2 actually takes, before they pay.

---

*Specification v1.0 — baseline. Syllabus item IDs are immutable once shipped; see `docs/00-MASTER-SPEC.md` §9 for change control.*
