# 00 — MASTER SPECIFICATION
## "Learn English with Play" — Complete Curriculum & Product Requirements, A0 → C2

**Document owner:** Curriculum Architecture
**Version:** 1.0
**Status:** Baseline specification — all other documents in `/docs` derive from this one.
**Audience:** Product managers, content authors, curriculum designers, backend and mobile engineers, ML engineers, QA.

---

## 0. How to read this specification

This is written the way a syllabus designer with a career behind them would hand a course over to a build team: nothing is left as "the teacher will figure it out." Every linguistic item the learner must acquire is enumerated somewhere in these documents, every item is tagged to a level, every level has measurable exit criteria, and every exit criterion has an assessment that produces it.

The document set:

| # | File | What it fixes |
|---|------|---------------|
| 00 | `00-MASTER-SPEC.md` | Product thesis, scope, level map, hour budget, global rules, glossary |
| 01 | `01-CEFR-LEVEL-ARCHITECTURE.md` | The 10 sections, sub-level descriptors, can-do statements, exit gates |
| 02 | `02-PHONOLOGY-SPEC.md` | Full sound system: phonemes, allophones, prosody, connected speech, per-level order |
| 03 | `03-GRAMMAR-SYLLABUS.md` | Every grammatical structure, A1→C2, with sequencing rules |
| 04 | `04-LEXIS-SPEC.md` | Vocabulary sizes, frequency bands, collocation, phrasal verbs, idiom, word-formation |
| 05 | `05-FUNCTIONS-NOTIONS-PRAGMATICS.md` | Speech acts, notions, register, discourse markers, politeness |
| 06 | `06-SKILLS-SPEC.md` | Listening, reading, speaking, writing, mediation — with text-length and speed parameters |
| 07 | `07-PEDAGOGY-ENGINE.md` | The learning science the app is obliged to implement |
| 08 | `08-SRS-MASTERY-ALGORITHM.md` | Memory model, scheduling maths, mastery states, forgetting handling |
| 09 | `09-EXERCISE-TYPE-CATALOGUE.md` | All 71 exercise types, their inputs, scoring and level ranges |
| 10 | `10-GAMIFICATION-SPEC.md` | Motivation layer, economy, streaks, leagues, ethics guardrails |
| 11 | `11-CONTENT-DATA-MODEL.md` | JSON schemas, IDs, content pipeline, QA gates |
| 12 | `12-ASSESSMENT-SPEC.md` | Placement CAT, checkpoints, level exams, rubrics, external-exam alignment |
| 13 | `13-COURSE-MAP.md` | Unit-by-unit scope and sequence for all 168 units |
| 14 | `14-L1-UZBEK-CONTRASTIVE.md` | Predicted L1 interference for Uzbek/Russian speakers and its remediation |
| 15 | `15-PRODUCTION-ROADMAP.md` | Content volume maths, team, tooling, MVP→v1, KPIs |

**Reading order for a new team member:** 00 → 01 → 13 → 09 → 11. Everything else is reference.

---

## 1. Product thesis

### 1.1 What the product is

A gamified, mobile-first, adaptive English course that takes a learner with **zero English** to **CEFR C2** through play — but that is honest about what play alone can and cannot do.

### 1.2 The one non-negotiable design truth

A tapping-based exercise tree, on its own, plateaus at roughly **B1**. This is not an opinion; it follows from three facts:

1. **Recognition ≠ production.** Word-bank and multiple-choice exercises test recognition memory. Free production requires retrieval without cues. A course made only of cued exercises trains a competence that collapses in real conversation.
2. **Input volume.** Reaching B2 requires reading and hearing on the order of a million running words of English. No tree of 5-minute lessons delivers that volume.
3. **Interaction.** C-level competence is defined largely by *interaction and mediation* descriptors — turn-taking, repair, hedging, register-shifting. These cannot be assessed by a right/wrong tap.

**Therefore the architecture has two engines, and the balance between them shifts as the learner rises:**

| | **Structured Engine** (the tree) | **Immersion Engine** (input + output) |
|---|---|---|
| What it does | Introduces and drills form: sounds, words, structures | Delivers volume, meaning-focused input, and free production |
| Dominant at | A1–A2 | B2–C2 |
| Content | Lessons, SRS, minimal pairs, transformation drills | Graded readers, podcasts, video, shadowing, writing tasks, AI roleplay, human conversation |

Share of learner time by level (this is a **product requirement**, not a suggestion):

| Level | Structured Engine | Immersion Engine |
|-------|------------------:|-----------------:|
| A1 | 70% | 30% |
| A2 | 65% | 35% |
| B1 | 55% | 45% |
| B2 | 45% | 55% |
| C1 | 35% | 65% |
| C2 | 25% | 75% |

