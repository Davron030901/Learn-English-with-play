# Backend build prompt — "Learn English with Play"

**Paste this whole file as the opening instruction to a coding agent (Claude Code, Cursor, Codex).**
It is written to be executed, not discussed. Everything in it is either verified against the
repository's own build output or cited to a specification section you must read before implementing
that part.

---

## 0. Rules of engagement

Read this section twice. Most failures on this project will come from breaking one of these.

1. **Do not invent linguistic or algorithmic facts.** Every formula, threshold and state name in
   this document is quoted from `docs/00`–`docs/15`. Where this document says *"read docs/NN §M"*,
   open that file before writing the code. If a doc and this prompt disagree, the doc wins and you
   must stop and report the conflict.
2. **The content is already built. Do not regenerate it, do not edit it, do not "improve" it.**
   The backend consumes `build/` as a read-only artefact.
3. **Syllabus IDs are immutable** (`docs/00 §9`). Never renumber, never delete. Retiring an item
   sets `status: deprecated`; learner memory records point at these IDs forever.
4. **The review log is append-only and immutable** (`docs/08 §10`). All memory state is *derived*
   from it and must be re-derivable by replay. Never store a scheduler state you cannot rebuild.
5. **Pedagogy beats engagement** (`docs/10 §1`). No gamification mechanic may change what the
   scheduler chooses, or when it stops. If you find yourself writing code where a streak affects a
   due date, you have made an error.
6. **Write complete, runnable code.** No `TODO`, no pseudo-code, no placeholder secrets. Every
   external input is validated at the boundary.
7. **When a requirement is ambiguous, implement the conservative reading and write the ambiguity
   into `DECISIONS.md` with the doc section that is unclear.** Do not silently pick.
8. **Ask at most one clarifying question, and only if genuinely blocked.** Otherwise proceed with
   stated assumptions.

---

## 1. What you are building

The server for a gamified CEFR A1→C2 English course for Uzbek and Russian first-language speakers.
A React/mobile client already exists as a prototype; the content for all 168 units is finished and
validated. You are building everything between the content bundle and the learner.

Four subsystems, all in scope:

| # | Subsystem | Core responsibility |
|---|-----------|--------------------|
| A | **Learning loop** | Auth, content delivery, answer grading, progress, the FSRS-6 scheduler, offline sync |
| B | **Assessment** | Placement CAT, unit/section checkpoints, six level exams, rubric scoring, the level-award gate |
| C | **Gamification** | XP, streaks, quests, badges, cohorts, opt-in leagues — with the `docs/10` guardrails enforced in code |
| D | **Media & AI** | TTS pipeline, ASR + pronunciation (GOP) scoring, LLM roleplay, LLM writing/speaking raters |

---

## 2. What already exists — verified facts

These numbers come from the current build. Treat them as fixtures in your tests.

### 2.1 Content volume

| Artefact | Count |
|---|---:|
| Sections | 10 |
| Units | 168 |
| Nodes | 1,344 |
| Node-tier lesson plays | 3,019 *(not 4,032 — some nodes have fewer than 3 populated tiers)* |
| Exercise items | 37,173 |
| Distinct exercise types used | **31** of the 71 specified in `docs/09` |
| Lexemes | 5,948 |
| Grammar points | 374 (`G-001`…`G-374`) |
| Phonology points | 102 (`P-001`…`P-102`) |
| Functions | 178 (`F-001`…`F-178`) |
| Story episodes | 168 (`txt.00001`…`txt.00168`), one continuous serial |
| Authored comprehension questions | 504 |
| **Distinct memory items** | **11,791** |
| Memory-item references from items | 48,684 |
| Audio assets referenced | ~20,792 — **none recorded** |

### 2.2 Repository layout (read-only inputs)

```
content/            authoring sources (JSON) — never written by the backend
  lexemes/  syllabus/  units/  texts/  schemas/
build/              the build artefact the backend serves
  lexemes.json          5,948 full lexeme records
  units/S{nn}U{nn}.json 168 built units with nodes + syllabus refs
  items.json            all 37,173 items in one array
  items/{node}T{t}.json 3,019 per-node-tier item files
  units_index.json  lexeme_index.json
app/data/           the client bundle shape already in production use
  index.json            course map + instruction strings
  u001.json … u168.json one file per unit: items, vocab, grammar, story
tools/              the content pipeline (build_*.py, validate.py, pack_app.py)
docs/00 … docs/15   the specification — authoritative
```

### 2.3 ID conventions (`docs/11 §1`)

| Entity | Pattern | Example |
|---|---|---|
| Section / Unit / Node / Tier play | `S{nn}` · `S{nn}U{nn}` · `S{nn}U{nn}N{n}` · `…T{t}` | `S05U12N2T1` |
| Lexeme · Grammar · Phonology · Function | `lex.{nnnnn}` · `G-{nnn}` · `P-{nnn}` · `F-{nnn}` | `lex.03421`, `G-107` |
| Exercise item · Text | `item.{nnnnnnn}` · `txt.{nnnnn}` | `item.0184223` |
| **Memory item** | `{syllabus_id}.{aspect}` | `lex.03421.recall` |

---

## 3. The memory-item taxonomy — read this before touching the scheduler

This is the single most important data structure in the product, and **the specification and the
build disagree about it.** You must reconcile them explicitly.

### 3.1 What the build actually emits (verified by counting all 37,173 items)

