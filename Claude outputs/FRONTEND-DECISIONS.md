# Decisions — frontend

Every assumption, every ambiguity in the specification, and every deviation from the brief,
with its reason. The brief is `FRONTEND-PROMPT.md`, cited as **brief §n**. `BACKEND-PROMPT.md`
is **backend brief §n**; `BACKEND-DECISIONS.md` is **BD §n**, and its rulings are **R1–R14**.
The specification is `docs/00`–`docs/15`, cited as **docs/NN §n**.

This file lives in `Claude outputs/` until the frontend workspace exists; it then moves to
`frontend/DECISIONS.md` (F10).

Status: **Decided** — built this way, and changing it is a normal code change.
**Needs ruling** — built on the default until someone with authority says otherwise. The phase
in brackets is the first one that depends on it.

---

## 0. What was read

| Source | State | Used for |
|---|---|---|
| `docs/00`–`docs/15` | **All sixteen present** in the content repo (HEAD `ef75ea0`) | Every doc citation below was checked against the doc, not against the brief's quotation. docs/06, 07, 09, 10 and 12 are all here, so brief §5, §6, §8 and §9 are verified rather than taken on trust. |
| Packed prototype bundle `Claude outputs/new-in-tashkent/data/` (169 files, 16 MB) | Present | The only full-course artefact. All 37,173 items counted by script. Short keys (`t`, `p`, `a`, `c`, `fb`, `tg`); no `cefr`, `memory_items`, `instruction_key`, node `kind`, or lexeme `spelling` / `definition_en` / `trap`. |
| Repo `build/` | Present, **A1 only**: Sections 1–2, 24 units, 5,568 items, 800 lexemes | The full envelope (`memory_items`, `instruction_key`, node `kind`, `spelling.{us,uk}`), and the 21 US/UK pairs. |
| Prototype `Claude outputs/new-in-tashkent/index.html` (849 lines) | Read in full | Renderer shapes; audit in §4.4. |
| `BACKEND-PROMPT.md`, `BACKEND-DECISIONS.md`, `DESIGN-HANDOFF.md`, `CONTENT-README.md`, the ten build reports | Read | §3, §4. |
| Design system artifact | README, `tokens.json` (135 colour tokens with light and dark values, type, spacing, radius, lip shadows, sizes), `components/index.d.ts` and the file list read. `design-system.json` is only a manifest; the README's `tokens.css` is not among the published files. | Component API and tokens (F9). |
| **Not available** | The full 168-unit `build/` (`items.json`, `lexemes.json`, units with `kind`); `tools/pack_app.py`; the backend's code, a running instance and its `/openapi.json`; the canvas's 47 artboards beyond the brief's list of them. Not read yet: the components' source (`bundle.js`, `bundle.css`). | F7, F12. |

---

## 1. Open rulings