If the app cannot yet build the Immersion Engine, it must **say so** and route the learner outward (recommend readers, podcasts, tutors). Claiming a C2 path without it is a false promise.

### 1.3 The three laws of this curriculum

1. **Nothing is taught that is not later retrieved.** Every introduced item enters the spaced-repetition graph. If it cannot be scheduled, it cannot be taught.
2. **Nothing is assessed that was not taught.** Every assessment item traces to a syllabus item ID.
3. **Meaning before form, form before fluency, fluency before accuracy polish.** Each item goes through: comprehension → controlled production → free production → automatisation.

---

## 2. Scope

### 2.1 Target variety

- **Primary model:** General American (GA) for audio and spelling defaults.
- **Secondary model, receptive from A2, productive optional from B1:** Standard Southern British English (SSBE).
- **Receptive exposure required from B1:** Scottish, Irish, Australian, Indian, Nigerian, Singaporean, and L2-accented English (Spanish-, Chinese-, Slavic-accented). Global English is the reality of use; a learner who can only parse one accent is not B2.
- **Spelling:** learner selects US or UK at onboarding; the content model stores both (`spelling.us`, `spelling.uk`) and never marks the other variant wrong.

### 2.2 Registers covered

Neutral/everyday (A1→), informal-spoken (A2→), transactional-service (A1→), semi-formal written (B1→), academic (B2→), professional/workplace (B1→), journalistic (B2→), literary (C1→), legal/technical-lite (C1→), dialectal & slang (receptive only, C1→).

### 2.3 Explicitly out of scope

- Teaching to a single exam as the primary goal (exam alignment is a *reporting* feature, see doc 12).
- Translation-as-method beyond A1 scaffolding.
- Regional dialect *production*.
- Specialist ESP corpora (medicine, aviation, maritime) — post-v1 modules.

---

## 3. Level map and hour budget

### 3.1 Sections

Ten sections, each mapping to a CEFR sub-level.

| Section | CEFR | Name | Units | Nodes | Est. learner hours (app) |
|--------:|:-----|------|------:|------:|-------------------------:|
| 1 | A1.1 | First Words | 12 | 96 | 35 |
| 2 | A1.2 | Everyday Basics | 12 | 96 | 35 |
| 3 | A2.1 | Getting Around | 14 | 112 | 32 |
| 4 | A2.2 | People & Plans | 14 | 112 | 33 |
| 5 | B1.1 | Opinions & Stories | 16 | 128 | 55 |
| 6 | B1.2 | Work & World | 16 | 128 | 55 |
| 7 | B2.1 | Argument & Nuance | 18 | 144 | 48 |
| 8 | B2.2 | Abstraction & Register | 18 | 144 | 47 |
| 9 | C1 | Precision & Idiom | 24 | 192 | 70 |
| 10 | C2 | Mastery & Style | 24 | 192 | 90 |
| **Total** | | | **168** | **1,344** | **500** |

- **Unit** = a thematically and grammatically coherent block, 8 nodes.
- **Node** = one playable screen on the path (a lesson, a story, a speaking task, a review).
- Each node has **3 mastery tiers** (Introduce / Consolidate / Stretch) → **4,032 lesson plays** on the core path.

### 3.2 Total hour budget to C2

Anchored to Cambridge English guided-learning-hour guidance (A1 ≈ 90–100 h cumulative; A2 ≈ 180–200; B1 ≈ 350–400; B2 ≈ 500–600; C1 ≈ 700–800; C2 ≈ 1,000–1,200).

| Level | New hours | Cumulative | In-app lessons | In-app SRS | Self-directed input/output |
|-------|----------:|-----------:|---------------:|-----------:|--------------------------:|
| A1 | 100 | 100 | 55 | 15 | 30 |
| A2 | 100 | 200 | 48 | 17 | 35 |
| B1 | 200 | 400 | 80 | 30 | 90 |
| B2 | 200 | 600 | 65 | 30 | 105 |
| C1 | 200 | 800 | 45 | 25 | 130 |
| C2 | 400 | 1,200 | 55 | 35 | 310 |
| **Total** | **1,200** | | **348** | **152** | **700** |

At a **20 min/day** habit: ~10 years. At **45 min/day**: ~4.4 years. At **90 min/day**: ~2.2 years.
The app must show this honestly in onboarding. A "C2 in 6 months" claim is a lie and destroys retention when the learner discovers it.

### 3.3 Volume targets for the Immersion Engine