| Family | Aspects present | Distinct memory items |
|---|---|---:|
| `lex.*` | `recog` `recall` `aural` `spell` `prod` | 30,151 refs |
| `G-*` | `form` `judge` `choice` | 6,671 refs |
| `P-*` | `disc` | 3,187 refs |
| `F-*` | `ex01` `prod` | 7,203 refs |
| `txt.*` | `comp` | 1,472 refs |

Eleven aspects in total: `recog` (19,418) · `prod` (7,832) · `recall` (4,417) · `form` (3,404) ·
`judge` (3,188) · `disc` (3,187) · `ex01` (2,730) · `aural` (2,106) · `comp` (1,472) ·
`spell` (851) · `choice` (79).

### 3.2 Exercise type → memory aspect (exact, from the build)

Your grader writes a review-log row for **every** memory item an item targets. This mapping is the
contract:

```
dictation_sentence          → aural, comp, form      mcq_word_from_definition → recog
dictation_word              → aural                  memory_match             → recog
error_correct               → form, judge            minimal_pair_discrim.    → disc
gap_fill_bank               → form, recog            odd_one_out              → recog
gap_fill_free               → recall                 phoneme_id               → disc
grammaticality_judgement    → judge                  pragmatics_choose        → ex01
listen_detail_gap           → comp                   read_aloud               → prod
listen_gist_mcq             → comp                   read_gist_mcq            → comp
listen_order_events         → comp                   read_scan_detail         → comp
repeat_after                → prod                   sentence_reorder         → form
sort_bins                   → choice, recog          speak_prompt             → prod
speak_retell                → comp                   speak_roleplay           → prod
spelling_bee                → spell                  stress_tap               → disc, recog
tap_pairs                   → recog                  type_from_l1             → recall
word_bank_build             → recall                 word_race                → recog
write_sentence              → form, prod
```

### 3.3 The discrepancy you must handle

`docs/08 §3` specifies a **different and larger** taxonomy:

* It prefixes families: `gram.G-107.form`, `phon.P-014.disc`, `func.F-023.ex07`.
  **The build does not** — it emits `G-107.form`, `P-014.disc`, `F-023.ex01`.
* It defines four kinds the build never emits: `lex.coll` (collocation), `gram.trans`
  (transformation), `phon.prod` (articulation), `listen.decode` (connected-speech decoding).
* The build emits one kind the doc's table omits: `txt.*.comp` (story comprehension, 1,472 refs).

**Required action:** implement the build's convention as the storage format, because learner records
must match the real data. Write a `MemoryItemId` value object that parses and validates
`{family}.{aspect}`, with the eleven known aspects as an enum plus the four spec-only kinds reserved
but unused. Put this discrepancy in `DECISIONS.md` and flag it for the curriculum owner — the four
missing kinds are real pedagogy that is simply not built yet.

### 3.4 Progression and mastery rules (`docs/08 §3`, §4)

```
recog and aural unlock first (together)
recall  unlocks when recog  reaches S ≥ 7 days
spell   unlocks when recall reaches S ≥ 7 days
prod    unlocks when recall reaches S ≥ 21 days
```

> **Lexeme-level mastery is the MINIMUM stability across its required memory items — not the
> maximum, and not the average.** (`docs/08 §3`)

Get this wrong and the whole product's honesty claim collapses. Write the property test first.

---

## 4. Stack

Fixed. Do not substitute.

| Layer | Choice |
|---|---|
| Language | Python 3.12 |
| API | FastAPI + Pydantic v2 |
| ORM | SQLAlchemy 2.0 (async, `asyncpg`) |
| Migrations | Alembic |
| Database | PostgreSQL 16 |
| Cache / locks / rate limit | Redis 7 |
| Background jobs | Celery 5 + Redis broker (beat for schedules) |
| Auth | OAuth2 password + refresh, `argon2-cffi` hashing, PyJWT |
| Testing | pytest + pytest-asyncio + `testcontainers` for real Postgres/Redis |
| Lint / format / types | ruff + black + mypy (strict on `domain/`) |
| Packaging | uv or poetry; Dockerfile + docker-compose for local |
| Observability | structlog (JSON) + OpenTelemetry + Prometheus `/metrics` |

**Why Python here:** the scheduler, the IRT/BKT knowledge tracer, the GOP pronunciation scorer and
the LLM raters are all Python-native. Keeping them in-process during v1 removes a network hop from
the hot path; extract them to their own services only when a profiler says to.

### 4.1 Project layout

```
app/
  main.py                  FastAPI app factory, lifespan, routers
  config.py                one typed Settings class; fails fast on missing env
  db.py                    async engine, session factory, base
  deps.py                  DI: current_user, db session, redis
  api/v1/
    auth.py  content.py  sessions.py  reviews.py  progress.py
    assessment.py  gamification.py  media.py  sync.py  admin.py
  domain/                  PURE. No I/O, no SQLAlchemy, no FastAPI.
    fsrs.py                FSRS-6 memory model
    scheduler.py           due queue + session composition
    grading.py             answer normalisation + grading
    mastery.py             states, progression, level award
    knowledge_tracing.py   BKT baseline, IRT for CAT
    xp.py                  XP formula
    streaks.py             streak rules incl. freezes/rest/repair
    interference.py        interference scoring
  services/                orchestration; talks to repos + domain
  repositories/            data access only; no business rules
  models/                  SQLAlchemy ORM models
  schemas/                 Pydantic request/response models
  workers/                 celery tasks: tts, asr, rater, irt_refit, audits
  content/                 loader + validator for build/ artefacts
migrations/
tests/
  unit/  integration/  fixtures/
```

