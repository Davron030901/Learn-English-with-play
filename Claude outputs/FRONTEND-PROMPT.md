# FRONTEND BUILD BRIEF — *Learn English with Play*

**For:** an autonomous coding agent (Claude Code, Cursor, or equivalent).
**Companion document:** `BACKEND-PROMPT.md` — the server you consume. Read its §5 (data model),
§7 (grader) and §12 (API contract) before you write your first request.
**Companion document:** `BACKEND-DECISIONS.md` — the rulings the backend agent actually took.
Where it and `BACKEND-PROMPT.md` disagree, **`BACKEND-DECISIONS.md` describes the running
server** and wins.

You are building the client for a gamified English course that takes a learner from zero to
CEFR C2. The curriculum is **already written and validated** — 168 units, 37,173 exercise items,
0 blocking failures across the 19 CI gates the pipeline runs. You are not designing a course. You are building the
surface that a finished course is served through, and the quality bar is that nothing you build
may misrepresent, under-serve or quietly corrupt content that took ten sections of careful work
to get right.

---

## 0. Rules of engagement

Read these once and hold them for the whole build.

1. **The specification wins over this brief.** `docs/00`–`docs/15` are the source of truth. Where
   this brief quotes a doc, the quotation is a convenience; go and read the section. Where this
   brief and a doc disagree, the doc wins and you write down the discrepancy.
2. **The build wins over the specification about what the data actually is.** Every shape in §5 was
   verified by counting all 37,173 items. If a doc describes a field the build does not emit, the
   build is what you render.
3. **The server is the authority on correctness.** The client may grade optimistically so the
   learner sees feedback in under 100 ms, but the server's verdict is the one that is stored and
   the one that is shown once it arrives. §5.7 gives the exact reconciliation rule. Do not
   reimplement `spelling_variant` and `typo1` as a guess: the existing prototype did exactly that
   and graded 10,689 and 989 items respectively stricter than the content intends.
4. **Never hold a provider key.** No TTS, ASR or LLM API key may be compiled into the app, stored
   in the bundle, fetched into the client, or held in device storage. Every such call goes through
   the backend. This is not negotiable and it is not a configuration option. §7.4.
5. **Guardrails are tests, not comments.** Everything in §8.4 is a banned pattern. Each one gets an
   automated test that fails the build if the pattern appears. A guardrail nobody tests is a
   guardrail that ships broken in the third sprint.
6. **Accessibility is a content requirement here, not a polish pass.** `docs/00 §6`: *no exercise
   type may be the only way to learn an item*. A deaf learner needs a non-audio route and a blind
   learner a non-visual route to **every** syllabus item. That constrains the lesson runner's item
   selection, not just the widgets. §12.
7. **When a rule is ambiguous, take the conservative reading, implement it, and write it down.**
   Keep a `DECISIONS.md` in the frontend repo in the same shape the backend agent used: a table of
   open rulings with the default taken and the phase that depends on it.
8. **Honest numbers.** Every figure the interface shows must mean what a reasonable person would
   think it means. If you cannot compute a number honestly, do not show it. Showing nothing is
   better than showing a number that will not survive a surprise retention audit.
9. **Do not invent content.** If a renderer needs a field the item does not have, the renderer is
   wrong or the item is a known defect (§17) — handle it and report it. Never synthesise a
   distractor, a gloss, an example sentence or an IPA string on the client.

---

## 1. What you are building

A learner client for iOS, Android and the web, from one codebase, that:

* draws the course map — 10 sections, 168 units, 8 nodes per unit, three tiers per node;
* runs lessons: 31 exercise types in seven interaction families, with feedback, audio and
  recording;
* keeps a learner honest about their own progress — coverage first, XP third;
* works offline for the next five units plus every due SRS item, and merges cleanly on reconnect;
* holds the ethical line the specification draws: no hearts, no energy, no content behind a
  currency, no guilt, no default comparison against other people.