| Level | Cumulative words read | Cumulative hours listened | Cumulative words written | Cumulative minutes spoken |
|-------|----------------------:|--------------------------:|-------------------------:|--------------------------:|
| A1 | 5,000 | 5 | 500 | 60 |
| A2 | 30,000 | 20 | 2,500 | 240 |
| B1 | 150,000 | 60 | 10,000 | 900 |
| B2 | 500,000 | 150 | 30,000 | 2,400 |
| C1 | 1,200,000 | 320 | 70,000 | 5,000 |
| C2 | 2,500,000+ | 600+ | 150,000+ | 10,000+ |

These are tracked as first-class learner statistics, not vanity metrics. They predict level attainment far better than streak length.

---

## 4. Global content rules

### 4.1 Rules every content item must satisfy

1. **No orphan items.** Every exercise references at least one syllabus item ID (`gram.*`, `lex.*`, `phon.*`, `func.*`).
2. **No untaught vocabulary.** An exercise may only contain lemmas already introduced, plus at most **1** new lemma per exercise (the "+1 rule"), and that new lemma must be glossed on tap.
3. **No untaught grammar.** Structures above the current level may appear only as unanalysed chunks explicitly tagged `chunk: true` (e.g. *How are you?* at A1 before *how* questions are taught).
4. **Every sentence must be natural.** Corpus-checkable: any produced sentence should be plausible in COCA/BNC. No "The cat is on the table" museum sentences unless a real speaker would say them.
5. **Every sentence must be usable.** Prefer sentences a learner could actually say this week.
6. **Audio for everything.** 100% of target-language text has native audio at two speeds (natural, 0.75×) from A1 to C2. No exceptions.
7. **Every new lexeme arrives with:** IPA, audio, part of speech, one L1 gloss (A1–A2 only), one L2 definition (B1+), 2 example sentences, 3 collocations, register tag, frequency band.
8. **Cultural neutrality with cultural depth.** Content must be usable by a learner in Tashkent, Lagos or Lima; where culture-specific content appears (Thanksgiving, cricket), it is taught *as culture*, explicitly.
9. **Inclusive and safe.** See §4.4.

### 4.2 The +1 rule, formally

For any exercise `E` presented at learner state `S`:
- `unknown_lemmas(E, S) ≤ 1`
- `unknown_structures(E, S) = 0` unless `chunk == true`
- estimated success probability `0.80 ≤ p(correct | S) ≤ 0.92` for practice items; `0.55 ≤ p ≤ 0.75` for stretch items; `p ≈ 0.90` for confidence/warm-up items.

This is the operational form of comprehensible input (i+1) and of the "desirable difficulty" literature. The scheduler in doc 08 enforces it.

### 4.3 Feedback rules

- **Immediate** for form-focused drills (accuracy).
- **Delayed to end of turn** for fluency tasks (speaking, free writing) — interrupting fluency practice destroys it.
- Every wrong answer returns: the correct form, *why* it is correct in one line ≤ 140 characters, and a tap-through to the full grammar note.
- Never show only "Correct answer: X". A learner who does not know *why* will make the error again.
- Errors are typed (see doc 07 §6) and logged; three of the same type triggers a targeted micro-lesson.

### 4.4 Content safety and inclusion

- Names, genders, family structures, skin tones and abilities are varied by explicit quota in the content style guide.
- No content that mocks accents or L1 backgrounds.
- Sensitive topics (politics, religion, conflict) appear only from B2, framed as *language of discussing disagreement*, never as advocacy.
- All content passes an age-appropriateness gate for 13+; a separate Kids track (7–12) uses a filtered subset.

---

## 5. Learner-facing architecture (summary; details in the referenced docs)

```
                         ┌──────────────────────┐
                         │  Placement CAT (12)  │
                         └──────────┬───────────┘
                                    ▼
   ┌────────────────────────────────────────────────────────────┐
   │                        THE PATH (13)                       │
   │  Section → Unit → Node → Lesson play (3 mastery tiers)      │
   └───────┬──────────────────────────────────┬─────────────────┘
           │                                  │
           ▼                                  ▼
   ┌────────────────┐                ┌──────────────────────┐
   │ SRS QUEUE (08) │◄───────────────│  ITEM BANK (11)      │
   │ due items      │  every taught  │  ~48,000 items       │
   └───────┬────────┘  item enters   └──────────────────────┘
           │
           ▼
   ┌───────────────────────────────────────────────────────────┐
   │              IMMERSION ENGINE (06)                        │
   │  Graded reader · Podcast · Video · Shadowing · AI roleplay │
   │  Writing studio · Live conversation                        │
   └───────┬───────────────────────────────────────────────────┘
           ▼
   ┌───────────────────────────────────────────────────────────┐
   │   CHECKPOINTS · LEVEL EXAMS · CERTIFICATE (12)             │
   └───────────────────────────────────────────────────────────┘
```