**`domain/` must be importable with zero dependencies on the web or database layers.** It is the
part that must still be correct in five years, and it is the part you will unit-test exhaustively.

---

## 5. Data model

Design the migration first. Schema mistakes here are the expensive kind.

### 5.1 Core tables

```sql
-- identity
learners            id uuid pk, email citext unique, password_hash, l1 text,       -- 'uz' | 'ru'
                    created_at, status, is_minor bool, tz text, daily_goal_min int
learner_settings    learner_id fk, desired_retention numeric(3,2) default 0.90,    -- 0.85/0.90/0.94
                    rest_days smallint[],  leagues_opt_in bool default false,
                    perfectionist_mode bool default false, data_collection_paused bool

-- content is read-only and versioned; store refs, not copies
content_versions    id, syllabus_version text, content_hash text, published_at
learner_content     learner_id, section_id, syllabus_version   -- docs/11 §9: pinned per SECTION

-- the source of truth
review_log          id bigserial pk,
                    learner_id uuid not null,
                    memory_item_id text not null,          -- 'lex.03421.recall'
                    item_id text not null,                 -- 'item.0184223'
                    ts timestamptz not null,               -- TRUE client time of the review
                    grade smallint not null check (grade between 1 and 4),
                    rt_ms int, hints smallint, correct bool,
                    answer_raw text, session_id uuid,
                    offline bool default false,
                    client_version text, scheduler_version text,
                    ingested_at timestamptz default now()
-- APPEND ONLY. No UPDATE, no DELETE. Enforce with a rule + a restricted role.

-- derived, rebuildable state
memory_state        learner_id, memory_item_id, primary key (learner_id, memory_item_id),
                    stability double precision, difficulty double precision,
                    due timestamptz, last_review timestamptz,
                    reps int, lapses int, state text,        -- unseen|learning|young|retained|durable|leech|suspended|retired
                    params_version text, last_item_id text, last_type_id text,
                    contexts_seen int, productive_uses int, leech bool

-- progress
node_attempts       learner_id, node_id, tier, started_at, finished_at,
                    score numeric, hints_used int, passed bool
unit_progress       learner_id, unit_id, max_tier smallint, completed_at
section_progress    learner_id, section_id, checkpoint_passed_at, attempts int

-- assessment
assessment_sessions id, learner_id, kind,                    -- placement|unit_cp|section_cp|level_exam|audit|vst
                    started_at, finished_at, theta numeric, se numeric, result jsonb
assessment_responses session_id, item_id, response jsonb, correct bool, rt_ms, theta_at_ask
rubric_scores       id, learner_id, submission_id, rubric_id, criterion, band numeric(2,1),
                    rater text,                               -- 'llm:v3' | 'human:{id}'
                    evidence jsonb, prompt_version text, audited_by, audited_at
level_awards        learner_id, level text, awarded_at, evidence jsonb  -- the four conditions

-- gamification
xp_ledger           id, learner_id, ts, amount int, source text, session_id, detail jsonb
streaks             learner_id pk, current int, longest int, last_active_date date,
                    freezes_available smallint, freezes_regen_at date,
                    paused_until date, repair_used_on date
quests              learner_id, quest_id, period, progress, target, completed_at
badges              learner_id, badge_id, earned_at
cohorts / cohort_members / cohort_goals
leagues / league_members                                       -- opt-in only

-- media & AI
media_assets        id, kind, ref_id, voice, accent, uri, duration_ms, lufs, sha256, licence, status
speech_submissions  id, learner_id, item_id, audio_uri, consent bool, expires_at,   -- 30 d default
                    transcript text, gop jsonb, wer numeric, status
writing_submissions id, learner_id, task_id, text, features jsonb, status
```

### 5.2 Indexing rules you must apply

* `review_log (learner_id, ts)` and `review_log (learner_id, memory_item_id, ts)` — replay is the
  hottest analytical path.
* `memory_state (learner_id, due) WHERE state NOT IN ('suspended','retired')` — partial index; this
  serves the due queue on every session start and must stay under 10 ms.
* Partition `review_log` by month once it exceeds ~100 M rows. Design for it now (declarative
  partitioning), enable it later.
* Every list endpoint is cursor-paginated. No `OFFSET` on learner data.

---

## 6. The FSRS-6 scheduler — `domain/fsrs.py`

Implement exactly as specified in `docs/08 §2`. Reproduced here so you cannot drift; **read the doc
anyway** for the reasoning.

### 6.1 Model

Three components: `D` difficulty [1,10], `S` stability (days, >0), `R` retrievability [0,1].
21 trainable parameters `w[0]…w[20]`.

```
FACTOR = 0.9 ** (-1 / w[20]) - 1

R(t, S)      = (1 + FACTOR * t / S) ** (-w[20])
I(S, R_d)    = (S / FACTOR) * (R_d ** (-1 / w[20]) - 1)

S0(G)        = w[G - 1]                                   # G in 1..4
D0(G)        = clamp(w[4] - exp(w[5] * (G - 1)) + 1, 1, 10)

dD(G)        = -w[6] * (G - 3)
D1           = D + dD(G) * (10 - D) / 9                   # linear damping
D2           = w[7] * D0(4) + (1 - w[7]) * D1             # mean reversion
D_next       = clamp(D2, 1, 10)

# success, G >= 2
S_next = S * (1
        + exp(w[8])
        * (11 - D)
        * S ** (-w[9])
        * (exp(w[10] * (1 - R)) - 1)
        * (w[15] if G == 2 else 1.0)
        * (w[16] if G == 4 else 1.0))

# lapse, G == 1
S_fail = min(w[11] * D ** (-w[12]) * ((S + 1) ** w[13] - 1) * exp(w[14] * (1 - R)), S)

# same-day review
S_short = S * exp(w[17] * (G - 3 + w[18])) * S ** (-w[19])
```