**Out of scope for this brief:** the marketing website (landing page, pricing, "how long it really
takes"), the teacher/tutor console, and the Kids track (7–12), which `docs/00 §4.4` puts on a
separate track that has not been built.

---

## 2. What already exists — verified facts

Every number below was produced by counting the build, not by reading a report. Assert the ones
marked **(assert)** at load time; if the content ever changes, you want a failing test, not a
quietly wrong screen.

### 2.1 Content volume

| Artefact | Count |
|---|---:|
| Sections | 10 (A1.1, A1.2, A2.1, A2.2, B1.1, B1.2, B2.1, B2.2, C1, C2) |
| Units | **168** (assert) |
| Nodes | **1,344** — exactly 8 per unit (assert) |
| Nodes that carry items | **1,008** — `lesson` ×672, `story` ×168, `speak` ×168 |
| Nodes that carry no items | **336** — `immersion` ×168, `review` ×168 (composed at runtime) |
| Node-tiers that carry items | **3,019** of a planned 4,032 |
| Exercise items | **37,173** (assert) |
| Distinct exercise types in use | **31** of the 71 in `docs/09` |
| Lexemes | **5,948** |
| Story episodes | **168**, one per unit, one continuing cast |
| Items per tier | tier 1: 13,651 · tier 2: 11,978 · tier 3: 11,544 |

**1,004 of the 1,008 populated nodes have all three tiers; three have two; one has one.** Your
progress maths counts what exists, never `nodes × 3`.

### 2.2 The unit shape you render

`GET /v1/units/{unit_id}` returns a unit built from `build/units/*.json`. Real keys:

```jsonc
{
  "id": "S01U01", "section": "S01", "index": 1, "cefr": "A1.1",
  "title": { "en": "Hello", "uz": "Salom" },
  "theme": "greetings_identity",
  "can_do": [ "I can greet someone and say goodbye.", "…" ],   // CEFR can-do = the badge text
  "estimated_minutes": { "t1": 53.0, "t2": 46.0, "t3": 40.0 },
  "syllabus": { "grammar": ["G-001", …], "lexis": ["lex.00001", …],
                "phonology": ["P-002", …], "functions": ["F-001", …] },
  "nodes": [ { "id": "S01U01N1", "kind": "lesson", "focus": "lexis",
               "title": "Greetings",
               "teaches": { "lexis": [...], "grammar": [], "phonology": [...], "functions": [] } },
             … 8 of them … ],
  "prerequisites": [...]
}
```

Node `kind` is one of `lesson | story | speak | immersion | review`. The order within a unit is
fixed by the build; render it in that order. **`immersion` and `review` nodes contain no items** —
`review` is composed by the scheduler (`POST /v1/sessions`) and `immersion` links into the
Immersion Engine (§10).

Unit detail also carries the taught lexemes (`lemma`, `pos`, `ipa`, `uz`, `ru`, `examples[]`,
`definition_en` **nullable** — see §17.4), the grammar points (`label`, `form`, `meaning`,
`explanation.en` / `.uz`), the phonology points, the functions with ranked exponents and their
formality tags, and the unit's story episode.

### 2.3 The story shape

```jsonc
{ "id": "txt.00001", "title": "Nice to meet you",
  "body": [ { "speaker": "narrator", "text": "It is morning.", "chunk_note": "…" },
            { "speaker": "Sarah",    "text": "Good morning. I am Sarah." }, … ] }
```

`speaker` is `narrator` or one of a recurring cast. Render it as a script, not a paragraph: the
whole point of Story Mode (`docs/06 §7.1`) is that learners come back for the story.

### 2.4 The design work that already exists

Two artifacts hold it (see `DESIGN-HANDOFF.md` for links):

* **Design system** — light and dark tokens, Nunito (interface) + Andika (English being taught,
  chosen because it is built for new readers and has full IPA coverage), **35 React components**
  with previews and guidelines, the mascot Pip, logos, 67 icons, brand book.
* **Canvas** — **47 artboards** built from those real components, most linked as a clickable
  prototype: onboarding (8 steps + welcome), home at A1 and B1, node tiers, lesson and unit
  complete, dark theme, eight exercise types drawn in full, Practice, Focus Clinic, AI roleplay
  with recasts, Library with personal coverage, Reader with gloss card, Story, Progress, Streak
  and streak reset, Quests and badges, cohort, A2 exam result, Writing Studio codes, Settings,
  Premium.

CEFR colours are fixed: **A1 blue · A2 green · B1 orange · B2 pink · C1 purple · C2 yellow.**
Direction is "classic bright play": eight primaries on white, navy ink, a chunky 3D "lip" on
everything pressable.

**Not designed yet** — you will need to make these up and flag them: image-based exercises
(`mcq_image`, `listen_choose_image`, both currently unused), video and song screens, the full
placement result, teacher-graded writing feedback, under-18 account variants.

### 2.5 The working prototype

`app/index.html` is a single-file player, 849 lines, that already renders and grades all 31 types
against a packed copy of the build (`app/data/`, 169 files, 16 MB). It was tested to
**37,173 / 37,173 correct answers graded correct and 28,894 wrong answers graded wrong, 0 false
passes, 0 false fails, 0 exceptions across 74,346 grading cycles**, with no horizontal scroll at
360 / 390 / 768 / 1180 px.

Use it as an executable specification of the renderers. Do **not** port its code: it grades with
four of the six normalisation rules, holds a TTS key in `localStorage`, and has no auth, no
offline store and no accessibility path. It proves the shapes; it is not the app.

---

## 3. Stack — decided

**Expo (React Native) + React Native Web, TypeScript strict, Expo Router.** One codebase, three
targets, matching `docs/00 §6` (iOS 16+, Android 10+, responsive web).

Chosen because: the design system is already 35 **React** components; the speaking features need
real microphone and audio-session control that a PWA cannot give reliably on iOS; offline needs a
real local database, not IndexedDB heuristics; and a three-codebase build of this surface is a
two-year project, not a one-year one.

| Concern | Choice | Why |
|---|---|---|
| Framework | Expo SDK (latest stable), React Native, TypeScript `strict` | one codebase for iOS/Android/web |
| Routing | Expo Router (file-based), typed routes | deep links into a unit or a lesson for notifications |
| State | TanStack Query for server state · Zustand for session/UI state | never put server data in a global store; the lesson runner is the only stateful machine |
| Lesson runner | An explicit finite state machine (XState or a hand-written reducer with a state enum) | §6 defines seven phases and a dozen transitions; an ad-hoc `useState` pile will not survive them |
| Local DB | SQLite (`expo-sqlite`, WAL) with Drizzle ORM · IndexedDB via the same query layer on web | offline needs joins, not a key-value cache |
| Forms/validation | Zod schemas shared with the API types | one definition of the item shapes, used by renderer, grader and store |
| Audio playback | `expo-audio` with rate control | must time-stretch, not pitch-shift (§7.2) |
| Recording | `expo-audio` recorder, 48 kHz mono, Opus where available | §7.3 |
| Animation | Reanimated 3, on the UI thread | 60 fps budget on a 4-year-old mid-range Android |
| i18n | `i18next` with ICU plurals, locale files per language | `docs/00 §6`: ≥ 12 languages at v1 |
| Storage of secrets | `expo-secure-store` (Keychain / Keystore) | refresh tokens never touch AsyncStorage |
| Testing | Vitest (units) · React Native Testing Library (renderers) · Maestro or Detox (flows) · Playwright (web) |
| Lint/format | ESLint + Prettier + `typescript-eslint` with `no-floating-promises` on |

Consider and reject, explicitly, in `DECISIONS.md`: a Next.js web-only first build (faster to a
demo, but the speaking features are the product's differentiator and they are the part the web
does worst), and separate native + web codebases (better marketing-site SEO, but the marketing
site is out of scope anyway).

### 3.1 Project layout

```
app/                         Expo Router routes
  (auth)/                    sign in, register, forgot
  (onboarding)/              the 8 steps of docs/10 §11
  (tabs)/
    index.tsx                the path — course map
    practice.tsx             due reviews, clinics
    library.tsx              Immersion Engine
    progress.tsx             coverage first
    profile.tsx
  unit/[unitId].tsx
  lesson/[sessionId].tsx     the runner; full-screen, not a tab
  story/[textId].tsx
src/
  api/                       generated client from the OpenAPI schema; never hand-written URLs
    client.ts                fetch wrapper: auth, retries, request-id, problem+json
    auth.ts                  token store, the refresh mutex (§4.1)
    queries/                 TanStack Query hooks, one file per resource
  content/
    schemas.ts               Zod schemas for item/unit/node — the single shape definition
    normalise.ts             the six rules, shared with the offline grader
    grade.ts                 offline optimistic grading (§5.7)
  exercises/
    families/                seven renderers: Choice, Text, Bank, Order, Pairs, Bins, Speak
    registry.ts              type_id -> family + per-type options (§5.2)
    Instruction.tsx          instruction_key -> string, in the interface language
    Feedback.tsx             the feedback sheet, incl. "I think my answer was right"
  runner/
    machine.ts               the session state machine (§6)
    phases.ts                the seven-phase session shape from docs/07 §3.2
  audio/
    player.ts                playback, rates, preload, latency budget
    recorder.ts              recording + the anxiety mitigations of docs/06 §4.5
    tts.ts                   server-proxied TTS + on-device fallback (§7.4)
  offline/
    db/                      Drizzle schema + migrations
    sync.ts                  outbox, replay, conflict-free merge (§11)
    prefetch.ts              next 5 units + due items + their audio
  design/                    the design-system components and tokens (§13)
  a11y/                      the accessibility profile and the route-substitution rules (§12)
  gamification/              XP, streak, quests — display only; the server computes
  i18n/
tests/
  guardrails/                §8.4, one test per banned pattern
  renderers/                 one test per exercise type, driven from the real build
  a11y/                      axe / RNTL accessibility assertions
```

---

## 4. The API you consume

Base `/v1`, JSON only, bearer tokens. Full surface in `BACKEND-PROMPT.md` §12. Generate the client
from the server's `/openapi.json`; do not hand-write paths.

### 4.1 Auth — the parts that will bite you

From `BACKEND-DECISIONS.md` §2.6, describing the running server:

* **Access tokens** are HS256 JWTs, `typ: at+jwt`, **15 minutes**, carrying no personal data.
* **Refresh tokens** are opaque 256-bit values prefixed `lep_rt_`, **rotate on every use**, live
  30 days. Sessions end at 90 days however often they are refreshed.
* **Refresh-token reuse detection is strict — no grace window.** Presenting an already-rotated
  refresh token **revokes the entire session**, for the legitimate holder too.

> ⚠️ **Therefore: you must serialise refreshes.** Two requests that both see a 401 and both try to
> refresh will end the learner's session and log them out. Implement a single-flight refresh
> mutex: the first 401 acquires it and refreshes; every other in-flight request awaits the same
> promise and retries with the new token. Write a test that fires 20 concurrent requests against
> an expired access token and asserts **exactly one** refresh call and **zero** logouts. This is
> the single most likely production bug in the client.
* Store the refresh token in `expo-secure-store`, never in AsyncStorage, never in `localStorage`
  on web (use an httpOnly cookie proxy if the backend later offers one; until then, secure-store's
  web fallback with a documented risk note).
* **Immediate revocation:** every authenticated request checks the session is live server-side, so
  a sign-out on another device takes effect at once. A 401 with problem `type` naming session
  revocation is a **logout**, not a refresh trigger. Distinguish the two.
* **Registration takes `birth_year`**; under-13 is refused. `is_minor` is derived server-side on
  every read and never stored — so never cache it past a session, and never compute it yourself.
* **`learner_settings.spelling_variant`** is `us` or `uk`, chosen at onboarding, default `us`. It
  changes what the grader accepts and what you display. Surface it in Settings.
* **L1 is not just `uz`/`ru`.** The server takes a language tag and the accepted set comes from its
  configuration. Never hard-code a two-language switch.

### 4.2 Errors

Every error — including the token endpoint — is RFC 9457 `application/problem+json`:

```jsonc
{ "type": "…stable slug…", "title": "…", "status": 409, "detail": "…",
  "request_id": "…", "errors": [ { "field": "email", "message": "…" } ] }
```

* Switch on `type`, never on `detail` or `title`. Those are human text and will be translated.
* `X-Request-ID`: send one (8–128 chars from `A–Z a–z 0–9 . _ : -`); the server echoes it and puts
  it in every problem body. Show it in the error screen's "report this" affordance — it is the only
  way a support conversation finds the log line.
* `errors[]` never contains the submitted value, so never echo it back either.

### 4.3 Rate limits and degradation

Sign-in, registration and refresh **fail closed** when the server's Redis is down: they return 503.
A 503 on sign-in is not "wrong password" — say "we can't sign you in right now, try again in a
moment" and keep the form filled. Everything else fails open.

### 4.4 What the client must never do

* Never grade authoritatively. §5.7.
* Never hold a provider API key. §7.4.
* Never compute the learner's level, mastery, streak or XP locally as truth. The server computes;
  you display, and you display the server's number even when your optimistic one differs.
* Never send raw learner audio anywhere but the backend, and only after explicit consent
  (`docs/00 §6`, `docs/11 §10`).
* Never log passwords, tokens, or — for an account that may be under 18 — full answer text.

---

## 5. The exercise renderers

31 types, seven families. Every shape below was verified against all 37,173 items. Build the
registry from this table and make the renderers total: a `switch` with no `default` that throws,
plus a compile-time exhaustiveness check on the union of `type_id`.

### 5.1 The item envelope

```jsonc
{ "id": "item.0000001", "type_id": "tap_pairs", "node": "S01U01N1", "tier": 1,
  "cefr": "A1.1",                       // ⚠ always "A1.1" — a known defect, §17.1
  "targets":      { "lexis": ["lex.00001", …] },        // or grammar / phonology / functions
  "memory_items": ["lex.00001.recog", …],               // what a review writes to
  "prompt": { … },  "answer": { … },
  "constraints": { … },                  // present on 15,706 of 37,173
  "feedback": { … }                      // present on 29,909 of 37,173
}
```

`constraints` combinations, with real counts: none 21,467 · `plays_allowed` 5,715 ·
`max_seconds` 5,572 · `hints_allowed` 2,408 · `hints_allowed + max_seconds` 2,011.
`feedback` combinations: `incorrect_default` 11,954 · `correct + incorrect_default` 8,861 ·
none 7,264 · `correct` 4,547 · `explain_ref + incorrect_default` 3,793 · `explain_ref` 754.

**Every one of those is a real state your renderer meets.** An item with no feedback at all must
still produce a feedback sheet; an item with `explain_ref` must resolve the reference to the
grammar or phonology point in the unit payload and link to it.

### 5.2 The seven families, with exact keys

#### Family 1 — **Choice** (12 types, single selection)

| `type_id` | Items | `prompt` keys | `answer` |
|---|---:|---|---|
| `mcq_word_from_definition` | 8,237 | `text_uz`, `options[]` | `index` |
| `pragmatics_choose` | 2,730 | `text`, `options[]` | `index` |
| `minimal_pair_discrimination` | 1,811 | `audio`, `options[]` · `constraints.plays_allowed` | `index` |
| `grammaticality_judgement` | 1,769 | `text`, `options[]` · `constraints.max_seconds` | `index` |
| `gap_fill_bank` | 1,364 | `text` (with the gap), `bank[]` | `key[]`, `normalise[]` |
| `stress_tap` | 906 | `text`, `syllables[]`, `audio` | `index` |
| `phoneme_id` | 470 | `text`, `options[]`, **`option_audio[]`** | `index` |
| `odd_one_out` | 315 | `options[]` | `index` |
| `read_scan_detail` | 228 | `text`, `options[]`, `audio: null` | `index` |
| `read_gist_mcq` | 195 | `text`, `options[]`, `audio: null` | `index` |
| `listen_gist_mcq` | 192 | `text`, `options[]`, `audio` | `index` |
| `listen_detail_gap` | 9 | `text`, `options[]`, `audio` | `index` |

Option counts across the corpus: **2 → 3,585 · 4 → 12,362 · 6 → 224**, plus rare 1, 3, 5, 7, 8.
Lay out 2 options as stacked full-width cards, 4 as a 2×2 grid that collapses to a stack under
360 px, 6+ as a scrolling list. **Never assume four.**

`stress_tap` is a choice over `syllables[]`, rendered as tappable syllable chips, not a list.
`phoneme_id` is the only type with per-option audio: each option gets its own play button.
`gap_fill_bank` is a choice dressed as a gap — the learner picks from `bank[]` and the answer is
compared as text under `normalise`, so route it through the text grader, not an index compare.

#### Family 2 — **Text** (7 types, free typing)

| `type_id` | Items | `prompt` keys | `answer` |
|---|---:|---|---|
| `type_from_l1` | 3,000 | `text_uz`, `audio: null` · `constraints.hints_allowed`, `max_seconds` (2,011 of them) | `key[]`, `accepted[]`, `normalise[]` |
| `dictation_word` | 1,681 | `audio` · `plays_allowed` | `key[]`, `normalise[]` |
| `error_correct` | 1,419 | `text` · `hints_allowed` | `key[]`, `normalise[]`, **`rejected_with_feedback[]`** |
| `dictation_sentence` | 1,372 | `audio` · `plays_allowed` | `key[]`, `normalise[]` |
| `spelling_bee` | 851 | `audio` · `plays_allowed` | `key[]`, `accepted[]`, `normalise[]` |
| `gap_fill_free` | 616 | `text` | `key[]`, `accepted[]`, `normalise[]` |
| `write_sentence` | 386 | `text` | `key: []` (empty), `normalise[]` — **server/LLM graded** |

`error_correct` carries `rejected_with_feedback[]` with `{ pattern, error_code, feedback }`.
**Match it before falling back to `feedback.incorrect_default`.** The `error_code` is from the
`docs/07 §6.1` taxonomy (`ART`, `TNS`, `PREP`, `WO`, `L1`, …) and is what turns a wrong answer into
a diagnosis. Show the diagnosis; do not just show the right answer.

`spelling_bee` is the one type where `typo1` must **not** apply, even if the item lists it — the
spelling is the target. Assert this in a test.

#### Family 3 — **Bank** (2 types, ordered token assembly)

| `type_id` | Items | `prompt` keys | `answer` |
|---|---:|---|---|
| `word_bank_build` | 801 | `text_uz`, `bank[]`, `audio: null` | `key[]` (the token sequence), `normalise[]` |
| `sentence_reorder` | 754 | `bank[]` (no stem) | `key[]`, `normalise[]` |

Bank sizes run **1 to 12** (4 is the mode, at 1,385 items). The bank contains distractor tokens:
the answer is a *subsequence*, not a permutation, so a "used all the tiles" completion check is
wrong. Join the chosen tokens with single spaces and grade as text under `normalise`.

Two traps the prototype's own test harness fell into, both real:

* **A bank can contain the same surface twice** (a cognate pair such as `sport`/`sport`, or a
  repeated function word). Key tiles by index, never by their text.
* **A reversed bank is sometimes still the correct order** (palindromic short sentences). Never
  generate a "known-wrong" answer by reversing; generate it by a check against the key.

#### Family 4 — **Order** (1 type, sequence)

`listen_order_events` — 186 items. `prompt`: `audio`, `options[]` (the lines, shuffled).
`answer.key[]` is the correct sequence of those exact strings. Exact sequence equality, no
normalisation. Render as a drag-to-reorder list with keyboard and screen-reader affordances
("move up" / "move down" buttons are the accessible route; drag is the fast one).

#### Family 5 — **Pairs** (3 types, matching)

| `type_id` | Items | `prompt` | `answer` | `constraints` |
|---|---:|---|---|---|
| `tap_pairs` | 501 | `pairs[][2]` | `mapping{ left: right }` | — |
| `memory_match` | 433 | `pairs[][2]` | `mapping{}` | `max_seconds` |
| `word_race` | 211 | `pairs[][2]` | `mapping{}` | `max_seconds` |

Pair counts run 4 to 12 (6 is the mode, 867 items). `tap_pairs` shows both columns face-up;
`memory_match` is face-down concentration; `word_race` is the same data under a clock. The right
side is the L1 gloss and may contain a disambiguating parenthetical — `"xayr (norasmiy)"`,
`"u (erkak)"`. Render the parenthetical smaller but **never truncate it**: it is the only thing
distinguishing two glosses that would otherwise collide.

Same trap as the bank family: **two pairs can share a surface on one side.** Key by pair index.

#### Family 6 — **Bins** (1 type, categorisation)

`sort_bins` — 79 items. `prompt`: `options[]` (the words), `bins[]` (usually 2, e.g.
`["countable", "uncountable"]`). `answer.mapping{ word: bin }`. Every word must land in a bin
before submit. Accessible route: a per-word segmented control, not drag-only.

#### Family 7 — **Speak** (5 types, 6,657 items — the largest family after choice)

| `type_id` | Items | `prompt` | `answer` | `constraints` |
|---|---:|---|---|---|
| `repeat_after` | 3,498 | `text`, `audio` | `key[]` (the model) | — |
| `speak_prompt` | 1,857 | `text` | `key[]` — empty on 852 of them | `max_seconds` |
| `read_aloud` | 630 | `text` | `key[]` | `max_seconds` |
| `speak_roleplay` | 504 | `text` | `key: []` (always empty) | `max_seconds` |
| `speak_retell` | 168 | `text` | `key: []` (always empty) | `max_seconds` |

All five go to the server: record → `POST /v1/media/speech` → poll `GET /v1/media/jobs/{id}` for
the ASR + pronunciation verdict. §7.3 has the recording UX, which is a design requirement, not a
preference.

### 5.3 Stems, glosses and the instruction key

* **16,941 items have `prompt.text`** (English stem) and **12,038 have `prompt.text_uz`** (the L1
  prompt). **8,194 have neither** — `minimal_pair_discrimination`, `dictation_*`, `spelling_bee`,
  `sentence_reorder`, `tap_pairs`, `memory_match`, `odd_one_out`. A renderer that assumes a stem
  crashes on 22% of the corpus.
* `text_uz` is the field name, but the content model is L1-agnostic: treat it as "the L1 prompt for
  this learner's language" and resolve it from the server's per-language strings, not from a field
  called `uz`. `docs/00 §6` promises ≥ 12 languages at v1.
* **`prompt.instruction_key` is a key, not a string.** There are exactly 31 of them and the server
  resolves them per language. Two do **not** match their `type_id` and will silently break a naive
  `` `instr.${type_id}` `` lookup:
  * `mcq_word_from_definition` → `instr.mcq_word`
  * `minimal_pair_discrimination` → `instr.minimal_pair`
  Assert at load time that every item's `instruction_key` resolves; fail the build if one does not.
* `docs/07 §3.1`: **no exercise may require reading instructions longer than 12 words.** Every
  instruction string in the corpus already obeys this. Put it in the translation lint so a future
  language does not break it.

### 5.4 Constraints

| Constraint | Items | Behaviour |
|---|---:|---|
| `plays_allowed` | 5,715 | Cap the replay button. When the last play is used, say so before it is pressed, not after. `docs/09 §3` removes unlimited replay at B2.1 — below that the cap is generous; respect the item either way. |
| `max_seconds` | 5,572 (+2,011 with hints) | A visible but calm timer. `docs/09 §6`: timeout grades as **Again**, it does not skip the item. `grammaticality_judgement` is 4 s **by design** — that type's whole point is the snap judgement. |
| `hints_allowed` | 2,408 (+2,011) | A hint costs the "no-hint" XP tier (`docs/10 §3`) and grades the review **Hard** (`BACKEND-DECISIONS` R12). Say so on the button, before the tap. |

Timed modes are **opt-in below B2 and default from B2** (`docs/09 §6`). Read the level from
`unit.cefr`, never from `item.cefr` (§17.1).

### 5.5 Feedback

The feedback sheet is a first-class surface, not a toast. It carries:

1. correct / not correct, stated warmly (`docs/06 §4.5`: *"Almost — the* i *in* ship *is shorter"*,
   never *"Incorrect"*);
2. the expected answer;
3. `feedback.correct` or the matched `rejected_with_feedback[].feedback`, falling back to
   `feedback.incorrect_default` — **in that order**;
4. `feedback.explain_ref` resolved to the grammar/phonology point, as a link into the unit's
   reference sheet;
5. the L1 note where the content carries one (the `trap` field on a lexeme records a known
   Uzbek/Russian interference — `docs/14`);
6. **"I think my answer was right."** On every sheet, every time. `docs/09 §5` rule 9 and
   `docs/10`. It posts to `POST /v1/reviews/{id}/dispute`, does **not** change the grade, and
   returns a thank-you that does not pretend the answer has been accepted.

`docs/07 §6.2` sets correction policy **by mode**, and the sheet must respect it:

| Mode | Correction |
|---|---|
| Accuracy drill | Immediate, explicit: correct form + one line of why |
| Guided practice | Elicit first — "try again" with a hint before revealing |
| **Fluency speaking** | **None during the task.** Log silently, deliver two points after |
| Free writing, draft 1 | Content only |
| Free writing, draft 2 | Indirect, coded (the Writing Studio codes are on the canvas) |
| AI roleplay | Recast in the reply, optional summary at the end |

### 5.6 Sequencing inside a node

`docs/07 §3.4`: place the most important new item **early** and the weakest-stability item
**last**. The server composes the session (`POST /v1/sessions`) and owns that ordering. The client
renders the order it is given and does not re-sort — but it does enforce two presentation rules the
server cannot see:

* never animate during a comprehension task (`docs/07 §3.1`, extraneous load);
* never place audio and its transcript in separate scroll regions (same section, split attention).

### 5.7 Optimistic grading and the server's authority

The latency budget is **< 100 ms to render and feedback that feels instant**, and a round trip does
not fit that on a Tashkent mobile network. So:

1. Grade locally with the six rules in `src/content/normalise.ts`, shared verbatim with the offline
   store. The order is fixed: **`contraction` → `case` → `punct` → `spacing` → `spelling_variant`
   → `typo1`.**
   Real usage: `case` 12,244 · `spacing` 12,244 · `punct` 11,393 · `spelling_variant` 10,689 ·
   `contraction` 8,157 · `typo1` 989.
   `spelling_variant` needs the lexeme's `spelling.{us,uk}` pair, so the offline bundle must carry
   it. `typo1` is Damerau–Levenshtein ≤ 1 on words of 4+ characters, applied **last**, against the
   already-normalised accepted set, and **never** when the edit produces another real English word
   (`form`/`from`, `quiet`/`quite`, `desert`/`dessert`) — those are the error (`docs/09 §5` rule 7).
2. Show the local verdict immediately.
3. `POST /v1/reviews` in the background with the item id, the raw submission, the reaction time and
   a client-generated `client_uuid` for idempotency.
4. **If the server disagrees, correct the display** — silently upward ("actually, that counts"),
   with a short explanation downward. Log every disagreement with the item id; a type whose
   disagreement rate exceeds 0.5% is a client bug and the dashboard should say so.
5. **1,910 items cannot be graded locally at all** — `speak_prompt` (852 with an empty key),
   `speak_roleplay` (504), `write_sentence` (386), `speak_retell` (168). Those show "sending…" not
   a verdict, and must degrade gracefully offline: accept the submission into the outbox, tell the
   learner it will be marked when they reconnect, and do not block the session.
   **35,263 of 37,173 items are gradable offline.**
6. Clamp the reaction time you report to `[250 ms, 120 s]` before sending. The server clamps too,
   and flags sessions that lie.

---

## 6. The lesson runner

### 6.1 The mandatory session shape (`docs/07 §3.2`)

```
1. WARM-UP        60–90 s   Easy items, p ≈ 0.90.  Rebuilds confidence and context.
2. REVIEW         2–3 min   Due SRS items, interleaved.
3. NEW INPUT      1–2 min   Encounter and noticing.  NO TESTING YET.
4. GUIDED         2–3 min   Controlled practice of the new item.  p ≈ 0.85.
5. INTEGRATION    1–2 min   New item mixed with old.  Interleaved.
6. PRODUCTION     1–2 min   Free-ish output: speak or type a sentence.
7. CLOSE          20 s      What you learned; what's next; one honest stat.
```

Total 8–12 minutes. The server returns the composed session tagged by phase; the runner's state
machine has a state per phase and renders each one differently. **Phase 3 is not a quiz** — it is
presentation with a "got it" affordance, and building it as an exercise is the most common way this
architecture goes wrong.

Two hard rules: **never open a session with the hardest content, and never close on a failure.** If
the last item was wrong, the runner inserts one item the learner will get right before CLOSE.

Note the p-bands: `BACKEND-DECISIONS` R10 settled these at warm-up ≈ 0.90, practice 0.80–0.92,
stretch 0.55–0.75, following `docs/00 §4.2` rather than the backend brief's 0.95. Your "this feels
too easy / too hard" telemetry should be reported against those bands.

### 6.2 Stopping is encouraged

`docs/07 §3.3`: sessions are 5–12 minutes; a session past 12 minutes inserts a **15-second break
screen** with a stretch or breathe prompt. A gentle **"good place to stop"** appears after each
node. The app must make stopping easy and guilt-free — products that maximise session length
maximise burnout, and a client that buries the exit is the mechanism by which that happens.

### 6.3 Fluency and accuracy are labelled

`docs/06 §4.3`: a speaking node is explicitly one or the other, and **the learner sees which**. In
fluency mode: no interruption, no error highlighting during the task, no live scoring bar, feedback
on communication success only. In accuracy mode: immediate correction and form focus. Never merge
them in one screen.

### 6.4 Repeated errors escalate

`docs/07 §6.2`: the third instance of one error code escalates to a **Focus Clinic**. The server
detects it and returns a clinic node; the client's job is to present it as help, not as a
punishment — the canvas has the screen. The clinic's structure (`docs/07 §7`) shows the learner
**their own three errors** first, and **must re-present the failing item under a different exercise
type** — an item failing under `mcq` comes back as `type_from_l1` or `dictation_*`. If the server
sends the same type back, that is a bug worth reporting, not rendering.

---

## 7. Audio, speech and media

### 7.1 Latency budget (`docs/00 §6`)

Exercise render **< 100 ms** · audio start **< 150 ms** · ASR verdict **< 800 ms**.

150 ms to first sample means preloading. When a session is composed, prefetch the audio for the
next three items and decode the next one. **10,976 of 37,173 items reference audio**, across
**3,048 distinct asset paths** — so caching by path is highly effective; many items share a file.

### 7.2 Speed control

`docs/06 §1.1`, **non-negotiable**: every listening item is available at **1.0× and 0.75×** with
pitch preserved, plus **0.5×** at A1–A2. Slowed audio must be **time-stretched, never
pitch-shifted**. On the web that means a Web Audio graph with a phase-vocoder or `preservesPitch`
where the browser implements it properly; on native it means the platform's time-stretch path, not
a naive rate change. Test this by ear on all three platforms and write down which engine each one
uses.

### 7.3 Recording, and the anxiety problem

`docs/06 §4.5` is explicit that speaking anxiety is the **number-one cause of abandonment** in
speaking features. All of these must ship:

* recordings **private by default**;
* **unlimited retakes**, only the best kept;
* **no live scoring bar during recording** — a meter that moves while the learner speaks is the
  thing that stops them speaking;
* **a text-input fallback for every speaking task** (this is also the accessibility route, §12);
* "whisper mode" using near-field input;
* an optional avatar instead of a camera;
* warm, specific feedback copy.

Recording config: 48 kHz mono, Opus where the platform allows. Upload to
`POST /v1/media/speech`, poll the job, show the verdict. Store nothing on the device longer than
the session unless the learner has consented to keep it (`docs/00 §6`, `docs/11 §10`): learner
audio is Sensitive data, is exportable and deletable, and is never used for training without a
separate, explicit, revocable opt-in. Put that opt-in in Settings, off by default, and do not
re-ask after a decline.

### 7.4 No audio has been recorded yet — and no key ever lives in the client

**Every `audio` path in the build points at a file that does not exist.** ~20,792 assets are
referenced corpus-wide and none are recorded; `docs/15 §5` requires human voices below C1. So the
app ships with a TTS fallback, and it must be built so that swapping real recordings in later is a
configuration change, not a refactor:

```
resolveAudio(item) -> { kind: 'asset', url }        // when the CDN has the file
                    | { kind: 'tts',   text, voice } // when it does not
```

The `tts` branch calls **`POST /v1/media/tts` on your backend**, which holds the provider
credential. The prototype's approach — the learner pasting a Gemini key into their own browser's
`localStorage` — was acceptable for a single-user offline demo and is **not acceptable in the
product**. There is no configuration flag, no debug build, and no "just for staging" exception that
puts a provider key in a client.

The one permitted on-device path is the **platform speech synthesiser** (`expo-speech` /
`SpeechSynthesis`), used as a last-resort offline fallback with a visible "synthetic voice" marker,
because it needs no credential and never leaves the device.

The text a missing asset should speak is recoverable from the content — the packer already does it:
`a/lex.NNNNN_{ga|sbe|slow|exN}.opus` → the lexeme's lemma or its Nth example;
`a/txt.NNNNN.opus` → the story episode's joined body; `a/w_*.opus` and `a/mp_*.opus` → the word in
the filename; `a/gen_sentence.opus` → the item's own answer key. Port that resolution to the server
so every client gets the same string.

---

## 8. Progress, gamification and the guardrails

The server computes all of it. You display it — and the *order* you display it in is a product
decision the specification has already made.

### 8.1 Coverage first (`docs/10 §4.1`)

The primary progress metric is **not** XP and **not** nodes:

> **"You can now understand about 87% of everyday conversation."**
> Vocabulary: 2,340 words known · Coverage: 87% spoken / 79% written
> Level: B1.1 — 62% complete · Estimated: 34 hours to B1.2

Secondary: streak, XP, league. Tertiary: badges. `docs/10 §4.1` calls putting coverage first *"the
single most important anti-vanity-metric decision in the product"*. A Progress screen that leads
with a streak is a failed implementation of this brief.

The level screen shows **the four conditions** for the level award with their computed values
(`GET /v1/progress/level/{level}`), not a single percentage — because a learner who is 100% on
three conditions and 60% on the fourth needs to see which one.

### 8.2 XP (`docs/10 §3`)

Display only; the server computes `base(type) × difficulty_mult × novelty_mult × mode_mult`. Two
things the interface must make visible:

* **`novelty_mult` is 0.25 for re-grinding already-mastered content.** When a learner replays an
  easy old lesson, say so in the XP line — "×0.25, this is revision" — rather than showing a small
  number with no explanation. Farming XP by replaying easy content is the dominant XP-optimal
  strategy in competing products and is close to worthless for learning; making the penalty legible
  is how you stop learners feeling cheated by it.
* **Immersion earns more XP than tapping.** Reading a chapter must visibly out-earn a lesson. That
  single alignment is what makes the game and the syllabus the same object.

### 8.3 Streaks (`docs/10 §5`)

The cruelty is removed by design and the client must not add it back:

* **Streak freezes are free and automatic** — 2 held, +1 every 5 days (`BACKEND-DECISIONS` R9).
  **No purchase path, ever.** There is no screen on which a freeze can be bought.
* Up to **2 rest days per week** never break the streak. `rest_days` is ISO weekday numbers,
  1 = Monday … 7 = Sunday (`BACKEND-DECISIONS` §2.4).
* **Repair** within 48 h with a double session, free, once a month. **Pause** for up to 30 days,
  self-declared, no questions asked, no "are you sure?" friction.
* Milestones at 7, 30, 100, 365. Never used in a guilt message. Never a gate on content, never a
  leaderboard input, never required for a certificate.
* **The copy rule is literal.** Streak-loss copy is:
  *"Your streak reset. That's fine — 41 days of learning didn't disappear. Ready to start the next
  one?"*
  The app never says the learner has disappointed anyone or anything, including the mascot.

### 8.4 Banned patterns — write these as tests

One test per line, in `tests/guardrails/`. Each fails the build.

1. **No hearts, lives or energy.** Grep the whole source for those concepts as mechanics; assert
   there is no consumable that gates an exercise.
2. **No content behind currency.** Assert every route under `lesson/`, `unit/` and `story/` is
   reachable with a zero-gem, non-subscribed account fixture.
3. **No countdown timer on a purchase decision, no fake scarcity, no confirm-shaming.** Lint the
   string catalogue against a banned-phrase list ("No thanks, I don't want to…", "Only N left",
   "offer expires").
4. **No comparison by default.** Assert leagues are `opt_in === false` on a fresh account and that
   no screen renders another learner's score unless the learner opted in.
5. **No confetti on every correct answer** (`docs/10 §10`). Celebration is rare by design: unit
   complete (small), section complete (large), level achieved (largest). Assert the celebration
   component is not reachable from the per-item feedback sheet.
6. **Cancellation is as easy as subscription.** Assert the cancel path is no more taps than the
   subscribe path.
7. **Notification caps** (`docs/10 §7`): max 1/day by default, 2 if opted up, hard cap 3; quiet
   hours default 21:00–08:00 local; **never escalate** — after 5 ignored notifications, *reduce* to
   weekly and ask whether to pause. Unsubscribe in one tap, honoured immediately.
8. **Minors** (`docs/10 §8`): if the account may be under 18 — no leagues, no purchases, stricter
   notification caps, no social matching with adults. Assert with a minor fixture.
9. **Honest numbers.** Every displayed figure traces to a server field. Assert no screen computes a
   learner-facing statistic from local state alone.
10. **Data exit.** Full export in an open format and a real delete-everything, both reachable from
    Settings in ≤ 3 taps.

---

## 9. Onboarding (`docs/10 §11`)

Eight steps. The canvas has all of them. They are not decoration — steps 1, 2, 5 and 6 change what
the learner is served.

```
1. "Why do you want English?"          -> weights content selection, not just a badge
2. "What's your first language?"       -> L1 glosses and contrastive content (docs/14)
3. "Do you know any English already?"  -> placement CAT, or straight to Section 1
4. [Placement CAT, 8-12 min]           -> skippable, and say so
5. "How much time per day?"            -> sets the daily goal honestly
6. "When and where will you study?"    -> implementation intention + the notification slot
7. THE HONEST EXPECTATION SCREEN
8. FIRST LESSON — the learner says a real English sentence aloud within 90 seconds
```

Step 7 is the one that will be argued about, so it is quoted here in full:

> "At 20 minutes a day, you'll reach B1 in about 3 years and C2 in about 10.
>  At 60 minutes a day: B1 in about a year, C2 in about 3.
>  We'll show you real progress either way."

`docs/10 §11`: *"Step 7 loses some installs and keeps far more learners. It is also true, which is
the main argument for it."* It appears **before payment**, and there is no variant of the app in
which it does not appear.

Step 6 is the highest-effect-size, lowest-cost intervention in the whole product
(`docs/07 §4.2` — implementation intentions). Wire it to a real scheduled local notification at
that exact time and place, not to a generic daily reminder.

Step 8's 90-second target is a hard constraint on the whole onboarding flow: measure it in an
end-to-end test and fail if the median run exceeds it.

Registration itself takes `birth_year` (§4.1) and refuses under-13. Handle that refusal kindly and
without storing the rejected year.

---

## 10. The Immersion Engine (`docs/06 §7`)

From B1 the path is **gated on immersion volume**, not only on lessons. The client surfaces that
gate honestly: show the learner how many reading and listening minutes remain before the next
section unlocks, and let external reading or listening be self-declared with a spot-check.

Ship in this order:

| Surface | From | Notes |
|---|---|---|
| **Story Mode** | A1.1 | Already built: 168 episodes, one cast. Render as a script with per-line audio and tap-gloss. This is the retention feature. |
| **Graded Library** | A1.2 | Sorted by *personal* coverage (below). |
| **Podcast Feed** | A2.1 | Interactive transcript, dual-speed, clip-to-SRS. |
| **Video Lab** | A2.2 | Three subtitle modes (off / English / English+gloss), loop, shadowing recorder. |
| **News Digest** | B1.1 | The same story at A2/B1/B2/C1 and original — the learner climbs one story. On the canvas. |
| **AI Conversation Partner** | A1.2 | `POST /v1/ai/roleplay`. Recasts, not corrections (`docs/07 §6.2`). |
| **Field Kit** | B1.2 | Paste an article or share from any app → auto-glossed, auto-scheduled. |

**The coverage number is the core intelligence** (`docs/06 §7.3`). Every item in the library
carries a per-learner known-word coverage, and the feed sorts by it:

* **95–98%** → recommended for extensive (pleasure) reading
* **90–95%** → recommended for intensive (study) reading
* **< 90%** → shown with a warning, available, flagged as frustrating
* **> 98%** → "easy — great for speed and fluency"

Show the number. Do not round it into a three-star rating: the number is the point.

The **Reader** needs tap-gloss with an add-to-SRS action, and the gloss card is on the canvas.

---

## 11. Offline and sync

`docs/00 §6`: **full offline for the next 5 units of content plus all due SRS items, with
conflict-free merge on reconnect.**

**Prefetch.** On a good connection, cache: the learner's current unit and the next five
(`GET /v1/content/bundle?since=` returns signed CDN URLs and content hashes), every item in those
units' node-tiers, the lexeme records they reference **including `spelling.{us,uk}`** (the grader
needs it), the story episodes, and the audio assets those items reference. Roughly 5 units ≈ 1,100
items; the whole 168-unit packed corpus is 16 MB of JSON, so five units is small. Audio dominates
the budget — cap it, let the learner choose "download audio too", and show the real megabytes.