| # | Question | Default taken | Phase |
|---|---|---|---|
| F1 | Expo + RN Web for all three targets, or a separate web build? | Expo + RN Web (brief §3). The rejected alternatives are in §6.1. | 1 |
| F2 | Refresh-token grace window: keep strict (R13), or ask the backend for ~5 s? | Strict, with a single-flight mutex (§7.1). One cost the mutex cannot remove: under strict reuse, a refresh whose *response* is lost on a flaky network always ends the session. The client retries once with the same token, which either succeeds or is treated as reuse. The client records a `refresh_response_lost` event (sent to the backend once it has an endpoint for client events), so the grace-window question can be decided on data. | 1 |
| F3 | Offline audio: prefetch on Wi-Fi by default, or always ask? | Ask once, remember, show real megabytes | 8 |
| F4 | The two unused image types: registry slots now or later? | The `type_id` union stays open (no code assumes 31); no screens | 3 |
| F5 | Interface language and L1: separate settings or one? | Separate. But the design system's README says "the interface is in English at every level", while docs/00 §6 requires UI in ≥ 12 languages at v1 and docs/11 §7 names them, Arabic (RTL) included. Default: a full i18n scaffold (ICU plurals, RTL-ready), English interface by default, other interface languages switchable as translations exist; L1 is its own setting. | 1 (scaffold), 7 (onboarding) |
| F6 | Accessibility profile: server composes, or client filters? | Server composes; the client substitutes only where no compatible type exists. **Blocked on the backend contract:** `POST /v1/sessions {minutes, node_id?}` has no profile field (F19). | 4, 9 |
| F7 | Where is the backend: its code or a URL, its `/openapi.json`, and its problem `type` slugs? BD describes a running Phase-1 server (auth, `/v1/me`, errors, rate limits), but no repository or instance is reachable from here, BD §2.10 turns `/openapi.json` off in production, and BD §2.8 promises stable slugs without listing them. | Build Phase 1 against a contract mock (MSW) and an OpenAPI snapshot written from BD §2.4–2.9 and backend brief §12; generate the types from it; replace it with the server's own schema the day it arrives. All slugs live in one file with a test that fails on an unknown one. **Phase 1 is reported as accepted only against the real server.** | **1 — blocks acceptance** |
| F8 | Web refresh token. `expo-secure-store` has no web implementation (its web module is `export default {}`), so brief §4.1's "secure-store's web fallback" does not exist; BD §2.10 forbids CORS credentials, so there is no cookie flow either. | On web both tokens live in memory only: a reload or a new tab means signing in again. Ask the backend for an httpOnly, `Secure`, `SameSite=Strict`, path-scoped refresh cookie for web clients. | 1 |
| F9 | The design system is a React DOM 18 bundle (`window.Play` plus CSS files). React Native cannot render it, yet brief §13 says "do not rebuild them". | Port each component to React Native primitives under the same name and props (typed arrays where the web API takes pipe-separated strings), with tokens generated from the artifact's `tokens.json`, and check each port against the artifact on web. Add what the system lacks to the system, not to a screen: a text field now (the system has no text input), a third audio speed in Phase 5 (`AudioButton` has `normal` and `slow`; docs/06 §1.1 needs 0.5× at A1–A2). | 1 onwards |
| F10 | Where does the frontend live? | `frontend/` in the existing Learn-English-with-play repo, on branch `frontend/phase-1`, with its own `package.json` and `DECISIONS.md`. The renderer sweeps read `../build/` directly. | 1 |
| F11 | Web local database. Brief §3 says "IndexedDB via the same query layer", but Drizzle has no IndexedDB driver, and `expo-sqlite` on web is alpha and needs `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`. | One query layer: Drizzle on `expo-sqlite` on all three targets, with those headers set by the web host. If web SQLite proves unreliable, web becomes online-only and says so on screen. | 2 (decide), 8 |
| F12 | The full build. The repo holds A1 only; the 37,173-item corpus exists only as the packed bundle. And 37,173 or 37,203 (R6)? | Renderer and grader sweeps run on the packed bundle through an adapter to the build's envelope until the full `build/` is committed; assertions use the artefact's own count. | 2–3 |
| F13 | `spelling_variant`. Brief §4.1 says it "changes what the grader accepts". docs/00 §2.1 ("never marks the other variant wrong") and docs/09 §5 rule 4 accept both, always; docs/07 §6.3 never corrects the variant the learner chose; backend brief §7.1 accepts the pair. And 13 of the 21 A1 "spelling" pairs are different words: apartment/flat, store/shop, fall/autumn, movie/film, vacation/holiday, check/bill, pants/trousers, movie theater/cinema, pharmacy/chemist's, smart/clever, subway/metro, sick/ill, sales assistant/shop assistant. | Accept both, always; the learner's setting chooses only which form the app *shows*. Substitute a pair only for the item's own target lexemes, on word boundaries (so `check` never becomes `bill` in "check your answer"). The lexical pairs go to the content owner for review. | 3 |
| F14 | Normaliser semantics. The six rules are not all of docs/09 §5: NFKC and quote/dash folding (rule 1) belong to no rule — an iPhone keyboard types *don’t* with a curly apostrophe; `punct` strips `. , ! ? ; :` and quote marks *anywhere* in backend brief §7.1, but rule 3 ignores only *terminal* punctuation; `typo1` is plain Levenshtein with no length floor in backend brief §7.1, but Damerau–Levenshtein on words of 4+ characters, with real-word and `spelling_bee` exclusions, in rule 7 and brief §5.7, §5.2 and §16.2; the real-word list has no source; rule 7's "watch the spelling" note is not in the brief; rule 6's server-generated alternatives never reach an offline grader. | Implement docs/09 §5 literally (NFKC and quote/dash folding always, before the listed rules). One JSON file of test vectors that the server and the client must both pass, agreed before the backend's Phase 3. The content bundle ships the real-word list and the server's expanded `accepted[]` — without the latter, brief Phase 3's "< 0.1 % disagreement" cannot be met. | 3 (agree before backend Phase 3) |
| F15 | Timers. docs/09 §6 makes timed modes opt-in below B2, but docs/08 §4.3 makes tier 3 "timed" at every level (backend brief §6.7 copies it). The build puts `max_seconds` on 3,910 items in units below B2 — `type_from_l1` 1,003, `grammaticality_judgement` 782, `memory_match` 250, `word_race` 127 and speaking 1,748. 2,647 of them are tier 3; the other 1,263 are tier 1–2 (`grammaticality_judgement` 511, `memory_match` 250, `speak_prompt` 334, `speak_roleplay` 168). `grammaticality_judgement` is 4 s on 607 items and 10 s on 1,162. A speaking timeout "submits what exists" (docs/09 §6), it is not "Again" (brief §5.4). docs/12 §7 gives every assessment paper an extra-time form, and WCAG 2.2.1 requires time limits to be adjustable. | Below B2, no countdown unless the learner opts into timed mode; from B2, the item's value. The games keep their clock (the clock is the game) and get an untimed practice variant. Speaking stops and submits what was recorded. Every timer can be doubled or switched off in accessibility settings. | 4 |
| F16 | Replay caps. docs/09 §3 keeps replay unlimited until B2.1; the build caps plays at 2 or 3 on 5,715 items at every level from A1.1. | The spec wins: below B2.1 replay is uncapped (plays still counted and reported); from B2.1, the item's cap. | 5 |
| F17 | The scaffolding ladder (docs/09 §3) and transcript support are missing from the brief, and the docs disagree about transcripts: docs/09 §3 shows one before the task until A2.2; docs/06 §1.1 has transcript + L1 at A1.1, on demand at A1.2, after the 1st listen at A2.1, after the 2nd at A2.2, after the task at B1.1–B2.1, optional at B2.2–C1, none at C2. | docs/06 §1.1, applied only to comprehension listening (`listen_*`, story audio) and never where the text is the answer (dictation, `spelling_bee`, minimal pairs, `phoneme_id`, `stress_tap`). A model answer before production below A2.1 where `key[]` is non-empty. Selection scaffolds (MCQ as the default, word banks) belong to the composer. | 4–5 |
| F18 | Hints. 2,163 items allow a hint (`hints_allowed` = 1) and no item carries hint text; another 2,256 carry `hints_allowed` = 0. | The hint button appears only where `hints_allowed ≥ 1`, and hints are derived from the item, never written by the client: the key's first letter (`type_from_l1`), the span that differs between prompt and key (`error_correct`). The button says, before the tap, that it costs the no-hint tier. | 4 |
| F19 | The session contract. Backend brief §12's `POST /v1/sessions {minutes, node_id?}` takes no accessibility profile and returns no phase tags. And docs/08 §5 step 6 (copied by backend brief §6.6) *closes* a session on "the item with the lowest stability among those just reviewed" — which docs/07 §3.2 ("never close on a failure") and brief §6.1 can only live with if the runner has a known-easy item to insert. | Ask the backend for: `a11y_profile` in the request; `phase` on every session item; one or two `recovery` items (predicted p ≥ 0.90) in the response. Phase 4's acceptance needs all three. | 4 |
| F20 | Typed fallback for speaking (docs/06 §4.5, brief §7.3). Which memory aspects does a typed answer to `repeat_after`, `read_aloud` or `speak_prompt` write (cf. R3)? | The client sends `modality: "typed"`; the server grades it and writes no pronunciation aspect. | 5 |
| F21 | Onboarding timing. docs/10 §11 attaches the 90 seconds to step 8, the first lesson. Brief §16.7 and the Phase 7 acceptance measure from launch — before which come seven steps, registration (not one of the eight) and a skippable CAT. | Measure from the start of step 8, as the spec words it, and report launch-to-first-sentence as well. Order: a neutral birth-year question first (nothing kept if under 13), steps 1–7, account creation, step 8. | 7 |
| F22 | Locks, completion and node kinds. docs/10 §4 shows 2–3 units ahead and greys the rest; docs/12 §3 and docs/06 §7.2 gate sections; Phase 2's acceptance says every unit opens; the prototype locked nothing. docs/10 §4's "all 8 nodes at tier ≥ 2" cannot apply to the 336 item-less nodes, and S08U04N4 has only tier 3 — under docs/08 §4.3's "tier 3 only ≥ 3 days after tier 2" it can never open. docs/10 §4 fills a ring ⅓ per tier; brief §2.1 counts populated tiers. docs/10 §4 and docs/13 add Clinic (34 planned) and Checkpoint (10) nodes that neither the build nor brief §2.2 has. | The server decides locks and completion. A locked unit opens as a read-only preview with the test-out offer, so "every unit opens" holds. Rings count populated tiers. The `kind` union includes `clinic` and `checkpoint`, rendered when the course overlay has them. | 2 |
| F23 | L1 text for learners whose L1 is not Uzbek. `text_uz` is always the target lexeme's `uz` gloss (11,237 of 11,237 non-empty), so it is derivable for any L1 that has glosses. But all 7,740 right-hand entries in the 1,145 pair items are Uzbek glosses inside the item; 16,645 of the 24,608 `incorrect_default` strings contain Uzbek (5,017 are Uzbek prose, the rest have the form `'salom' = hello`); and the instruction strings exist only in English and Uzbek. | The server resolves every L1 string to the learner's L1 before it sends an item; the client never shows `text_uz` or inline Uzbek to a learner whose L1 is not Uzbek; where no string exists in their L1, English, flagged. | 3 |
| F24 | Synthetic audio. docs/15 §5: "all shipped audio is human below C1"; docs/00 §4.1 rule 6: native audio for everything. Brief §7.4 ships TTS. | Ship it as a labelled, time-boxed deviation: server TTS (`"source": "synthetic"`, backend brief §10.1) and the on-device fallback both show the "synthetic voice" marker. Never synthesise the 1,159 minimal-pair items whose spoken text is notation — 482 mark stress with capitals (REcord / reCORD), 201 are IPA, 140 carry intonation arrows (`I agree↘↗`), 138 a parenthetical direction, 106 tone-unit bars, 76 an accent label, 16 hyphenated syllables. TTS cannot produce the contrast they test, so they are withheld (or text-substituted) until recorded. | 5 |
| F25 | Monetisation. docs/10 §9: Premium "removes ads" and gives "early access to new sections"; brief §8.4 guardrail 2 says no content behind a subscription; nothing specifies ads. | No ad SDK; no early-access gate; the rest of docs/10 §9's Premium list. | 6 |
| F26 | The offline contract. docs/00 §6 (which brief §11 quotes) says "all due SRS items"; docs/08 §10, docs/11 §3 and backend brief §11 say "the next 7 days of scheduled items". The backend brief names both `GET /v1/content/bundle` (§12) and `GET /v1/sync/bundle` (§11). docs/11 §9 keeps a learner on the syllabus version they started a section under. docs/11 §3 ships Section 1 inside the app; brief §15 says content is never bundled. | A 7-day window. Content from `/v1/content/bundle`, the due window from `/v1/sync/bundle` until the backend merges them. Version pinned per section. Section 1 shipped as a hashed data asset (never in the JS bundle), loaded into SQLite on first run. | 8 (Section 1 asset: 7) |