Ship the published FSRS-6 default weight vector in `config.py`, versioned as
`scheduler_version = "fsrs6-<date>"`, and record that string on every review-log row. Do not
hand-tune the defaults.

### 6.2 Grades (`docs/08 §2.3`)

| G | Name | Trigger |
|---|---|---|
| 1 | Again | Wrong answer, or timed out |
| 2 | Hard | Correct but RT > 2.5 × median, **or** correct after using a hint |
| 3 | Good | Correct within normal time |
| 4 | Easy | Correct and RT < 0.6 × median, **or** explicitly marked "too easy" |

> **RT is normalised per exercise type AND per learner.** A `type_from_l1` legitimately takes longer
> than an `mcq_word_from_definition`. Never compare raw milliseconds across types. Keep a rolling
> per-(learner, type_id) median in Redis, falling back to a per-type population median until the
> learner has ≥ 20 observations of that type.

### 6.3 Desired retention

Presets 0.85 "Relaxed" / **0.90 "Balanced" (default)** / 0.94 "Thorough". Exam mode raises `R_d` to
0.95 **for items in the exam's scope only**, and reverts afterwards.

### 6.4 Fuzz and load balancing (`docs/08 §2.10`)

* Interval fuzz ±5%, minimum ±1 day.
* If a day's projected due count exceeds declared capacity by > 20%, move the **least urgent**
  (highest `R`) forward by up to 15% of their interval — **never** to a date where `R` would fall
  below `R_d − 0.08`.
* After an absence: cap the daily queue at 1.5× normal, order by `(1 − R) × importance`, and expose
  an honest "catching up: 6 days left" figure. **Never dump the whole backlog.**

### 6.5 Mastery states (`docs/08 §4.1`)

```
unseen     never presented
learning   S < 1 day
young      1 d  ≤ S < 21 d
retained   21 d ≤ S < 180 d
durable    S ≥ 180 d
leech      reviews ≥ 6 AND S < 5 d   (or 4 lapses in 30 days)
suspended  manually or automatically paused
retired    S ≥ 365 d AND D ≤ 4
```

### 6.6 Session composition (`docs/08 §5`)

```
priority = (1 - R)
         * importance(item)            # frequency band, 0.5–1.5
         * (1 + 0.3 * is_leech)
         * (1 + 0.2 * in_current_level)

budget by requested minutes T:
  T ≤ 5    → 100% review,  0% new     # never introduce with no time to consolidate
  T 6–10   →  70% review, 30% new
  T 11–20  →  60% review, 40% new
  T > 20   →  55% review, 45% new, + a 15 s break every 12 min

hard caps: new ≤ 15/day at A1–A2, ≤ 20 at B1+, and 0 if backlog > 3× normal

interleaving (all three enforced):
  ≤ 3 consecutive items sharing a target ID
  ≤ 2 consecutive items of the same exercise type
  rotate modality read / listen / type / speak

warm-up: prepend 2 items with predicted p(correct) ≥ 0.95
close:   append the lowest-stability item just reviewed (recency effect)
fit:     Σ expected_seconds(type, learner median RT), trim to T ± 10%
```

Exercise-type selection for a memory item, by state:

```
learning  → recognition types (tap_pairs, memory_match, mcq_word_from_definition)
young     → recall types      (type_from_l1, word_bank_build, gap_fill_*)
retained  → production types  (speak_prompt, write_sentence, read_aloud)
leech     → a type NOT used in the last 3 failures (forced variation)
```

**Never present the same memory item with the same exercise type twice in a row** — hence
`memory_state.last_type_id`.

### 6.7 Node tier gates (`docs/08 §4.3`)

| Tier | Composition | Pass |
|---|---|---|
| 1 Introduce | 60% new, heavy scaffolding, mostly recognition | ≥ 70% correct |
| 2 Consolidate | 30% new, recognition + recall | ≥ 80% correct **and ≤ 2 hints** |
| 3 Stretch | 0% new, recall + production, timed, interleaved | ≥ 85% correct, **no hints** |

**Tier 3 is unavailable until ≥ 3 days after tier 2.** Enforce server-side; spacing is structural,
not advisory.

### 6.8 Leeches (`docs/08 §7`)

Escalation ladder, in order: change exercise type → add mnemonic → add image/personal example →
split the item → contrast drill against the confusable → Focus Clinic → suspend and requeue later
with an honest message.

**Never** delete an item silently, and **never** let leeches consume more than 5% of a session.

---

## 7. The grader — `domain/grading.py`

### 7.1 Normalisation rules — all six must be implemented

The build uses exactly six values in `answer.normalise`, with these real counts:

| Rule | Items | Semantics |
|---|---:|---|
| `case` | 12,244 | Case-insensitive compare |
| `spacing` | 12,244 | Collapse runs of whitespace, trim |
| `punct` | 11,393 | Strip `. , ! ? ; :` and quote marks before compare |
| `spelling_variant` | 10,689 | Accept the US↔UK pair from `lexeme.spelling.{us,uk}` |
| `contraction` | 8,157 | Normalise `’ → '`; treat `do not` ≡ `don't` |
| `typo1` | 989 | Accept a Levenshtein distance of **1** from an accepted key |