**The outbox.** Every answer becomes a durable row before it becomes a request:
`{ client_uuid, item_id, submission, rt_ms, hints_used, plays_used, started_at, content_version }`.
`client_uuid` is the idempotency key — the server has `UNIQUE (learner_id, client_uuid)`, so a
replayed batch is a no-op, and `POST /v1/sync/reviews` takes them in batches.

**Merge rules.**
* Reviews are **append-only facts with a timestamp**; the server replays them in timestamp order.
  Never mutate a queued review; never coalesce two answers to the same item.
* Scheduler state (`stability`, `difficulty`, due dates) is **server-owned**. The client may
  compute a provisional next-due to keep an offline queue moving, but it discards its own value on
  sync. Never merge two scheduler states.
* Streak and XP are **server-computed**. Offline, show them as "pending" rather than guessing.
* If the content version the answer was given under differs from the current one, send it anyway
  with `content_version` — the server needs to know what the learner actually saw.

**The clock.** A device with a wrong clock is common. Send the device time *and* a monotonic
elapsed-since-session-start; let the server anchor.

**Conflict surface.** If the server rejects a replayed batch, never silently drop it: keep it, show
one honest line in Settings ("3 answers from 12 March couldn't be saved"), and offer to send the
diagnostic with its request id.

---

## 12. Accessibility