---

## 2. The brief against the specification

Brief §0 rule 1: the doc wins; where only the brief speaks, it is followed.

| # | The brief says | The specification says | Resolution | Phase |
|---|---|---|---|---|
| S1 | `spelling_variant` changes what the grader accepts (§4.1) | Accept both, always: docs/00 §2.1, docs/09 §5 rule 4; docs/07 §6.3 never corrects the variant the learner chose | F13 | 3 |
| S2 | Six rules in a fixed order (§5.7) | docs/09 §5: NFKC and quote/dash folding always; terminal punctuation only; a "watch the spelling" note; generated alternatives | F14 | 3 |
| S3 | A timeout grades Again (§5.4) | docs/09 §6: speaking submits what exists; writing autosaves and allows overrun with a flag; timed modes opt-in below B2 | F15 | 4 |
| S4 | Respect `plays_allowed` either way (§5.4) | docs/09 §3: replay unlimited until B2.1 | F16 | 5 |
| S5 | Silent | docs/09 §3 scaffolding ladder; docs/06 §1.1 transcript support by level — and the two disagree | F17 | 4–5 |
| S6 | A TTS fallback ships (§7.4) | docs/15 §5: all shipped audio is human below C1; docs/00 §4.1 rule 6 | F24 | 5 |
| S7 | Interface language separate from L1 (§14); ≥ 12 languages (§3, §5.3) | docs/00 §6 agrees; the design system's README and DESIGN-HANDOFF say the interface is English at every level | F5 | 1, 7 |
| S8 | 90 s measured from launch (§16.7, Phase 7) | docs/10 §11: within the first lesson | F21 | 7 |
| S9 | Every one of the 168 units opens (Phase 2) | docs/10 §4: 2–3 units visible, the rest greyed; test-out at ≥ 85 %; docs/12 §3 and docs/06 §7.2 gate sections | F22 | 2 |
| S10 | Five node kinds (§2.2) | docs/10 §4, docs/13: Clinic (34 planned) and Checkpoint (10) as well | F22 | 2 |
| S11 | Rings count populated tiers (§2.1) | docs/10 §4: ⅓ per tier; unit complete = all 8 nodes at tier ≥ 2 | F22 | 2 |
| S12 | Third instance of one error code → Focus Clinic (§6.4) | docs/07 §6.2 agrees; docs/07 §7 says ≥ 5 instances in 14 days; docs/00 §4.3 says three → a micro-lesson | The server's rule; the client renders the clinic it is sent. Reported to the backend. | 4 |
| S13 | Warm-up p ≈ 0.90 (§6.1, following R10) | docs/07 §3.2 and docs/08 §5 step 5: p ≈ 0.95; docs/00 §4.2: ≈ 0.90 | Settled by R10; "too easy / too hard" telemetry reports against R10's bands | 4 |
| S14 | Never close on a failure; the runner inserts an easy item (§6.1) | docs/07 §3.4 and docs/08 §5 step 6: the weakest-stability item *last* — against docs/07 §3.2 | The runner needs a known-easy item from the server (F19) | 4 |
| S15 | Feedback falls back to `incorrect_default` (§5.5) | docs/00 §4.3: *every* wrong answer returns the correct form, a why of ≤ 140 characters and a tap-through | 11,811 items carry no why; 3,942 defaults exceed 140 characters (§5). The sheet always shows the expected answer and whatever why exists; it never pads. | 3 |
| S16 | Offline: next 5 units + all due SRS items (§11, quoting docs/00 §6) | docs/08 §10 and docs/11 §3: next 5 units + 7 days of scheduled items — the spec disagrees with itself | F26 | 8 |
| S17 | Content is never bundled (§15) | docs/11 §3: the app ships with Section 1 embedded | F26 | 7 |
| S18 | Silent | docs/11 §9: the learner keeps the syllabus version they started a section under | F26 | 8 |
| S19 | Silent | docs/12 §7: an extra-time form of every assessment paper; WCAG 2.2.1 (timing adjustable) | F15 | 4 |
| S20 | No content behind a subscription (§8.4) | docs/10 §9: Premium removes ads and gives early access to new sections | F25 | 6 |
| S21 | Immersion ships seven surfaces (§10) | docs/06 §7.1 adds Song Studio (A2.1), Writing Studio (B1.1), Live Human Practice (B1.2), Book Club (B2.1) | **Needs ruling at Phase 9.** Brief §2.4 lists song screens as not designed. | 9 |
| S22 | Silent on option order | docs/09 §4.1: distractor position randomised per presentation | **Decided:** the client shuffles options per presentation (seeded), maps back to the canonical index before grading and sending, and never shuffles `stress_tap` syllables | 3 |
| S23 | `error_code` comes from docs/07 §6.1 (§5.2) | docs/07 §6.1 has no `GRAM`; every build item uses `GRAM` | Content defect C8. "GRAM" is never shown as a diagnosis; the backend is asked not to open clinics on it. | 3–4 |
| S24 | — (backend R7) | docs/12 §4.3: C2 needs ≥ 80 %, no paper < 70 % — backend brief §8.1 was right | Tell the backend R7 is resolved by the doc | 7 |