> ⚠️ **The existing prototype client implements only four of these.** `spelling_variant` and
> `typo1` are silently ignored there, so 10,689 and 989 items respectively are graded *stricter*
> than the content intends. The server is now the authority: implement all six and make the client
> defer to the server verdict.

Order of application: `contraction` → `case` → `punct` → `spacing` → `spelling_variant` → `typo1`
(typo tolerance is applied last, against the already-normalised accepted set).

### 7.2 Grading contract

```
grade(item, submission) -> GradeResult(
    correct: bool,
    grade: 1..4,                       # per §6.2, using the RT model
    expected: str,
    feedback: str | None,              # item.feedback.correct / .incorrect_default
    matched_rejection: str | None,     # item.answer.rejected_with_feedback[].feedback
    memory_items: list[str],           # per §3.2 — one review-log row each
)
```

* `answer.rejected_with_feedback[]` carries diagnosed misconceptions. Match against it **before**
  falling back to `incorrect_default`; this is the difference between teaching and marking.
* `constraints`: `max_seconds`, `hints_allowed`, `plays_allowed`. Enforce server-side. A client
  that reports 0 ms or 9 hours is lying — clamp RT to `[250 ms, 120 s]` and flag the session.
* Honour the product's **"I think my answer was right"** affordance (`docs/10`, design handoff):
  every grade result carries a dispute token; a dispute writes to an `answer_disputes` table for
  content review and does **not** change the learner's grade retroactively.

### 7.3 Item shapes you must render and grade

31 types, in seven interaction families. The prompt/answer keys are fixed by the build:

| Family | Types | Answer shape |
|---|---|---|
| choice | mcq_word_from_definition, odd_one_out, grammaticality_judgement, pragmatics_choose, minimal_pair_discrimination, phoneme_id, stress_tap, listen_gist_mcq, listen_detail_gap, read_gist_mcq, read_scan_detail, gap_fill_bank | `answer.index` or `answer.key` matched against `prompt.options`/`prompt.bank`/`prompt.syllables` |
| text | type_from_l1, spelling_bee, dictation_word, dictation_sentence, gap_fill_free, error_correct, write_sentence | `answer.key[] + answer.accepted[]` under `normalise` |
| bank | word_bank_build, sentence_reorder | token sequence joined with spaces, then normalised |
| order | listen_order_events | exact sequence equality against `answer.key[]` |
| pairs | tap_pairs, memory_match, word_race | `prompt.pairs[][2]`, all pairs matched |
| bins | sort_bins | `answer.mapping{word: bin}` |
| speak | speak_prompt, speak_roleplay, speak_retell, repeat_after, read_aloud | ASR + GOP; see §10 |

---

## 8. Assessment & the level award — subsystem B

### 8.1 The rule that matters most (`docs/00 §7`)

A level is **not** awarded for finishing nodes. All four must hold:

1. **Coverage** — ≥ 95% of the level's syllabus items introduced and passed at **tier ≥ 2**.
2. **Retention** — ≥ 85% of the level's memory items in state `retained` or better
   (S ≥ 21 days) **at the moment of testing**.
3. **Exam** — level exam ≥ 75% overall with **no paper below 60%** (C2: ≥ 80%, no paper below 70%).
4. **Production** — speaking and writing at or above the level's rubric band by the automatic
   scorer **and**, from B1, by a human or high-confidence LLM rater with human audit sampling.

Implement as `domain/mastery.py::evaluate_level_award(learner, level) -> LevelAwardResult` returning
each condition separately with its computed value. Persist the whole evidence object on
`level_awards`. Failing any one keeps the learner in the level with a targeted remediation plan —
and the learner is told which condition failed and by how much. A learner who passes the exam on
fragile memory gets the honest message from `docs/12 §4.3`, not a certificate.

### 8.2 Placement CAT (`docs/12 §2`)

2PL IRT over a calibrated bank of ≥ 1,500 items. Start at θ = 0, or seeded from self-report + L1
prior. Select by maximum Fisher information with **Sympson–Hetter exposure control** and content
balancing 30% grammar / 30% lexis / 25% listening / 15% reading. Stop at `SE(θ) < 0.30`, **or** 40
items, **or** 12 minutes — whichever first.

**The productive add-on is required, not optional:** one 60-second spoken response and one
3-sentence written response. Receptive-only placement over-places by about one sub-level.

Placement policy: place at the **lower bound** of the confidence band; always at least one sub-level
below the highest passed; if the four-skill profile is uneven by ≥ 2 sub-levels, place by the
**weakest productive skill** and open a catch-up track.

### 8.3 Checkpoints (`docs/12 §3`)

* **Unit** — 12–15 items, 40% this unit / 40% previous three / 20% earlier; ≥ 3 production and
  ≥ 2 listening; pass ≥ 80%. Below 80% shortens SRS intervals for the failed IDs and re-queues the
  review node. **Does not block.**
* **Section** — 20–25 min, mirrors the level exam in miniature; ≥ 75% overall, no section < 60%.
  **This one gates progression.** Two attempts 48 h apart; a third requires completing the generated
  remediation plan first.

### 8.4 Rubric scoring (`docs/12 §5`, §6)