WCAG 2.2 AA, a full screen-reader path, and a dyslexia-friendly font option. Beyond that, one
requirement that is unusual and is the reason this section is not at the bottom of the document:

> **No exercise type may be the only way to learn an item.** A deaf or hard-of-hearing learner must
> have a non-audio route to every syllabus item; a blind learner a non-visual route.
> — `docs/00 §6`

That is a **scheduling** constraint, not a widget constraint. Implement it as an accessibility
profile that the client sends with `POST /v1/sessions`, so the server's composer excludes
incompatible types — and, where a syllabus item has no compatible type, the client substitutes:

| Profile | Excluded | Substitution the client must provide |
|---|---|---|
| No audio | `minimal_pair_discrimination`, `dictation_word`, `dictation_sentence`, `spelling_bee`, `listen_*`, `phoneme_id` | Text-presented equivalents: the dictation stem shown, the minimal pair as a written contrast, `listen_*` against the transcript |
| No vision | `stress_tap` (visual syllables), `tap_pairs`, `memory_match`, `word_race`, `sort_bins`, `word_bank_build`, `sentence_reorder` | Audio-first equivalents plus a linear, announceable interaction: bank and order types become "move item N to position M" via a rotor-friendly list |
| Motor | drag-and-drop everywhere | Every drag interaction has a tap-or-button equivalent. Build the button path **first** and the drag as an enhancement — the other order never gets finished |
| Reduced motion | all transitions | Honour `prefers-reduced-motion` / `isReduceMotionEnabled`; `docs/07 §3.1` already bans animation during comprehension tasks for everyone |