---

## 3. The brief against the backend

| # | Topic | What conflicts | Resolution | Phase |
|---|---|---|---|---|
| B1 | Generated client | Brief §4 generates from `/openapi.json`; BD §2.10 turns it off in production; no backend code or URL is reachable | F7 | 1 |
| B2 | Problem slugs | Brief §4.1 must tell a revoked session from an expired token, and §4.3 a 503 from a wrong password; registration needs the 409 of BD §2.5 and the under-13 refusal. BD §2.8 promises stable slugs but lists none | F7 | 1 |
| B3 | Web refresh storage | Brief §4.1's secure-store web fallback does not exist; BD §2.10 forbids CORS credentials | F8 | 1 |
| B4 | Registration payload | BD §2.4 requires an IANA time zone as well as `birth_year`; BD §2.5: password 10–256 characters and not the email; 409 on an existing email | **Decided:** the client sends the device's IANA zone and mirrors the password rules as hints only; the server decides | 1 |
| B5 | Forgot password | Brief §3.1 has `(auth)/forgot`; backend brief §12 has no reset endpoint and BD §2.5 says there is no email service yet | **Needs ruling (backend).** Phase 1's route explains how to get help and calls nothing. | 1 |
| B6 | Sessions | No accessibility profile, no phase tags, closes on the weakest item | F19 | 4 |
| B7 | Grader | Backend brief §7.1: `punct` strips `. , ! ? ; :` and quotes anywhere; `typo1` is plain Levenshtein with no length floor and no real-word or `spelling_bee` exclusion | F14 | 3 |
| B8 | Bundle endpoints | `/v1/content/bundle` (backend brief §12) vs `/v1/sync/bundle` (§11); a 7-day window | F26 | 8 |
| B9 | Synthetic audio flag | Backend brief §10.1 marks TTS drafts `"source": "synthetic"`; brief §7.4 marks only the on-device path | **Decided:** the client marks both | 5 |
| B10 | `say_for()` | Backend brief §10.1 reuses `tools/pack_app.py::say_for()`; that file is not in the repo; the packed items carry resolved `say` strings, except the 470 `phoneme_id` items, whose option audio (`a/w_*`) must be resolved from the file name (brief §7.4) | The server needs the packer's code or the resolved strings | 5 |
| B11 | Dispute | Brief §5.5: `POST /v1/reviews/{id}/dispute`; backend brief §7.2: a dispute token on every grade result. An answer graded offline has neither. | **Decided:** disputes queue in the outbox keyed by the answer's `client_uuid`; the server resolves them | 3 |
| B12 | Tier-3 timing | Backend brief §6.7 implements docs/08 §4.3 (tier 3 "timed" at every level) against docs/09 §6 (timed modes opt-in below B2) | F15 | 4 |
| B13 | Typed fallback | R3 (imitation vs production) | F20 | 5 |
| B14 | Rate limits | BD §2.7 buckets per IP and per learner; the brief is silent on 429 | **Decided:** honour `Retry-After`, say "slow down a moment", never retry in a loop | 1 |