Writing: 5 criteria × 6 bands. Speaking: 6 CEFR criteria × 6 bands. Mediation: 4 criteria.

> **The overall band is the MEDIAN of criteria, not the mean.** A single criterion two bands below
> the median caps the overall at one band above that criterion. (`docs/12 §5.4`)

This is what stops a learner with rich vocabulary and unintelligible pronunciation being certified
at C1. Unit-test it with that exact case.

Rater requirements, all enforced in code:

* **Determinism** — LLM raters at temperature 0, fixed prompt version recorded on every score.
* **Explainability** — every score returns the sentences that anchored each band. A number with no
  evidence must fail validation.
* **Gate** — quadratic weighted κ ≥ 0.75 against two trained human raters, per level and task type,
  before a rater may be used for certification. Below that it may return formative feedback only.
  Store the current κ per (rater_version, level, task_type) and check it at call time.
* **Human audit** — 10% of all certification-level scores, **100% of borderline cases** (within 5%
  of a boundary), **100% of appeals**. Implement as a Celery task that enqueues audit work.
* **Bias audit** — score distributions by L1, accent group, gender and age band; any unexplained
  group difference > 0.3 bands triggers a model review alert. Not optional.

---

## 9. Gamification — subsystem C, guardrails in code

### 9.1 XP (`docs/10 §3`)

```
XP(session) = Σ_items base(type) × difficulty_mult × novelty_mult × mode_mult

base:        recognition 1 · recall 2 · production 3 · speaking 4
             · writing 6 per 50 words · extensive reading 10 per 1,000 words
             · extensive listening 10 per 10 min
difficulty:  0.5 if predicted p(correct) > 0.95 · 1.0 normal · 1.5 if p < 0.7
novelty:     1.0 scheduled work · 0.25 re-grinding already-mastered content
mode:        1.0 default · 1.25 timed · 1.25 no-hints
```

The `novelty_mult = 0.25` is load-bearing: it removes the incentive to farm XP by replaying easy
lessons. Do not "simplify" it away.

### 9.2 Streaks (`docs/10 §5`) — the cruelty is removed by design

| Rule | Implementation |
|---|---|
| Daily goal | Learner-set 5/10/20/40 min, changeable any time, **no penalty for lowering** |
| What counts | Any scheduled work — lessons, reviews, immersion minutes, writing, speaking |
| Freezes | **Free and automatic.** 2 held at all times, regenerating 1 every 5 days. **No purchase path, ever** |
| Rest days | Up to 2 per week, learner-designated, never break the streak |
| Repair | Within 48 h by a double session — free, once per month |
| Pause | Up to 30 days, self-declared, no questions asked |
| Never | A gate on content · a leaderboard input · required for a certificate |

Streak-loss copy is fixed by the spec and must come from the server:
*"Your streak reset. That's fine — 41 days of learning didn't disappear. Ready to start the next
one?"* **No guilt tone, ever. The app never says the learner disappointed anyone.**

### 9.3 Hard prohibitions — write these as tests, not comments

* **No hearts, no energy, no consumable that gates learning.** Any endpoint that could deduct a
  resource on a correct answer is a bug.
* **Leagues opt-in and off by default.** Cohorts and cooperative challenges on by default.
* **No public leaderboards of individuals** — never shipped.
* **Gems/shop for cosmetics and conveniences only.** Never content, never lives, never freezes.
* **Test-out is free, unlimited and prominent** (`docs/10 §4`): any unit or section may be skipped
  by passing its test at ≥ 85%.
* **Progress display puts coverage first**, not XP: `"You can now understand about 87% of everyday
  conversation"` — the API must return coverage as the primary metric.
* Under-18 accounts: no social matching, no ad personalisation (`docs/11 §10`).

---

## 10. Media & AI — subsystem D

### 10.1 The audio situation, stated honestly

The build references **~20,792 audio assets and none of them exist.** `docs/15 §5` requires human
voices below C1. Therefore:

* Model `media_assets` with `status ∈ {missing, tts_draft, recorded, qc_passed}`.
* Ship a **TTS draft pipeline** (Celery task) that fills `tts_draft` for any missing asset, so the
  product is usable today, and mark every such asset clearly in the API response
  (`"source": "synthetic"`). The client must be able to tell the learner.
* The audio paths already encode what the audio should say; `tools/pack_app.py::say_for()` already
  resolves all 10,506 audio-bearing items to speakable text. Reuse that logic — do not re-derive it.
* Recorded audio targets (`docs/00 §6`): 48 kHz mono, −16 LUFS ±1, Opus 24 kbps, ≤ 60 kB per short
  item, silence trimmed, no clipping. Enforce in the QC task, not by hand.
* **Never bake a provider API key into a client.** All TTS/ASR/LLM calls go through the server, with
  per-learner rate limits and a cost ceiling per account per day.

### 10.2 Pronunciation scoring

GOP (goodness of pronunciation) + prosody + independent-ASR WER, per `docs/02 §10`. Return
phone-level scores, not a single number. Budget: **ASR verdict < 800 ms** (`docs/00 §6`) — run it
async with a websocket or poll, never block the lesson.

### 10.3 Voice and writing data are Sensitive (`docs/11 §10`)

* Voice recordings: 30-day default retention, learner-controlled, **never used for training without
  separate explicit opt-in**. Implement deletion as a real delete plus a tombstone, and a Celery
  beat job that purges on expiry.
* Learner controls that must exist as endpoints: export everything (JSON + media), delete
  everything, delete recordings only, pause data collection.