Non-negotiables in the widgets: 44×44 minimum touch targets · visible focus ring on every focusable
· a labelled accessible name on every control including audio buttons ("play, 2 of 3 plays left") ·
live regions for feedback so a screen reader announces the verdict · IPA rendered in Andika with an
`aria-label` that spells the sound name, because a screen reader reading raw IPA is noise · contrast
checked against the design tokens in **both** themes, in CI.

The dyslexia-friendly font option swaps the interface face; Andika stays for the English being
taught, because it was chosen for exactly this reason.

---

## 13. Design-system binding

* Consume the **existing 35 components**. Do not rebuild them from the tokens, and do not restyle
  them per screen. If a screen needs a variant the system does not have, add the variant to the
  system.
* Tokens are the only source of colour, spacing, radius and elevation. **No literal hex value may
  appear outside the token file** — lint it.
* Both themes ship from day one; the canvas includes the dark theme.
* Typography: **Nunito** for the interface, **Andika** for English being taught (headwords,
  example sentences, IPA, story text, exercise stems). The switch is semantic, not decorative: a
  component either presents *the language being learned* or it does not.
* CEFR colour is data, not decoration — A1 blue, A2 green, B1 orange, B2 pink, C1 purple, C2
  yellow — and it drives the path, the unit tiles, the progress bars and the certificates.