---

## 4. The brief against the build

### 4.1 Figures that are wrong or incomplete

Everything not listed here was verified exact: units, nodes, populated node-tiers (3,019;
1,004 / 3 / 1), items per tier, per-type counts, `constraints` and `feedback` combinations,
stems (16,941 / 12,038 / 8,194), normalisation counts, the 1,910 empty keys, 10,976 audio items
over 3,048 paths, and the 31 instruction keys (longest English string 9 words, so the ≤ 12 rule
holds).

| # | Brief | Build | Consequence |
|---|---|---|---|
| 1 | 6-pair items: 867 (§5.2 Pairs) | 865 (tap_pairs 486, memory_match 357, word_race 22) | None |
| 2 | "Two pairs can share a surface on one side" (§5.2) | 0 repeated surfaces on either side across all 1,145 pair items. Banks do repeat: 48 `word_bank_build` and 62 `sentence_reorder` banks | Keyed by index anyway |
| 3 | Bank sizes 1–12, mode 4 at 1,385 (§5.2 Bank) | That figure includes `gap_fill_bank` (1,363 of the 1,385). The Bank family itself runs 4–12, mode 8 (339 items) | Layout |
| 4 | "The answer is a subsequence, not a permutation" | `word_bank_build`: 800 of 801 carry exactly two extra tiles, one carries none. `sentence_reorder`: all 754 are exact permutations | The completion check differs by type |
| 5 | 8,194 items have neither stem — seven types listed (§5.3) | The count is right; the list omits `word_race` 211, `listen_order_events` 186, `sort_bins` 79 | None |
| 6 | Option counts 2 / 4 / 6 (§5.2) | The 224 six-option items are 186 `listen_order_events` and 38 `sort_bins`. The only six-way Choice items are 8 `stress_tap` words of six syllables | Layout |
| 7 | `grammaticality_judgement` "is 4 s by design" (§5.4) | 607 at 4 s, 1,162 at 10 s | F15 |
| 8 | `error_code` from the docs/07 §6.1 taxonomy (§5.2) | All 1,419 are `GRAM`, and each item's only rejected pattern is its own unedited prompt | C8 |
| 9 | 35,263 of 37,173 gradable offline (§5.7) | True only if speaking is answered by typing. In voice mode all 6,657 speak items and 386 `write_sentence` need the server: 30,130 | Outbox and "will be marked" copy |
| 10 | Audio path → text resolution (§7.4) | Omits `a/F-NNN_NNNN.opus` (329 paths, used by 2,007 `repeat_after` items) and 145 paths containing spaces, IPA or extra slashes (`a/mp_/ˈbɑːɾəl/ flapped.opus`); `read_aloud` (630) has `say` and no path | Resolution on the server (B10) |
| 11 | "Caching by path is highly effective" (§7.1) | `a/gen_sentence.opus` is shared by all 1,372 `dictation_sentence` items with 720 different texts | Cache by content hash, never by path alone |
| 12 | `word_bank_build` prompt: `text_uz` (§5.2) | Empty on all 801 | C6 |
| 13 | Prototype at `app/index.html`, data in `app/data/` (§2.5) | `Claude outputs/new-in-tashkent/` (169 files, 16 MB, as stated) | Paths only |
| 14 | 37,173 items (§2.1) | Packed bundle 37,173; build report 37,203 | F12 (R6) |

### 4.2 Shapes the brief does not describe