---

## 6. Non-functional requirements

| Area | Requirement |
|------|-------------|
| Latency | Exercise render < 100 ms; audio start < 150 ms; ASR verdict < 800 ms |
| Offline | Full offline for the next 5 units of content + all due SRS items; sync on reconnect with conflict-free merge |
| Audio | 48 kHz mono, −16 LUFS normalised, ≤ 60 kB per short item (Opus 24 kbps) |
| Accessibility | WCAG 2.2 AA; full screen-reader path; dyslexia-friendly font option; no exercise type may be the *only* way to learn an item (deaf/hard-of-hearing learners must have a non-audio route, blind learners a non-visual route) |
| Data | All learner-utterance audio stored only with explicit consent; deletable; never used for training without opt-in |
| Localisation | UI + L1 glosses in ≥ 12 languages at v1; content model is L1-agnostic |
| Devices | iOS 16+, Android 10+, responsive web; 60 fps animation budget on a 4-year-old mid-range Android |
| Scale | 5 M MAU, p99 API < 300 ms, item bank served from CDN-cached bundles |

---

## 7. Definition of "the learner has reached level X"

A level is **not** awarded for completing nodes. It is awarded when **all four** of these hold:

1. **Coverage:** ≥ 95% of the level's syllabus items have been introduced and passed at least tier 2.
2. **Retention:** ≥ 85% of the level's items are in SRS state `retained` (stability ≥ 21 days) at the moment of testing.
3. **Exam:** the Level Exam (doc 12) is passed at ≥ 75%, with **no skill section below 60%**.
4. **Production:** the speaking and writing tasks are rated at or above the level's rubric band by the automatic scorer **and** (from B1) by a human or high-confidence LLM rater with human audit sampling.

Failing any one of these keeps the learner in the level with a targeted remediation plan. This is the single most important integrity rule in the product.

---

## 8. Glossary

| Term | Meaning |
|------|---------|
| **CEFR** | Common European Framework of Reference for Languages, incl. the 2020 Companion Volume (adds mediation, online interaction, plurilingual scales) |
| **Can-do descriptor** | A criterion-referenced statement of what the learner can do ("Can order a meal in a restaurant") |
| **Lemma** | Dictionary form of a word (*go* covers *goes, went, gone, going*) |
| **Word family** | Lemma + inflections + transparent derivations (*nation, national, nationality, internationalise*) |
| **Type / token** | A distinct word form / each occurrence of it |
| **Lexeme** | The unit of teaching in this course: a lemma in one sense (`bank₁` finance ≠ `bank₂` river) |
| **Chunk** | A multi-word item learned unanalysed (*How are you?*, *by the way*) |
| **Collocation** | Conventional co-occurrence (*heavy rain*, not *strong rain*) |
| **Colligation** | Grammatical co-occurrence pattern (*interested **in** + -ing*) |
| **Notion** | A concept to be expressed (time, quantity, cause) |
| **Function** | A communicative act (apologising, requesting, conceding) |
| **Mediation** | Relaying, summarising, or facilitating meaning between people or texts (CEFR 2020) |
| **i+1** | Input one step beyond current competence (Krashen) |
| **Noticing** | Conscious attention to a form, prerequisite to acquisition (Schmidt) |
| **Pushed output** | Production demand that forces the learner beyond comfortable forms (Swain) |
| **Fossilisation** | Permanent stabilisation of an incorrect form |
| **Interlanguage** | The learner's own evolving grammar, systematic and rule-governed |
| **SRS** | Spaced-repetition scheduling |
| **DSR** | Difficulty–Stability–Retrievability memory model used by FSRS |
| **Node** | One playable item on the learning path |
| **Tier** | Mastery pass over a node: 1 Introduce, 2 Consolidate, 3 Stretch |
| **NGSL / AWL / AVL** | New General Service List / Academic Word List / Academic Vocabulary List — frequency references |
| **EVP / EGP** | English Vocabulary Profile / English Grammar Profile — CEFR-tagged inventories |
| **CAT** | Computerised adaptive test |
| **ASR** | Automatic speech recognition |
| **GOP** | Goodness of pronunciation — phone-level ASR confidence score |

---

## 9. Change control

- Syllabus item IDs are **immutable once shipped**. Retiring an item sets `status: deprecated`; it is never deleted, because learner memory records reference it.
- Any change to level boundaries requires re-calibration of the placement CAT and a migration plan for learners mid-level.
- The syllabus is versioned (`syllabus_version`) and every learner record stores the version they were taught under.