---

## 11. Offline and sync (`docs/08 §10`, `docs/00 §6`)

* The client holds **the next 7 days of scheduled items plus the next 5 units of content**.
* Offline reviews are stored with their **true timestamps** and replayed in order on reconnect.
* **The server recomputes state deterministically from the review log — never from client-computed
  state.** A client may send its own idea of the new stability; log it for comparison, then throw it
  away and recompute.
* Conflict-free by construction: the review log is append-only, so "merge" is "insert and re-derive".
* Idempotency: every review carries a client-generated UUID; `(learner_id, client_uuid)` has a
  unique constraint. Replaying a batch must be safe.
* Provide `POST /v1/sync/reviews` (batch, ≤ 500 rows) and `GET /v1/sync/bundle?since=` returning the
  content delta plus the next due window.

---

## 12. API contract

Version under `/v1`. JSON only. Errors follow RFC 9457 (`application/problem+json`) with a stable
`type` slug per domain error.

```
POST   /v1/auth/register              /login  /refresh  /logout
GET    /v1/me                         profile, level, settings
PATCH  /v1/me/settings                desired_retention, daily_goal, rest_days, leagues_opt_in

GET    /v1/course                     section/unit map + learner progress overlay
GET    /v1/units/{unit_id}            unit detail: nodes, vocab, grammar, story
GET    /v1/content/bundle?since=      signed CDN URLs + content hashes (docs/11 §3)

POST   /v1/sessions                   {minutes, node_id?} -> composed session (docs/08 §5)
GET    /v1/sessions/{id}              resume
POST   /v1/sessions/{id}/complete     -> score, XP, streak, what unlocked

POST   /v1/reviews                    single review  (grade + schedule + return next due)
POST   /v1/sync/reviews               batch, idempotent, offline replay
POST   /v1/reviews/{id}/dispute       "I think my answer was right"

GET    /v1/progress                   coverage FIRST, then level, then XP/streak
GET    /v1/progress/level/{level}     the four conditions with computed values

POST   /v1/assessment/placement       start CAT   ; POST .../{id}/respond ; GET .../{id}/result
POST   /v1/assessment/checkpoint      unit|section
POST   /v1/assessment/exam            level exam session
POST   /v1/assessment/audit           monthly retention audit (docs/08 §9)
POST   /v1/assessment/appeal          appeal a certification score

GET    /v1/gamification/summary       xp, streak, quests, badges, cohort
POST   /v1/gamification/streak/repair
POST   /v1/gamification/streak/pause

POST   /v1/media/tts                  server-side TTS (never expose provider keys)
POST   /v1/media/speech               upload utterance -> async ASR + GOP job
GET    /v1/media/jobs/{id}
POST   /v1/ai/roleplay                LLM conversation turn with recast feedback

GET    /health                        liveness
GET    /ready                         checks Postgres + Redis + content bundle
GET    /metrics                       Prometheus
```

---

## 13. Non-functional requirements (`docs/00 §6`)

| Area | Requirement |
|---|---|
| Latency | Exercise render < 100 ms · audio start < 150 ms · **ASR verdict < 800 ms** · **API p99 < 300 ms** |
| Scale | 5 M MAU; item bank served from CDN-cached bundles, never from the API hot path |
| Offline | Next 5 units + all due SRS items; conflict-free merge on reconnect |
| Accessibility | WCAG 2.2 AA. **No exercise type may be the only route to an item** — deaf learners need a non-audio path, blind learners a non-visual one. The scheduler must respect an accessibility profile when selecting exercise types |
| Data | Learner-utterance audio only with explicit consent; deletable; never used for training without opt-in |
| Localisation | UI + L1 glosses in ≥ 12 languages at v1; the content model stays L1-agnostic — glosses live in `strings/{lang}/*.json`, never inline in items |

### 13.1 Security defaults — apply without being asked

Argon2id password hashing · short-lived access tokens with rotating refresh tokens and reuse
detection · parameterised queries only · secrets from env through one typed `Settings` that fails
fast · global error handler that never leaks stack traces or SQL · request-ID on every log line ·
rate limiting per IP and per account (Redis token bucket) · CORS allow-list, never `*` · timeouts on
every outbound call · transactions around every multi-step write · graceful shutdown that drains
in-flight work.

**Never log:** passwords, tokens, raw learner audio paths with PII, or full answer text for
under-18 accounts.

---

## 14. Known content defects the backend must absorb

Found by auditing the build. Do not "fix" the content — handle it in code and report it.

1. **`item.cefr` is `"A1.1"` on all 37,173 items.** `build_items.py::base_item()` has
   `cefr="A1.1"` as a default that is never overridden. **Never trust `item.cefr`** — derive the
   level from `unit.cefr`. Add a startup assertion that logs the discrepancy count so the day it is
   fixed upstream, you notice.
2. **Memory-item ID convention differs from `docs/08 §3`** — see §3.3 above.
3. **Node-tier count is 3,019, not the 4,032 in `docs/11 §8`** — some nodes have fewer than three
   populated tiers. Your progress maths must count what exists, not what was planned.
4. **Two warning-level content backlogs are open** and will show up in learner-facing data:
   193 band-1000 lexemes first taught at B1 or later (gate G24), and 1,425 B1 lexemes with an L1
   gloss but no L2 definition (gate G25). Expose `definition_en` as nullable and let the client
   degrade.