* Pip, the mascot, is a yellow speech bubble. **Pip is never disappointed in the learner**
  (`docs/10 §8` rule 3, and §8.3's copy rule). Write that into the component's prop types: there is
  no `mood="sad"` because there is no screen that needs one.

---

## 14. Localisation and the L1 layer

* Interface language and L1 are **separate settings**. A learner may read the interface in Russian
  and want Uzbek glosses, or the reverse.
* The content model is L1-agnostic: glosses live in per-language string files, never inline in
  items (`docs/00 §6`). `prompt.text_uz` is a field name from the build, not a commitment to Uzbek.
* Right-to-left readiness: lay out with logical properties (`start`/`end`), never `left`/`right`.
* Uzbek and Russian both have plural rules that ICU handles and naive `n === 1` does not. Use ICU
  message format for every count string.
* The `trap` field on lexemes carries the known L1 interference note (`docs/14` — false friends,
  transfer errors). Surface it in the feedback sheet when the learner makes exactly that error, and
  nowhere else: a trap note shown pre-emptively teaches the error.

---

## 15. Performance budget

| Metric | Budget | How you hold it |
|---|---|---|
| Exercise render | < 100 ms | Renderers are pure and memoised; the next item is prepared while the current feedback sheet is open |
| Audio start | < 150 ms | Preload next 3, decode next 1 |
| ASR verdict | < 800 ms | Upload starts while the learner is still on the review screen |
| Animation | 60 fps on a 4-year-old mid-range Android | Reanimated on the UI thread; no JS-driven layout animation |
| Cold start to path | < 2.5 s | Course map renders from the local DB first, refreshes from the API second |
| Bundle | Keep the JS bundle under 4 MB; content is data, never bundled | |

Put these in CI as a performance test on a throttled profile, not in a document. A budget nobody
measures is a wish.

---

## 16. Testing strategy

1. **Renderer tests, driven from the real build.** For each of the 31 types, load real items from
   `build/items.json` and assert: it renders, the correct answer grades correct, a constructed
   wrong answer grades wrong, and no exception is thrown. The prototype ran 74,346 such cycles;
   your suite should sample every type at every tier and run the full sweep nightly.
   Two harness traps, both of which produced false results the first time and will again:
   *a bank or pair set can contain the same surface twice*, and *a reversed bank is sometimes still
   correct*. Generate wrong answers by checking against the key, never by a transformation you
   assume is wrong.
2. **Normalisation tests** against the six rules with a table of real cases, including the three
   `typo1` exclusions and the `spelling_bee` exception.
3. **The refresh mutex test** (§4.1): 20 concurrent 401s, exactly one refresh, zero logouts.
4. **Guardrail tests** (§8.4): one per banned pattern.
5. **Accessibility tests**: axe on web, RNTL accessibility assertions on native, contrast in both
   themes, and a screen-reader walkthrough of one lesson per family recorded as a fixture.
6. **Offline tests**: go offline mid-session, answer 20 items, kill the app, reopen, reconnect,
   assert 20 reviews arrive exactly once.
7. **Onboarding timing test**: median time from launch to the learner's first spoken sentence
   ≤ 90 s.
8. **Layout tests** at 360 / 390 / 768 / 1180 px with no horizontal scroll, matching the
   prototype's own bar.

---

## 17. Known content defects the client must absorb

Found by auditing the build. Do **not** "fix" the content. Handle it, and report it.

1. **`item.cefr` is `"A1.1"` on all 37,173 items.** `build_items.py::base_item()` has it as a
   default that is never overridden. **Never read `item.cefr`.** Derive the level from `unit.cefr`.
   Add a startup assertion that counts the mismatch, so the day it is fixed upstream you notice.
2. **`instruction_key` does not always equal `` `instr.${type_id}` ``** — two exceptions, §5.3.
3. **Node-tier count is 3,019, not the 4,032 in `docs/11 §8`.** Progress rings count populated
   tiers, not planned ones. Four nodes have fewer than three.
4. **`definition_en` is missing on 1,425 B1 lexemes** (gate G25) and **193 band-1000 lexemes are
   first taught at B1 or later** (gate G24). Both are open authoring backlogs. Treat
   `definition_en` as nullable everywhere and degrade to the L1 gloss; never render "undefined".
5. **694 generated MCQ items have very uneven option lengths** (gate G07) — some are answerable on
   option shape alone. Nothing to fix client-side, but your item-response telemetry is what feeds
   the IRT refit that finds them, so send it.
6. **No audio exists.** §7.4.
7. **No images exist.** `mcq_image` and `listen_choose_image` are unused for that reason. At A1
   images matter; when they arrive, they arrive as two new types in the registry, so leave the
   registry open for them and do not special-case "31".
8. **The memory-item ID convention in the build differs from `docs/08 §3`** (`G-107.form` vs
   `gram.G-107.form`). The server stores the build's form (`BACKEND-DECISIONS` R1). If you ever
   display a memory item id — in a debug screen, an export, a support view — display the server's
   form verbatim.

---

## 18. Build order

Each phase ends with its acceptance criteria met and its tests green. Do not start a phase before
the one above it passes.

### Phase 1 — Foundation
Expo app, TypeScript strict, Expo Router, the design system wired with both themes, i18n scaffold,
the API client generated from `/openapi.json`, the auth flow with the **refresh mutex**, secure
token storage, the RFC 9457 error surface with request ids, and an error boundary that never shows
a stack trace.

**Accept:** register → sign in → `/v1/me` renders on iOS, Android and web. The 20-concurrent-401
test passes. Killing the network produces the honest offline screen, not a spinner. A 503 on
sign-in reads as "try again", not "wrong password".

### Phase 2 — Content and the course map
Content schemas in Zod, the local SQLite store, `GET /v1/course` and `GET /v1/units/{id}`, the path
screen with 10 section bands and 168 unit tiles, the unit sheet (nodes, vocabulary, grammar,
phonology, functions, story), CEFR colouring.

**Accept:** every one of the 168 units opens and renders. Progress rings count **populated**
node-tiers. The startup assertion for `item.cefr` logs its count. Cold start to a rendered path
< 2.5 s from the local store.

### Phase 3 — The renderers
All 31 types, seven families, driven by the registry. The six normalisation rules. Optimistic
grading with server reconciliation. The feedback sheet with the four-step fallback and
"I think my answer was right".

**Accept:** the full sweep — every item in `build/items.json` renders, its key grades correct and a
verified-wrong answer grades wrong, zero exceptions. `spelling_bee` rejects `typo1`. The three
`typo1` real-word exclusions are rejected. Disagreement with the server, measured on a sample of
5,000 items, is below 0.1%.

### Phase 4 — The lesson runner
The seven-phase state machine, the session request and completion, constraints (timers, plays,
hints), sequencing rules, "good place to stop", the micro-break, never-close-on-failure.

**Accept:** a full 8–12 minute session on all three platforms. Phase 3 (NEW INPUT) contains no
graded item. A deliberately failed last item produces an inserted easy item before CLOSE. Timeout
grades as Again, never as skip.

### Phase 5 — Audio and speaking
Playback with preload, 1.0× / 0.75× / 0.5× time-stretch, the server-proxied TTS fallback, the
recorder, the upload/poll job flow, and every anxiety mitigation in §7.3.

**Accept:** audio starts in < 150 ms on a mid-range Android. 0.75× is time-stretched, not
pitch-shifted, on all three platforms — verified by ear and by a spectral test. **A repository-wide
grep finds no provider API key, and no code path reads one from storage or from a remote config.**
The text fallback exists on all 6,657 speaking items.

### Phase 6 — Progress and gamification
The Progress screen with **coverage first**, the four level conditions, XP with the novelty
multiplier made legible, the streak with freezes / rest days / repair / pause, quests, capability
badges, the cohort.

**Accept:** every guardrail test in §8.4 passes. A fresh account has leagues off. A minor fixture
sees no leagues, no purchases, tightened notification caps. The streak-reset screen carries the
specified copy, and a string-lint asserts no guilt phrasing anywhere in the catalogue.

### Phase 7 — Onboarding and assessment
The eight steps, the placement CAT client, the honest expectation screen, checkpoints, the level
exam, the result screens, the appeal path.

**Accept:** median launch-to-first-spoken-sentence ≤ 90 s. Step 7 appears before any payment
surface and cannot be skipped by any route. Registration refuses under-13 kindly. The placement CAT
is visibly skippable.

### Phase 8 — Offline and sync
Prefetch of the next five units plus due items plus their audio, the durable outbox, batch replay,
the merge rules, the conflict surface, the clock anchor.

**Accept:** the offline test in §16.6 passes. A replayed batch is a no-op. Scheduler state is never
merged client-side. The learner can see, in real megabytes, what is downloaded.

### Phase 9 — Immersion, accessibility hardening, performance
Story Mode, the Graded Library with per-learner coverage, the Reader with tap-gloss and
add-to-SRS, the AI roleplay surface, then the full accessibility sweep and the performance budget
in CI.

**Accept:** every syllabus item is reachable under both the no-audio and the no-vision profile, and
a test proves it by enumerating the syllabus. All §15 budgets hold on a throttled profile. The axe
and contrast suites are green in both themes.

---

## 19. Definition of done

* All 31 exercise types render and grade on iOS, Android and web, verified against the real corpus.
* A learner can go from install to a spoken English sentence in under 90 seconds, and from there to
  a completed unit without ever seeing a number that is not true.
* The six normalisation rules are implemented once and shared between the offline grader and the
  optimistic path; the server's verdict always wins and disagreement is measured.
* Offline: five units and every due review, answered, queued and replayed exactly once.
* Accessibility: every syllabus item reachable without audio and without vision; WCAG 2.2 AA green.
* Every guardrail in §8.4 has a test that fails the build.
* No provider key exists anywhere in the client, in any build configuration.
* `DECISIONS.md` lists every ambiguity found, the default taken, and who needs to rule on it.

---

## 20. First message back to me

Before you write code, reply with:

1. **What you read** — which of `docs/00`–`docs/15` were actually available to you. The backend
   agent had only `docs/00`, and said so; that honesty is what made its output usable. Do the same.
   If `docs/06`, `09`, `10` and `12` are not in your workspace, say so, because §5, §6, §8 and §9 of
   this brief are then paraphrases you cannot verify.
2. **Every conflict you found** between this brief, the docs, `BACKEND-PROMPT.md` and
   `BACKEND-DECISIONS.md`, with the resolution you propose.
3. **The open rulings you need from me**, in the same table shape the backend used
   (question / default taken / phase that depends on it). Start from these, which I already know
   are open:

   | # | Question | My default |
   |---|---|---|
   | F1 | Expo + RN Web for all three targets, or a separate web build? | Expo + RN Web (§3) |
   | F2 | Refresh-token grace window — keep strict (`BACKEND-DECISIONS` R13), or ask the backend for a 5 s window for flaky mobile networks? | Strict, with a client-side mutex |
   | F3 | Offline audio: prefetch by default on Wi-Fi, or always ask? | Ask once, remember, show real megabytes |
   | F4 | The two unused image types — build the registry slots now or later? | Registry stays open; no screens yet |
   | F5 | Interface language and L1 as separate settings, or one? | Separate (§14) |
   | F6 | Does the accessibility profile go to the server for session composition, or does the client filter? | Server composes; client substitutes only where no compatible type exists (§12) |

4. **Your Phase 1 plan**, as a checklist with the acceptance criteria you intend to meet.

Do not start Phase 2 until Phase 1's acceptance criteria are demonstrably met. And when something
in this brief turns out to be wrong — it will — say so in `DECISIONS.md` rather than working around
it quietly. The content survived ten sections because every gate that fired was treated as a real
finding. Hold the same standard here.