* **Comprehension items carry only the question.** The 1,472 story items (every
  `read_gist_mcq`, `read_scan_detail` and `listen_*` item, 494 `dictation_sentence`, all 168
  `speak_retell`) carry no syllabus target (R4). The 423 `read_gist_mcq` / `read_scan_detail`
  and 201 `listen_gist_mcq` / `listen_detail_gap` items hold a question and options only: the
  passage is the unit's story episode — all 387 `listen_*` items play `a/txt.NNNNN.opus`, and
  every `listen_order_events` option is one of its lines. The renderer shows the episode as a
  script, with the audio and its transcript in one scroll region (brief §5.6).
* **Answer mappings are keyed by surface.** `tap_pairs` / `memory_match` / `word_race`
  (`{left: right}`) and `sort_bins` (`{word: bin}`) key by text. With no duplicate surfaces in
  the corpus this is safe today; the renderer keys by index and converts at the boundary.
* **`listen_order_events`:** one of the 186 is stored with its options already in the keyed
  order, so the client shuffles this type too.
* **`sort_bins` always has exactly the bins `countable` and `uncountable`** (all 79).

### 4.3 Artefacts the briefs assume

Backend brief §2.2 lists `build/items.json` (37,173), `build/lexemes.json` (5,948),
`build/items/{node}T{t}.json`, `app/data/` and `tools/pack_app.py`. In the repo, `build/` covers
A1 only (5,568 items, 800 lexemes, no per-node-tier files), the packed data is under
`Claude outputs/new-in-tashkent/data/`, and there is no `pack_app.py` (F12, B10).

### 4.4 The prototype

It is an executable specification of the renderer shapes and nothing more (brief §2.5 says the
same). Beyond what the brief lists:

* Its sweep's "0 false passes" says nothing about 7,043 items: every speak-family answer is
  accepted, and any non-empty `write_sentence` passes.
* Its `contraction` rule only folds curly apostrophes; it never equates *I'm* and *I am*.
* It ignores `constraints` entirely: no timer, no play cap, no hint limit.
* Its map locks nothing (F22).
* It keeps the Gemini key in `localStorage` and sends it as a `?key=` query parameter, where the
  provider's request logs and any TLS-inspecting proxy record it.

---

## 5. Content defects to report

The client absorbs these and does not "fix" the content (brief §17). Each goes to the content
owner.