5. **694 generated MCQ items have very uneven option lengths** (gate G07) — some are answerable on
   shape alone. Feed item-response data into the IRT refit (`docs/08 §6.2`) and auto-flag items with
   `a < 0.4`, `p(correct) > 0.97` or `< 0.25` for content review.

---

## 15. Build order

Work in this order. Each phase ends with its acceptance criteria met and tests green. Do not start a
phase before the one above it passes.

### Phase 1 — Foundation
Project skeleton, typed `Settings`, Docker compose (api + postgres + redis + worker), Alembic
baseline, structured logging with request IDs, `/health` + `/ready` + `/metrics`, global error
handler, auth (register/login/refresh/logout) with Argon2id and refresh-token rotation.

**Accept:** `docker compose up` gives a working API; `pytest` runs against real Postgres and Redis
via testcontainers; a request ID appears on every log line; `/ready` fails when Postgres is stopped.

### Phase 2 — Content service
Load and validate `build/` at startup against `content/schemas/*.json`. Serve the course map, unit
detail and content bundles with content-hash ETags. Assert the §14 defects and log their counts.

**Accept:** all 168 units load; 37,173 items indexed; a malformed build fails startup loudly rather
than serving bad data; `GET /v1/units/S05U12` returns nodes, vocab, grammar and story.

### Phase 3 — `domain/` pure core
`fsrs.py`, `grading.py`, `mastery.py`, `xp.py`, `streaks.py`. No I/O. This is the phase to be slow
and careful in.

**Accept — property tests, not just examples:**
* `R(S, S) == 0.90 ± 1e-9` for any valid `S` and parameter vector. *(This is the definition of
  stability; if it fails, everything downstream is wrong.)*
* `S_fail ≤ S` always.
* `D` stays in `[1, 10]` over 10,000 random review sequences.
* Higher `D` → smaller stability gain; higher `S` → smaller relative gain; lower `R` → larger gain
  (the three properties in `docs/08 §2.6`).
* Lexeme mastery equals the **minimum** stability across required memory items — tested with a case
  where the max and the mean would both give the wrong answer.
* All six normalisation rules, each with a positive and a negative case; `typo1` accepts distance 1
  and rejects distance 2.
* Rubric median rule: a 6/6/6/6/2 profile does **not** certify at band 6.

### Phase 4 — Review pipeline
Append-only `review_log` (enforced at the database level, not just in the ORM), state derivation,
the due-queue index, idempotent batch ingest, and a **replay command** that rebuilds all
`memory_state` for a learner from the log alone.

**Accept:** replaying a learner's full log reproduces their current state byte-for-byte; inserting
the same `client_uuid` twice is a no-op; an attempted `UPDATE` on `review_log` is rejected by the
database.

### Phase 5 — Session composition
Due queue, priority ordering, budget split, the three interleaving constraints, new-item caps,
warm-up and close, fuzz and load balancing, tier gates including the 3-day tier-3 spacing.

**Accept:** a generated 10-minute session never breaks an interleaving rule over 1,000 random
learner states; new-item caps hold; tier 3 is refused 2 days 23 hours after tier 2 and allowed at
3 days 1 minute.

### Phase 6 — Progress and gamification
Coverage-first progress, XP ledger, streaks with freezes/rest/repair/pause, quests, badges, cohorts,
opt-in leagues.

**Accept:** every prohibition in §9.3 has a test that fails if someone implements it; lowering the
daily goal never costs the learner anything; the streak-loss message is exactly the specified copy.

### Phase 7 — Assessment
BKT baseline, IRT for the CAT, placement with exposure control, checkpoints, level exams, rubric
scoring with the median rule, the four-condition level award, appeals, the monthly retention audit.

**Accept:** `evaluate_level_award` returns all four conditions separately with values; a learner who
passes the exam at 60% retention is refused the certificate and gets the `docs/12 §4.3` message; a
rater below κ 0.75 cannot be used for certification.

### Phase 8 — Media and AI
TTS draft pipeline, ASR + GOP, LLM roleplay with recasts, LLM raters with fixed prompt versions,
consent and retention jobs, cost ceilings.

**Accept:** no provider key is reachable from any client response; a speech submission expires and
is purged on schedule; every rubric score carries its evidence and prompt version.

### Phase 9 — Sync, hardening, operations
Offline batch replay, the content delta endpoint, rate limits, load test to the p99 target, runbook.

**Accept:** p99 < 300 ms at target concurrency on the session and review endpoints; a 500-review
offline batch replays correctly with true timestamps; graceful shutdown loses no in-flight write.

---

## 16. Definition of done

* `docker compose up` → working API with seeded content and a demo learner.
* `pytest` green, coverage ≥ 85% on `app/domain/` and ≥ 70% overall.
* `mypy --strict app/domain` clean.
* `alembic upgrade head` from empty → current schema, and `downgrade` works.
* `make replay LEARNER=<id>` rebuilds memory state from the review log and reports zero drift.
* `README.md`: run, test, migrate, deploy, and the env-var table.
* `DECISIONS.md`: every assumption, every doc ambiguity, every deviation with its reason.
* `openapi.json` generated and committed.

---

## 17. First message back to me

Before writing code, reply with:

1. Your reading of the **memory-item discrepancy** (§3.3) and which convention you will store.
2. The **ERD** for the core tables, with your partitioning and indexing plan for `review_log`.
3. Any place where this prompt and `docs/00`–`docs/15` conflict.
4. Your Phase 1 file list.

Then start Phase 1. Do not skip ahead.