| # | Defect | Count | Client handling |
|---|---|---|---|
| C1 | `item.cefr` is `"A1.1"` everywhere | 37,173 per brief §17.1 (the packed bundle drops the field, so it cannot be recounted here); in the A1 build, all 5,568, Section 2 included | Never read; a startup assertion counts the mismatch |
| C2 | `stress_tap` syllables do not spell the word (*good evening* → `gdvi` / `o en` / `oeng`) | 380 of 906 | Detected at load by joining the syllables; not rendered; reported. The composer should not select them. |
| C3 | Minimal pairs whose spoken text is notation | 1,159 of 1,811 | F24 |
| C4 | Minimal-pair options that differ only in capitals (REcord / reCORD) | 350 | A screen reader reads both options identically, so each option's accessible name states the stressed syllable, derived from the capitals ("record, stress on the first syllable") |
| C5 | Audio paths with spaces, IPA or extra slashes | 145 distinct | URL-encoded; resolved on the server |
| C6 | `word_bank_build` with an empty L1 prompt | 801 of 801 | Rendered with the instruction and the bank only; no prompt is invented |
| C7 | Items with a single option | `item.0000410`, `item.0000440` (MCQ, options `["from"]`), `item.0000425` (`gap_fill_bank`, bank `["from"]`) | Rendered; reported |
| C8 | `error_correct`: the one rejected pattern is the unedited prompt; the code is `GRAM`, which is not in docs/07 §6.1; the matched feedback is English on 1,398 items while the default is Uzbek on 875 | 1,419 | The matched feedback shows when it fires; "GRAM" is never shown as a label; F23 for the language |
| C9 | No why for a wrong answer (no `incorrect_default`, `explain_ref` or rejection) | 11,811 | The expected answer always shows; nothing is padded |
| C10 | `incorrect_default` longer than the 140 characters of docs/00 §4.3 | 3,942 | Shown in full, collapsed after two lines |
| C11 | Pragmatics items where more than one option is a listed exponent of the function being tested (`item.0000155`: the key is "Hi!", and "Hi, how are you?" is offered as wrong) | 1,716 of 2,730 | Expect disputes; dispute rate reported per item |
| C12 | Every pragmatics stem asks "which is the best thing to say?", yet most offer distractors that describe a behaviour rather than say anything ("Changing topic with no signal at all", "Silence while someone tells a story — reads as boredom or rudeness"). The key is always an utterance, so the item can be answered on form alone | 2,280 of 2,730 items (4,299 options) | Rendered as written; reported with the G07 family |
| C13 | Every `speak_roleplay` prompt is the unit's can-do statement, not a scenario | 504 of 504 | Shown as the learner's goal; the AI partner opens the scene (Phase 9) |
| C14 | Timers below B2 and replay caps at every level | 3,910 timed below B2 (2,647 of them tier 3); 5,715 capped | F15, F16 |
| C15 | Hints allowed but no hint content | 2,163 (`hints_allowed` = 1); 2,256 more set to 0 | F18 |
| C16 | US/UK "spelling" pairs that are different words | 13 of 21 (A1) | F13 |
| C17 | L1 content inside items | 1,145 pair items; 16,645 `incorrect_default` strings | F23 |
| C18 | Missing tiers: S08U04N4 has tier 3 only; S07U17N4, S09U20N4 and S10U01N4 have no tier 1 | 4 nodes | F22 |
| C19 | Types used outside their specified range or form. `mcq_word_from_definition` is "see an L2 definition", B1–C2 (docs/09 Group A #4), but all 8,237 show an L1 gloss (`text_uz`) instead, and 2,620 sit at A1–A2. `type_from_l1` is A1–B1 (Group B #8) but 1,489 sit at B2–C2. docs/09 §3 removes word banks at B1.1, but 446 `word_bank_build` items sit at B1.1 or above | as stated | The composer's call (F17); reported |
| C20 | The 34 planned clinics and 10 section checkpoints of docs/13 have no content | — | F22 |

---

## 6. Stack

### 6.1 Considered and rejected

* **A Next.js web-only first build.** Faster to a demo, but the speaking features — microphone,
  audio session, time-stretched playback — are the product's differentiator and the part the
  web does worst, and offline needs a real local database.
* **Separate native and web codebases.** Better SEO for a marketing site, which is out of scope;
  it doubles the renderer and grader surface (31 types × 2) and invites the two to grade
  differently.
* **Expo DOM components (a web view) to reuse the React DOM design system on native.** Rejected
  for anything interactive: the < 100 ms render budget, 60 fps and native screen-reader
  semantics all suffer. Acceptable only for static pages.
* **A PWA.** iOS gives a web page no reliable control of the audio session or the microphone.

### 6.2 Where the brief's stack table no longer matches the tooling (September 2026)

* **Expo SDK 57** (57.0.25) pins React Native 0.86.3, React 19.2.3, react-native-web ~0.21 and
  expo-router ~57.0.23. Everything is installed with `npx expo install` so it matches the SDK.
* **Reanimated 4, not 3.** SDK 57 pins 4.5.1, with react-native-worklets 0.10.1, on the New
  Architecture.
* **TypeScript ~6.0.3.** TypeScript 7.0.2 is the npm latest, but typescript-eslint 8.70.1
  supports `>=4.8.4 <6.1.0`, so on 7 the type-aware rules — `no-floating-promises` among them —
  would not run. Expo 57's template pins ~6.0.3.
* **Two test runners.** React Native Testing Library 14 runs under Jest (`jest-expo`), not
  Vitest. Vitest takes the pure TypeScript (normaliser, grader, auth mutex, problem parsing);
  Jest with RNTL takes components.
* **No web secure store and no IndexedDB driver** — F8, F11.
* **Generated client:** openapi-typescript 7.13 + openapi-fetch 0.17. **Contract mock:** MSW 2.15.

---

## 7. Phase 1 decisions

### 7.1 Tokens and sessions — Decided

* The access token lives in memory only, on every platform. The refresh token lives in
  `expo-secure-store` on iOS and Android with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`: it survives
  restarts and is excluded from backups and device transfer. On web it lives in memory (F8).
* **Single-flight refresh.** One module-level promise. The first request to find the access
  token expired — by a 401 whose `type` says so, or by the token's `exp` falling within 60 s
  (read for timing only, never trusted for identity) — starts the refresh; every other request
  awaits the same promise and retries once with the new token. The new refresh token is written
  to secure storage before the promise resolves.
* Outcomes: success → every waiter retries once. 401 revoked or reused → one logout, every
  waiter rejected, no second refresh. 503 or no network → the session is kept and the learner
  is told the server can't be reached; never a logout. A lost response → one retry with the
  same token (F2).
* A 401 whose `type` names session revocation on any request is a logout, never a refresh.

### 7.2 Errors — Decided

* Any non-2xx `application/problem+json` becomes `ApiProblem { type, status, request_id,
  errors[] }`. Failures without a problem body — no network, a timeout, an HTML 502 from a
  proxy — become local types (`client/offline`, `client/timeout`, `client/bad-gateway`), so the
  interface has one path.
* Copy is chosen by `type` from the string catalogue. `title` and `detail` are never rendered
  and never switched on. An unknown `type` gets generic copy and the request id.
* `errors[]` map to form fields by `field`. The message shown is ours where the field and type
  are known, otherwise the server's `message`. The submitted value is never shown back.
* Every error surface has "Report this", showing the request id with a copy button.
* An error boundary at the root and around each route shows the same friendly screen in every
  build. Stack traces go only to the local, redacted log.

### 7.3 Requests — Decided

* Every request carries `X-Request-ID`: a UUIDv7 string, 36 characters, inside BD §2.9's
  character set.
* Timeouts by `AbortController`: 15 s, 20 s for auth. GETs are retried twice on network failure
  with jittered backoff. POSTs are never retried automatically (the idempotent outbox arrives in
  Phase 8). A 429 honours `Retry-After`.
* Sign-in is form-encoded (`grant_type=password`, `username`, `password`); refresh and logout
  are JSON (BD §2.5).

### 7.4 Registration — Decided

* Fields: email, password, birth year, and the device's IANA time zone, shown only if it cannot
  be detected.
* The client does not compute the under-13 rule or `is_minor`; the server decides. On a refusal
  the kind screen shows, the birth year is cleared from form state, and it is never logged or
  stored.

### 7.5 Offline — Decided

* NetInfo and request outcomes feed one `online` state. Phase 1's offline screen says what
  happened, that nothing is lost, and that it will reconnect by itself, with a "Try again"
  button. No spinner. Forms keep their values.

### 7.6 Logging and privacy — Decided

* The client never logs passwords, tokens, `Authorization` headers, email addresses or answer
  text — for anyone, not only possible minors: before `/v1/me` it cannot know `is_minor`, and
  it must not cache it afterwards.
* No third-party analytics or crash-reporting SDK in Phase 1; adding one is a data-processing
  decision. Client events (such as `refresh_response_lost`) go only to our own backend, once it
  offers an endpoint for them.

### 7.7 Design and accessibility — Decided

* Tokens are generated from the artifact's `tokens.json` into a typed module; ESLint forbids
  colour literals anywhere else; a CI test checks every text-on-background token pair at
  ≥ 4.5 : 1 in both themes. The "lip" shadows (`0 4px 0 <colour>`) become React Native
  `boxShadow` with no blur.
* Text in the `learn` family carries `lang="en"` on web and `accessibilityLanguage="en"` on iOS,
  so a screen reader switches to an English voice when the interface is in another language.
* Layout uses logical properties only (`start` / `end`), lint-enforced.
* Pip's poses are a closed union with no sad pose. `Mascot` already types it that way;
  `Avatar.pose` is a plain string in the design system, and the port narrows it to the same
  union.

### 7.8 Guardrails from day one — Decided

* `tests/guardrails/provider-keys.test.ts` scans the repository and the exported bundles for
  provider-key patterns and for any `EXPO_PUBLIC_*KEY*` or `*SECRET*` variable; a planted
  fixture proves it fires.
* Lint forbids AsyncStorage, `localStorage` and `sessionStorage` in the auth code.
* The other §8.4 guardrails get their tests when the features they guard arrive; before that
  they cannot fail for a real reason.

---

## 8. Phase 1 plan and acceptance

### 8.1 Work

- [ ] **Workspace** — `frontend/` (F10) from `create-expo-app`, pinned with `npx expo install`;
      TypeScript ~6.0.3 `strict` with `noUncheckedIndexedAccess`; Expo Router with typed routes;
      ESLint 9 flat config with typescript-eslint's type-aware rules (`no-floating-promises`,
      `no-misused-promises`, `switch-exhaustiveness-check`) and Prettier; GitHub Actions CI.
- [ ] **Design wiring** — light and dark tokens generated from `tokens.json`; theme provider (system setting plus
      manual override); Nunito and Andika through expo-font; ported: Button, IconButton, Icon
      (react-native-svg), Logo, Mascot, SpeechBubble, ListRow, Switch, Segmented; added to the
      system: TextField (F9).
- [ ] **i18n scaffold** — i18next with ICU; English complete, Uzbek and Russian stubs, a pseudo
      locale and an RTL pseudo locale; interface language and L1 as separate settings (F5);
      lint against literal interface strings.
- [ ] **API client** — types generated by openapi-typescript from `openapi/openapi.json` (the F7
      snapshot until the real one arrives); openapi-fetch middleware for auth, request id,
      timeout and problem parsing; an MSW mock from the same schema.
- [ ] **Auth** — register, sign in, sign out, `/v1/me`; token storage and refresh mutex per
      §7.1; revocation → logout.
- [ ] **Error surface** — the problem view with request id, the error boundary, the offline
      screen, the 503 and 429 copy.
- [ ] **Routes** — `(auth)/sign-in`, `(auth)/register`, `(auth)/forgot` (help text only, B5),
      `(tabs)/index` rendering `/v1/me`, `+not-found`.
- [ ] **Guardrail tests** — provider keys, token storage, colour literals, log redaction.

Not in Phase 1: password reset (no endpoint), content, the local database, and any
learner-facing number.

### 8.2 Acceptance

| # | Criterion | Proof |
|---|---|---|
| A1 | Register → sign in → `/v1/me` renders on **web** | Playwright in CI against the mock, then the same spec against the real server (F7) |
| A2 | …and on **iOS and Android** | A Maestro flow and an EAS development-build profile. This workspace has no simulator or device, so the run is on your phone (Expo Go or a dev build) or on Maestro Cloud. A2 is not marked met on my evidence alone. |
| A3 | 20 concurrent requests on an expired access token → exactly one refresh call, zero logouts, 20 successes | Vitest, deterministic, in CI; repeated against the real server when available |
| A4 | A revoked session → exactly one logout and no refresh call | Vitest |
| A5 | A refresh answered 503, or lost to the network → no logout | Vitest |
| A6 | Killing the network shows the honest offline screen, not a spinner, and keeps form values | RNTL (NetInfo mocked) + Playwright `setOffline(true)` |
| A7 | A 503 on sign-in reads "We can't sign you in right now — try again in a moment", keeps the form filled, never says the password is wrong | RNTL + Playwright with the mock answering a 503 problem |
| A8 | No screen renders `detail` or `title`; every error shows its request id; no `errors[]` value is echoed | RNTL, with a sentinel string in `detail` |
| A9 | A render error shows the recovery screen and never a stack trace | RNTL |
| A10 | Both themes render from tokens; a colour literal outside the token file fails lint; text pairs reach 4.5 : 1 in both themes | ESLint fixture test + contrast test |
| A11 | The refresh token never touches AsyncStorage, `localStorage` or `sessionStorage` | Lint + a web test that storage is empty after sign-in |
| A12 | A planted provider key fails the build | Guardrail test |
| A13 | Strict typecheck, lint, both test runners and `expo export` for web, iOS and Android are green | CI |
| A14 | Auth screens: 44 × 44 targets, an accessible name on every control, a visible focus ring on web, nothing clipped at 360 px in English, pseudo and RTL pseudo | RNTL accessibility queries + Playwright screenshots |
| A15 | Registering under 13: a kind refusal, the year cleared, nothing logged | RNTL + mock |
