# Decisions — frontend

Every assumption, every ambiguity in the specification, and every deviation from the brief,
with its reason. The brief is `FRONTEND-PROMPT.md`, cited as **brief §n**. `BACKEND-PROMPT.md`
is **backend brief §n**; `BACKEND-DECISIONS.md` is **BD §n**, and its rulings are **R1–R14**.
The specification is `docs/00`–`docs/15`, cited as **docs/NN §n**.

This file lives in `lep-frontend/DECISIONS.md`, next to the code it describes (F10).

Status: **Decided** — built this way, and changing it is a normal code change.
**Needs ruling** — built on the default until someone with authority says otherwise. The phase
in brackets is the first one that depends on it. **Resolved** / **Revised** — settled while
building; §9 says how.

**What changed since the first version of this file:** the app is built — §9 records what was
built and every place the build departed from §1–§8; §10 records the independent review and
what was fixed; §11 lists what is waiting on the backend and the content owner.

---

## 0. What was read

| Source | State | Used for |
|---|---|---|
| `docs/00`–`docs/15` | **All sixteen present** in the content repo (HEAD `ef75ea0`) | Every doc citation below was checked against the doc, not against the brief's quotation. docs/06, 07, 09, 10 and 12 are all here, so brief §5, §6, §8 and §9 are verified rather than taken on trust. |
| Packed prototype bundle `Claude outputs/new-in-tashkent/data/` (169 files, 16 MB) | Present | The only full-course artefact, and the content the app ships (§9.2). All 37,173 items counted by script. Short keys (`t`, `p`, `a`, `c`, `fb`, `tg`); no `cefr`, `memory_items`, `instruction_key`, node `kind`, or lexeme `spelling` / `definition_en` / `trap`. |
| Repo `build/` | Present, **A1 only**: Sections 1–2, 24 units, 5,568 items, 800 lexemes | The full envelope (`memory_items`, `instruction_key`, node `kind`, `spelling.{us,uk}`), and the 21 US/UK pairs. |
| Prototype `Claude outputs/new-in-tashkent/index.html` (849 lines) | Read in full | Renderer shapes; audit in §4.4. |
| `BACKEND-PROMPT.md`, `BACKEND-DECISIONS.md`, `DESIGN-HANDOFF.md`, `CONTENT-README.md`, the ten build reports | Read | §3, §4. |
| Design system artifact | README, `tokens.json` (135 colour tokens with light and dark values, type, spacing, radius, lip shadows, sizes), `components/index.d.ts` and the file list read. | Component API and tokens (F9). |
| **`lep-backend`** (Phase 1) | **Read and run locally** (Postgres 16, Redis, FastAPI): its code, its `/openapi.json`, its error slugs, its rate limits | The generated client, the error catalogue, the e2e suite (§9.1). Resolves F7. |

---

## 1. Open rulings

| # | Question | Default taken | Phase |
|---|---|---|---|
| F1 | Expo + RN Web for all three targets, or a separate web build? | Expo + RN Web (brief §3). The rejected alternatives are in §6.1. | 1 |
| F2 | Refresh-token grace window: keep strict (R13), or ask the backend for ~5 s? | Strict, with a single-flight mutex (§7.1). One cost the mutex cannot remove: under strict reuse, a refresh whose *response* is lost on a flaky network always ends the session. The client retries once with the same token, which either succeeds or is treated as reuse. The client counts a `refresh_response_lost` event and sends it to `POST /v1/client-events` (§23), so the grace-window question can be decided on data. A test pins this behaviour (`auth-session.test.ts`, "a response lost after the server rotated"). | 1 |
| F3 | Offline audio: prefetch on Wi-Fi by default, or always ask? | Ask once, remember, show real megabytes | 8 |
| F4 | The two unused image types: registry slots now or later? | The `type_id` union stays open (no code assumes 31); no screens | 3 |
| F5 | Interface language and L1: separate settings or one? | Separate. Built: English, Uzbek and Russian interface catalogues (ICU plurals), pseudo and RTL-pseudo test locales, L1 as its own setting chosen in onboarding. Uzbek and Russian are machine-drafted (§9.6). | 1, 7 |
| F6 | Accessibility profile: server composes, or client filters? | **Resolved (§21):** the server composes. Every `POST /v1/sessions` names the device's profile, and the account keeps a copy for what the server chooses on its own (reviews, the offline window). The client withholds and counts only what it cannot present itself; offline, the local composer applies the same table (§9.3). | 4, 9 |
| F7 | Where is the backend, its `/openapi.json`, and its problem `type` slugs? | **Resolved.** The app is built against the running `lep-backend` Phase 1 and its own `/openapi.json` (`openapi/openapi.json`, regenerated with `LEP_OPENAPI_URL=… npm run gen:api`). The 18 slugs are in `src/api/problem.ts`, read from `app/errors.py`. No contract mock was needed; Phase 1 acceptance ran against the real server (§8). | 1 |
| F8 | Web refresh token. `expo-secure-store` has no web implementation. | **Resolved (§22):** where the server turns it on (`LEP_WEB_REFRESH_COOKIE`, web app and API on one site), the web's refresh token is an httpOnly `__Host-` cookie script never holds, and a reload restores the session; against a server without it, memory only, as before. | 1 |
| F9 | The design system is a React DOM 18 bundle; React Native cannot render it. | Ported to React Native primitives under the same names and props, with tokens generated from `tokens.json`. Added to the system rather than to a screen: `TextField`, a third audio speed, `HonestTimeline`, `PendingStat`, `CoverageMeter`, `GlossCard`. | 1 onwards |
| F10 | Where does the frontend live? | **Resolved:** `lep-frontend/`, a project of its own next to `lep-backend/` in the "Learn English with play" folder, with its own `package.json`, README and this file. The corpus sweep reads the packed assets it ships. | 1 |
| F11 | Web local database. | **Revised:** no SQL database in this build. Device data (progress on this device, saved words, preferences) and the outbox are small key–value records in AsyncStorage on all three targets (localStorage-backed on web — never for a token). The course itself is read-only packed JSON, loaded on demand and cached in memory. A local SQL store is reconsidered when the server's sync bundle (F26) arrives. | 2, 8 |
| F12 | The full build. The repo holds A1 only; the 37,173-item corpus exists only as the packed bundle. And 37,173 or 37,203 (R6)? | Renderer and grader sweeps run on the packed bundle through an adapter to the build's envelope; assertions use the artefact's own count (37,173). Built and green (§8). | 2–3 |
| F13 | `spelling_variant`. | **Revised:** accept both, always; the setting chooses the **voice's accent** (`en-US` / `en-GB`) — and the course is shown as authored (mostly British spelling), since the packed bundle carries no per-lexeme spelling pairs to switch between. Lexical pairs (apartment/flat …) are accepted only for the item's own target lexemes, on word boundaries. Content defect C16 stands. | 3 |
| F14 | Normaliser semantics. | **Revised:** rule 1 (NFKC, quote/dash folding, whitespace) always; then the item's rules in the fixed order. `punct` strips `. , ! ? ; :` and quotation marks **anywhere**, matching the running backend's rule (backend brief §7.1) — a dictation learner is not failed for an inaudible comma, and items whose target is punctuation leave `punct` out. `typo1` is Damerau–Levenshtein ≤ 1 on exactly one word of ≥ 4 characters, never when the typed word is itself in the course's word list (form/from, quiet/quite, desert/dessert), never in `spelling_bee`, and says "watch the spelling". The shared vector file for client and server is still to be agreed (§11). | 3 |
| F15 | Timers. | Below B2, no countdown unless the learner opts into timed practice; from B2, the item's value. The games keep their clock — except in the screen-reader layout, where the race has no non-visual form. Speaking uses the limit as the recording's maximum and submits what was recorded. Every timer can be doubled or switched off. | 4 |
| F16 | Replay caps. | Below B2.1 replay is uncapped (plays still counted and sent); from B2.1, the item's cap. | 5 |
| F17 | The scaffolding ladder and transcripts. | docs/06 §1.1, applied only to comprehension listening (`listen_*`, story audio) and never where the text is the answer. Built in the Choice and Order renderers. | 4–5 |
| F18 | Hints. | Derived, never written: the key's first letter (`type_from_l1`), the span that differs (`error_correct`). The button says before the tap that it costs the no-hint tier; the hint count travels with the answer. | 4 |
| F19 | The session contract. | **Resolved (§21):** the backend added `a11y_profile` to the request, `phase` to every step, and `recovery` and `withheld` to the response; the app uses all four. The runner's own recovery pick (§9.3) remains the fallback. | 4 |
| F20 | Typed fallback for speaking. | The client sends `modality: "typed"`; it grades typed speech as text on the device (speak_prompt: any listed exponent of the targeted function counts, anything else is left to the server); the server writes no pronunciation aspect. | 5 |
| F21 | Onboarding timing. | Built: a neutral birth-year question first, steps 1–7, account creation, step 8 (the first sentence). The time from the first tap on "Get started" to the first sentence is kept on the device (`onboarding.firstSentenceMs`). **Revised (§7.4):** the client mirrors the server's under-13 rule only to stop kindly *before* seven steps; the server's refusal stays authoritative. | 7 |
| F22 | Locks, completion and node kinds. | The server decides locks and completion; until it does, every unit opens. Rings count populated tiers, filled for tiers finished *on this device* and labelled so. The `kind` union includes `clinic` and `checkpoint`. | 2 |
| F23 | L1 text for learners whose L1 is not Uzbek. | The client never shows `text_uz` or inline Uzbek to a learner whose L1 is not Uzbek: L1 prompts and pair glosses are re-derived from the lexeme glosses (Uzbek and Russian ship), Uzbek prose feedback is hidden from non-Uzbek L1s, and English is shown where no string exists. | 3 |
| F24 | Synthetic audio. | Shipped as a labelled deviation: every use of the device voice carries the "Synthetic voice" marker — including a recording that fails to load and falls back (§10). The 1,159 minimal-pair items whose spoken text is notation are withheld until recorded, and the learner is told how many. | 5 |
| F25 | Monetisation. | No ad SDK; no early-access gate; nothing behind a subscription in this build. | 6 |
| F26 | The offline contract. | **Revised:** the whole course (168 units, ~16 MB) ships inside the app as hashed data assets — never in the JavaScript bundle — so every lesson works offline on iOS and Android. On the web, units load on demand; the current and next unit are fetched ahead while online, and the static server caches hashed assets for good. The 7-day review window waits for the server's scheduler. | 8 |

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
| S13 | Warm-up p ≈ 0.90 (§6.1, following R10) | docs/07 §3.2 and docs/08 §5 step 5: p ≈ 0.95; docs/00 §4.2: ≈ 0.90 | Settled by R10 | 4 |
| S14 | Never close on a failure; the runner inserts an easy item (§6.1) | docs/07 §3.4 and docs/08 §5 step 6: the weakest-stability item *last* — against docs/07 §3.2 | **Resolved (F19, §21):** the server's plan carries near-certain `recovery` items and the runner plays one after a wrong last answer; without one (offline, an older server) it re-presents an item the learner got right in the same session (§9.3) | 4 |
| S15 | Feedback falls back to `incorrect_default` (§5.5) | docs/00 §4.3: *every* wrong answer returns the correct form, a why of ≤ 140 characters and a tap-through | 11,811 items carry no why; 3,942 defaults exceed 140 characters (§5). The sheet always shows the expected answer and whatever why exists; it never pads. | 3 |
| S16 | Offline: next 5 units + all due SRS items (§11, quoting docs/00 §6) | docs/08 §10 and docs/11 §3: next 5 units + 7 days of scheduled items — the spec disagrees with itself | F26 | 8 |
| S17 | Content is never bundled (§15) | docs/11 §3: the app ships with Section 1 embedded | F26 (revised: all sections, as data assets) | 7 |
| S18 | Silent | docs/11 §9: the learner keeps the syllabus version they started a section under | F26; every answer carries the content version it was given | 8 |
| S19 | Silent | docs/12 §7: an extra-time form of every assessment paper; WCAG 2.2.1 (timing adjustable) | F15 | 4 |
| S20 | No content behind a subscription (§8.4) | docs/10 §9: Premium removes ads and gives early access to new sections | F25 | 6 |
| S21 | Immersion ships seven surfaces (§10) | docs/06 §7.1 adds Song Studio, Writing Studio, Live Human Practice, Book Club | **Needs ruling at Phase 9.** | 9 |
| S22 | Silent on option order | docs/09 §4.1: distractor position randomised per presentation | **Decided:** shuffled per presentation (seeded), mapped back to the canonical index before grading and sending; `stress_tap` syllables never shuffled | 3 |
| S23 | `error_code` comes from docs/07 §6.1 (§5.2) | docs/07 §6.1 has no `GRAM`; every build item uses `GRAM` | Content defect C8. "GRAM" is never shown as a diagnosis. | 3–4 |
| S24 | — (backend R7) | docs/12 §4.3: C2 needs ≥ 80 %, no paper < 70 % | Tell the backend R7 is resolved by the doc | 7 |

---

## 3. The brief against the backend

| # | Topic | What conflicts | Resolution | Phase |
|---|---|---|---|---|
| B1 | Generated client | Brief §4 generates from `/openapi.json`; BD §2.10 turns it off in production | F7 (resolved: generated from the running server's schema; the snapshot is committed) | 1 |
| B2 | Problem slugs | Needed to tell a revoked session from an expired token and a 503 from a wrong password | F7 (resolved: `src/api/problem.ts`) | 1 |
| B3 | Web refresh storage | Brief §4.1's secure-store web fallback does not exist | **Resolved** — F8, §22 | 1 |
| B4 | Registration payload | BD §2.4 requires an IANA time zone as well as `birth_year`; BD §2.5: password 10–256 characters and not the email; 409 on an existing email | **Decided:** the client sends the device's IANA zone and mirrors the password rules as hints only; the server decides | 1 |
| B5 | Forgot password | The backend now emails a reset link (backend DECISIONS §14.3) | **Resolved (§22)** — the relay itself is backend R17; without one the screen explains how to get help, as before | 1 |
| B6 | Sessions | No accessibility profile, no phase tags, closes on the weakest item | F19 (**resolved**, §21: the profile, phases and recovery items are in the contract) | 4 |
| B7 | Grader | Backend brief §7.1: `punct` anywhere; plain Levenshtein `typo1` | F14 (revised: `punct` as the backend; `typo1` as docs/09 §5 rule 7) | 3 |
| B8 | Bundle endpoints | `/v1/content/bundle` vs `/v1/sync/bundle`; a 7-day window | F26 | 8 |
| B9 | Synthetic audio flag | The client marks the on-device path and server TTS alike | **Decided** | 5 |
| B10 | `say_for()` | The packed items carry resolved `say` strings, except `phoneme_id` option audio, resolved from the file name | Built that way; the server needs the packer's code or the resolved strings | 5 |
| B11 | Dispute | An answer graded offline has neither a review id nor a dispute token | **Decided:** disputes queue in the outbox keyed by the answer's `client_uuid` | 3 |
| B12 | Tier-3 timing | docs/08 §4.3 vs docs/09 §6 | F15 | 4 |
| B13 | Typed fallback | R3 | F20 | 5 |
| B14 | Rate limits | Buckets per IP and per learner | **Decided:** honour `Retry-After`, say "slow down a moment", never retry in a loop | 1 |

---

## 4. The brief against the build

### 4.1 Figures that are wrong or incomplete

Everything not listed here was verified exact — and is now asserted at app start and in the
corpus sweep: units, nodes, populated node-tiers (3,019), items per tier, per-type counts, the
1,910 empty keys, and the 31 instruction keys (longest English string 9 words).

| # | Brief | Build | Consequence |
|---|---|---|---|
| 1 | 6-pair items: 867 | 865 (tap_pairs 486, memory_match 357, word_race 22) | None |
| 2 | "Two pairs can share a surface on one side" | 0 repeated surfaces on either side; banks do repeat (48 `word_bank_build`, 62 `sentence_reorder`) | Keyed by index anyway |
| 3 | Bank sizes 1–12, mode 4 at 1,385 | That figure includes `gap_fill_bank`; the Bank family runs 4–12, mode 8 | Layout |
| 4 | "The answer is a subsequence, not a permutation" | `word_bank_build`: 800 of 801 carry two extra tiles; `sentence_reorder`: all 754 are exact permutations | No "use every tile" rule |
| 5 | 8,194 items have neither stem — seven types listed | The list omits `word_race` 211, `listen_order_events` 186, `sort_bins` 79 | None |
| 6 | Option counts 2 / 4 / 6 | The 224 six-option items are 186 `listen_order_events` and 38 `sort_bins` | Layout |
| 7 | `grammaticality_judgement` "is 4 s by design" | 607 at 4 s, 1,162 at 10 s | F15 |
| 8 | `error_code` from docs/07 §6.1 | All 1,419 are `GRAM`; each item's only rejected pattern is its own unedited prompt | C8 |
| 9 | 35,263 of 37,173 gradable offline | True only if speaking is answered by typing (the sweep confirms 35,263 correct + 1,910 ungraded) | Outbox and "will be marked" copy |
| 10 | Audio path → text resolution | Omits `a/F-NNN_NNNN.opus` and 145 malformed paths | Resolution on the server (B10) |
| 11 | "Caching by path is highly effective" | `a/gen_sentence.opus` is shared by 1,372 items with 720 different texts | Cache by content, never by path alone |
| 12 | `word_bank_build` prompt: `text_uz` | Empty on all 801 | C6 |
| 13 | Prototype at `app/index.html` | `Claude outputs/new-in-tashkent/` | Paths only |
| 14 | 37,173 items | Packed bundle 37,173; build report 37,203 | F12 |

### 4.2 Shapes the brief does not describe

* **Comprehension items carry only the question.** The passage is the unit's story episode; the
  renderer shows it as a script, with the audio and its transcript in one scroll region.
* **Answer mappings are keyed by surface.** The renderer keys by index and converts at the
  boundary.
* **`listen_order_events`:** one of the 186 is stored already in the keyed order, so it is
  shuffled too.
* **`sort_bins` always has exactly the bins `countable` and `uncountable`.**

### 4.3 Artefacts the briefs assume

`build/` covers A1 only; the packed data is under `Claude outputs/new-in-tashkent/data/`; there is
no `pack_app.py` (F12, B10). The app's own packer is `scripts/pack-content.mjs`.

### 4.4 The prototype

An executable specification of the renderer shapes and nothing more. It accepts every speak
answer and any non-empty `write_sentence`; its `contraction` rule never equates *I'm* and
*I am*; it ignores `constraints`; and it keeps a Gemini key in `localStorage` and sends it as a
query parameter. None of that was carried over.

---

## 5. Content defects to report

The client absorbs these and does not "fix" the content (brief §17). Each goes to the content
owner.

| # | Defect | Count | Client handling |
|---|---|---|---|
| C1 | `item.cefr` is `"A1.1"` everywhere | 37,173 per brief §17.1 (the packed bundle drops the field) | Never read (a guardrail test enforces it); the unit's level is used |
| C2 | `stress_tap` syllables do not spell the word | 380 of 906 | Detected at load; not presented; counted |
| C3 | Minimal pairs whose spoken text is notation | 1,159 of 1,811 | Withheld until recorded; the close screen says how many (F24). Addendum: some plain-text `say` strings are *descriptions* of the contrast rather than speech — withheld by the same detector where they match it |
| C4 | Minimal-pair options that differ only in capitals | 350 | Each option's accessible name states the stressed syllable |
| C5 | Audio paths with spaces, IPA or extra slashes | 145 | URL-encoded; resolved on the server |
| C6 | `word_bank_build` with an empty L1 prompt | 801 of 801 | Instruction and bank only; nothing invented |
| C7 | Items with a single option | 3 | Rendered; reported |
| C8 | `error_correct`: `GRAM` and the unedited prompt as the only rejected pattern | 1,419 | "GRAM" never shown; the matched feedback shows when it fires |
| C9 | No why for a wrong answer | 11,811 | The expected answer always shows; nothing padded |
| C10 | `incorrect_default` longer than 140 characters | 3,942 | Shown in full |
| C11 | Pragmatics items where more than one option is a listed exponent | 1,716 of 2,730 | Disputes expected |
| C12 | Pragmatics distractors that describe behaviour rather than say anything | 2,280 of 2,730 | Rendered as written |
| C13 | Every `speak_roleplay` prompt is the unit's can-do statement | 504 of 504 | Shown as the learner's goal |
| C14 | Timers below B2 and replay caps at every level | 3,910 / 5,715 | F15, F16 |
| C15 | Hints allowed but no hint content | 2,163 | F18 |
| C16 | US/UK "spelling" pairs that are different words | 13 of 21 (A1) | F13 |
| C17 | L1 content inside items | 1,145 pair items; 16,645 `incorrect_default` strings | F23 |
| C18 | Missing tiers: S08U04N4 tier 3 only; S07U17N4, S09U20N4, S10U01N4 no tier 1 | 4 nodes | Rings count populated tiers |
| C19 | Types used outside their specified range or form | as stated | Reported |
| C20 | The planned clinics and checkpoints have no content | — | F22 |
| **C21** | **New.** Syllable splits that spell the word but are not its syllables — S01U01's `stress_tap` for *hello* offers `hell` / `o` | Not counted (the load check can only see splits that do not spell the word) | Rendered; reported |
| **C22** | **New.** `gap_fill_bank` items where a second bank word is also right — "___! My name is Aziz." offers *Hello* (the key) and *hi* | Not counted | The dispute link; reported with C11 |
| **C23** | **New.** Immersion (N7) and review (N8) nodes carry no items in any unit | 336 nodes | They point to the Library and to Practice; the path's "Continue" skips them |

---

## 6. Stack

### 6.1 Considered and rejected

* **A Next.js web-only first build** — the speaking features and offline need native.
* **Separate native and web codebases** — doubles the renderer and grader surface.
* **Expo DOM components to reuse the React DOM design system** — budgets and screen-reader
  semantics suffer.
* **A PWA** — iOS gives a web page no reliable audio session or microphone control.

### 6.2 What was used (October 2026)

* **Expo SDK 57** (57.0.25): React Native 0.86.3, React 19.2.3, react-native-web, expo-router
  ~57.0.23 with typed routes and `Stack.Protected`. Installed with `npx expo install`
  (`EXPO_OFFLINE=1` where the Expo API is not reachable).
* **TypeScript ~6.0.3** strict, `noUncheckedIndexedAccess`. **ESLint 9** flat config with
  typescript-eslint's type-aware rules (`no-floating-promises`, `no-misused-promises`,
  `switch-exhaustiveness-check`), the React Compiler rules from `eslint-config-expo`, and the
  project's own token and RTL rules; zero warnings allowed.
* **TanStack Query** for server and content data; **Zustand** for device state; **Zod 4** for
  content shapes; **i18next + ICU**; **openapi-typescript + openapi-fetch**.
* **expo-secure-store** (native token), **AsyncStorage** (device data, outbox), **NetInfo**,
  **expo-speech** (device voice), **expo-audio** (recording, playback), **expo-file-system**,
  **expo-notifications** (native only), **expo-sharing**, **react-native-svg**.
* **Tests:** Vitest (pure TypeScript: grader, auth, outbox, runner, guardrails, the corpus
  sweep), Jest + React Native Testing Library 14 (components; its `render` and `fireEvent` are
  async), Playwright (web against the real backend).

---

## 7. Phase 1 decisions

### 7.1 Tokens and sessions — Decided

* The access token lives in memory only, on every platform. The refresh token lives in
  `expo-secure-store` on iOS and Android with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`. On web it
  lives in memory (F8).
* **Single-flight refresh.** One promise every caller awaits; the rotated refresh token is
  written to storage before the promise resolves.
* Outcomes: success → every waiter retries once. 401 on refresh → one sign-out, every waiter
  rejected, no second refresh. 503, 429 or no network → the session is kept. A lost response →
  one retry with the same token (F2).
* `session_revoked` on any request is a sign-out, never a refresh.
* **Added while building:** a sign-out that lands while a refresh response is being read, or
  while the rotated token is being stored, sticks — the late token is cleared and logged out on
  the server (§10). The access token's `sub` claim names the learner the moment a token exists
  (read without verification; `/v1/me` confirms), so device data is keyed before `/v1/me`
  answers (§10).

### 7.2 Errors — Decided

As written: one `ApiProblem` shape; copy chosen by `type`; `title` and `detail` never read;
`errors[]` reduced to field and message; "Report this" with the request id everywhere — and the
id the client sent is put back when a proxy answers without one.

### 7.3 Requests — Decided

As written: `X-Request-ID` (UUIDv7) on every request and kept across retries; 15 s / 20 s
timeouts; GETs retried twice on network failure; POSTs never retried automatically.

### 7.4 Registration — **Revised**

Fields: email, password, birth year, and the device's IANA time zone (asked only if it cannot
be detected). **The client mirrors the server's under-13 rule** — refuse whenever the learner
*might* be under 13 — only so a child is stopped kindly at the first step instead of after
seven; no request is made, the year is cleared and never stored or logged. The server's refusal
at registration remains the authority, and the client never computes `is_minor`.

### 7.5 Offline — Decided

NetInfo, the window's own online/offline events on the web, and request outcomes feed one
`online` state. While the network is up but the server did not answer, the app asks
`GET /health` every 15 s, so "we'll reconnect by ourselves" is true.

### 7.6 Logging and privacy — Decided

As written. Answer text, passwords, tokens, emails and birth years are never logged; the logger
redacts by key and by pattern, and a test proves it.

### 7.7 Design and accessibility — Decided

As written; the contrast test now exists and checks 92 text-on-background pairs per theme
(all ≥ 4.5 : 1).

### 7.8 Guardrails from day one — Decided

`tests/guardrails/` scans the source, the config and the exported web bundle (provider keys and
hosts, with a planted fixture proving the scan fires), token storage, age data, hearts/energy,
guilt copy, celebration on the feedback sheet, leagues, honest numbers, the data exit, quiet
hours, error copy, `item.cefr`, uploads of recordings, console use, raw HTML, and every
interface string in English, Uzbek and Russian with matching ICU placeholders.

---

## 8. Phase 1 acceptance — result

| # | Criterion | Result |
|---|---|---|
| A1 | Register → sign in → `/v1/me` renders on **web** | **Met** against the running backend (Playwright: onboarding → account → first sentence → path → Me shows the email) |
| A2 | …and on **iOS and Android** | **Not verified on a device.** The iOS and Android bundles compile (Hermes, `expo export`), and every native module used is in Expo Go. A run on a phone (Expo Go, or `eas build --profile preview`) is still needed. |
| A3 | 20 concurrent requests on an expired access token → one refresh, zero sign-outs | **Met** (Vitest against a fake server that rotates tokens and treats reuse as theft; a mutation removing the single flight fails 6 tests) |
| A4 | A revoked session → one sign-out, no refresh | **Met** (Vitest; Playwright: `session_revoked` on `/v1/me` signs out with 0 refresh calls) |
| A5 | A refresh answered 503, or lost → no sign-out | **Met** (Vitest; Playwright: a 503 on `/v1/me` keeps the learner signed in) |
| A6 | Losing the network shows the honest offline state and keeps values | **Met** (Playwright `setOffline`: banner shows, a lesson still opens, the banner clears on reconnect) |
| A7 | A 503 on sign-in is never "wrong password" and shows the request id | **Met** (Playwright with the server's own problem shape) |
| A8 | No `detail`/`title` rendered; every error shows its request id; no value echoed | **Met** (parser tests; component test; guardrail) |
| A9 | A render error shows the recovery screen, never a stack | **Met** (component test) |
| A10 | Both themes from tokens; colour literals fail lint; text pairs ≥ 4.5 : 1 | **Met** (lint rule; contrast test) |
| A11 | The refresh token never touches AsyncStorage or web storage | **Met** (guardrail + Playwright inspection of localStorage, sessionStorage, IndexedDB and cookies after sign-in) |
| A12 | A planted provider key fails the build | **Met** (guardrail with a planted fixture; web and native bundles scanned) |
| A13 | Typecheck, lint, both runners and `expo export` green | **Met** for typecheck (app, tests, e2e), lint (0 warnings), Vitest (all suites incl. the 37,173-item sweep), Jest, Playwright, and `expo export` for web, iOS and Android |
| A14 | 44 × 44 targets, accessible names, focus ring, nothing clipped at 360 px, pseudo and RTL pseudo | **Met, with one review left for a person:** no horizontal scroll at 360 px on every main screen (Playwright); accessible names and roles throughout; the pseudo and RTL-pseudo locales run on every main tab in Playwright — no untranslated key, no raw placeholder, mirrored, nothing scrolls sideways — and leave screenshots in `e2e/.results/a14-*.png` for the design review (§27) |
| A15 | Under 13: a kind refusal, the year cleared, nothing logged | **Met** (Playwright: no request is made, nothing kept in storage) |

---

## 9. What was built, and where it departs from the plan

### 9.1 Against the real backend

The client is generated from the running server's `/openapi.json` (7 operations). Sign-in is
the OAuth2 password form; register, refresh and logout are JSON; problem documents are parsed
exactly as `app/errors.py` emits them. Registration sends `l1`, `birth_year`, `tz`,
`daily_goal_min` and `spelling_variant` from onboarding. Account settings (`desired_retention`,
rest days, leagues, perfectionist mode, data-collection pause) are shown read-only: the server
has no way to change them yet. **Revised:** leagues are joined and left on
their own screen (§29).

### 9.2 Content

The packed bundle is copied byte for byte into `assets/content/` (`u001.lep` … `u168.lep`, plus
the derived `course`, `words` and `lexicon` indexes) by `scripts/pack-content.mjs`, with a content
hash (`contentVersion`) sent with every answer. The adapter maps the short keys onto the
build's envelope; node kind comes from the node's position (N1–N3, N5 lesson; N4 story; N6
speak; N7 immersion; N8 review); two instruction keys differ from `instr.<type>`
(`instr.mcq_word`, `instr.minimal_pair`). Units are parsed with Zod at load: an item that fails
its shape is excluded and counted, never crashes the lesson.

### 9.3 Sessions are composed on the device

There is no `POST /v1/sessions` yet, so the runner composes from the node-tier the learner
opened, in the docs/07 §3.2 order: warm-up (recognition items from node-tiers finished earlier in
the unit on this device), new input (the tier-1 words, grammar and phrases the items target —
presented, never tested; the story episode in every story tier), guided practice (60 %),
integration, production (speaking and free writing) and close. The build's order is kept inside
each phase. There is no REVIEW phase: which items are due is the server's scheduler's decision.
A wrong last answer brings one recovery item (one the learner got right in this session) before
CLOSE; after 12 minutes there is one 15-second break. A node-tier is "finished on this device"
only when the session reached CLOSE having practised something.

### 9.4 The outbox waits for the server

Every answer is an outbox row before anything else happens: `client_uuid` (UUIDv7, the
idempotency key), the item, the submission (bank answers with the text built), reaction time
clamped to [250 ms, 120 s], hints and plays used, start time, a monotonic clock, the content
version, and the device's verdict. Disputes are rows keyed by the answer's `client_uuid`. Rows
are never edited or merged; they are removed only when the server accepts them. Sync switches
itself on when `POST /v1/sync/reviews` appears in the regenerated schema; until then nothing is
sent and Settings → Privacy says how many answers are waiting. The device keeps at most 5,000
rows and says so if it is full.

### 9.5 Speaking

Recordings are private: they never leave the device (there is no speech endpoint), retakes are
unlimited, there is no live level meter, and every take — including one interrupted by leaving
the lesson — is deleted when the lesson ends. "Type instead" is on every speaking item and turns
the microphone off. The "train the speech model" opt-in of the brief is omitted: there is
nothing to opt into.

### 9.6 Interface languages

English is complete. Uzbek (Latin, with ʻ U+02BB) and Russian (ICU one/few/many/other) were
machine-drafted and need a native reviewer before release. Instruction strings follow the
interface language where the content has them (English, Uzbek) and fall back to English.

### 9.7 Web specifics

The web build serves the course as hashed static assets; `scripts/serve-web.mjs` caches them
for good and serves the page fresh. A reload signs the learner out (F8). Reminders are native
only; the web says so. The current and next unit are fetched ahead while online.

### 9.8 Reminders

At the time and with the cue chosen in onboarding; one a day by default, two if asked for (one
for a learner who may be under 18), never 21:00–08:00, cut to weekly after five in a row went
unopened (counted each time the app comes to the foreground), off in one tap. Signing out
cancels them and clears the setting, so they never fire for whoever signs in next.

---

## 10. Independent review

A separate agent, which had not seen the code being written, reviewed it against the brief's
rules and ran every suite. It found two blockers and several should-fix issues; all were fixed
and each has a test:

| Finding | Fix | Test |
|---|---|---|
| **Blocker:** answers were dropped when `/v1/me` failed after sign-in (no learner id yet) | The learner id comes from the session's token (`sub`) the moment it exists; a lesson does not start without one | Playwright "answers are kept while /v1/me is down"; Vitest "knows whose session it is" |
| **Blocker:** "Type instead" left the microphone recording, and its time limit then submitted a voice answer over the typed one | Typing stops the recorder; the limit only submits when the learner is still speaking | Jest "Type instead turns the microphone off" |
| A recording in progress survived the end of the lesson | The recorder deletes an interrupted take itself | — (native only; code path reviewed) |
| A sign-out during a token refresh could be undone by the late write | Generation checks before and after the token is stored; the late token is cleared and logged out | Two Vitest cases; a mutation removing the checks fails both |
| Device voice without the marker (phoneme options, saved words, a recording that falls back) | One `SyntheticVoiceChip`, shown wherever the device voice is used, and when a recording falls back | — |
| Reminders outlived sign-out | Cancelled and cleared on sign-out | — |
| No-audio learners were not told what was left out | The close screen counts it | — |
| Export file left in the cache; Android back at CLOSE skipped "finished"; no transcript link at A2.1–A2.2 in ordering; a wrong pair not announced; empty Practice did nothing; proxy errors lost the request id | All fixed | — |

Left as is, with reasons: a recovery item is stored as an ordinary answer (it needs no flag —
§21); the backend answers a revoked session's *access token* with
`invalid_token`, so revocation costs one refresh before the sign-out (harmless).

---

## 11. Waiting on others

**Backend** (updated 2026-10-08 — most of what this list waited on now exists and is used)

* Done and used: `POST /v1/sync/reviews` and disputes (the outbox), `POST /v1/sessions` (§14),
  `GET /v1/course` and `/v1/units/{id}`, `GET /v1/sync/bundle` (§15), `PATCH /v1/me/settings`,
  account deletion, server-side export and recording deletion (§16), the shared grader vectors
  (§12), and the session contract (F19, §21): `a11y_profile` on `POST /v1/sessions` and in the
  account's settings, `phase` on each step, `recovery` items and `withheld`.
* Also done and used (2026-10-09): password reset and change (B5, §22), the web refresh
  cookie (F8, §22), `GET /v1/capabilities` (§22), client events (F2, §23) and the level-exam
  report (§24).
* Recorded pronunciation scoring is in the app (§25) and switches itself on when the server has
  a scorer: it waits only on a provider (backend R15) — until then `GET /v1/capabilities` says
  `speech_scoring: false` and speaking stays self-assessed or typed (§9.5). Scored speaking
  *tasks* for the level's production condition, and the chat's microphone, wait on the same.
  The four level conditions (§17), the level exam (§18), writing with appeals (§19) and the
  memory check (§20) are in.

**Content owner:** C1–C23 above, and recorded audio (F24), which unlocks the 1,159 withheld
minimal pairs and removes the synthetic-voice deviation.

**Design:** native screenshots on a device; the pseudo and RTL-pseudo locales reviewed on
screen.

---

## 12. Audit and engagement groundwork — 2026-10-03

An independent audit of the app (each finding verified against the code and the corpus before
fixing). Fixed:

| Finding | Fix |
|---|---|
| Web: a font that failed or timed out (the web loader gives up after 12 s and never retries) left a blank page forever | `useFonts` error is a fallback to system fonts, logged |
| Web: two open tabs cached their own outbox index and overwrote each other's, orphaning answers; native: row and index were two writes | The outbox has **no index**: one answer is one `setItem`, rows are found by key prefix (`keysWithPrefix` + chunked `multiGet`); tests for two tabs and for one-write-per-answer |
| A failed outbox write was only logged — the learner was told nothing | Treated like a full outbox, in the lesson and on the close screen (which no longer says "saved" when it was not) |
| A failed `words`/`lexicon` load was cached forever, so Retry could never succeed | The failed promise is dropped |
| Story tap-gloss: "hates" → *hat*, "cares" → *car*, "noted" → *not* | Shorter inflection strip first (e-final stems keep their e) |
| Offline app opens were not counted, so reminders were cut to weekly for learners who did open the app | Upkeep runs signed in with or without `/v1/me` (the stricter minor schedule until it answers); TanStack's online and focus managers follow NetInfo and AppState on native |
| A stalled refresh body (expo fetch on Android has no read timeout) held the single-flight refresh and every request behind it | One overall deadline per refresh, body included |
| On native, rebuilding a response without `X-Request-ID` turned its body into "[object ReadableStream]" | The body is read first |
| The packer emptied `assets/content` before validating | It writes to a staging folder and swaps it in after every check |
| `word_race`/`memory_match` timing out discarded every match and graded the whole game Again | The renderer registers its progress; expiry submits `{kind:'pairs', …, complete:false, timed_out:true}`; matched pairs count; the sheet says "you matched 7 of 12" |
| `tap_pairs` graded correct however many wrong pairs were tried (docs/09 #1: any mismatch = Again) | Every attempt is recorded; a mismatch makes the item incorrect with the confused pairs marked. `memory_match` (wrong flips are the game) is unchanged |
| Punctuation-target `error_correct` accepted the sentence handed back unchanged | The unedited prompt (a rejected pattern under rule 1 + case) is always incorrect |
| The item clock kept running behind the leave dialog | Paused while the dialog is open |
| VoiceOver heard no verdict (the sheet relies on an Android live region) | Announced on iOS when the sheet appears |
| `listen_order_events` move buttons unreachable with VoiceOver | Move up/down offered as accessibility actions on the row |
| A second tap on the close screen navigated twice | `finish`/`leave` are idempotent |
| Recording start had no "starting" state: "Type instead" during start could leave the microphone on | A `starting` phase, a cancellation generation, and `cancel()` that stops and deletes the take |
| `gap_fill_bank` highlighted a different card than the verdict | The highlight comes from the grader |
| A recorded clip that was stopped could fall back to the synthetic voice later and play twice | Fallback only for the current call; superseded players resolve |
| Russian pair glosses can collide (two lexemes, one gloss) | A tile whose gloss reads the same as the partner's counts as the partner |
| Duplicate React keys for homograph chips on the close screen | Keyed by lexeme id |

**Client and server grade alike.** The server's grader is a port of this one;
`tests/sweep/vectors.test.ts` (run with `LEP_EXPORT_VECTORS=…`) exports the verdicts this grader
gives to ~107,000 submissions over the real corpus, and the backend's parity test replays them.
Regenerate the fixture whenever `src/grading/` changes. This settles F14's "shared vector file".

**Sound and haptics** (docs/16 E07). `scripts/gen-sounds.mjs` synthesises 24 effects — bells,
a Karplus–Strong dutar pluck and a doira stroke, no samples — byte-for-byte reproducibly
(`npm run gen:sounds`). `src/audio/sfx.ts` plays them with the mixing rules of E07: at most two
in 500 ms, celebrations wait for the voice (≤ 1.5 s) or are skipped, "calm" celebrations, and
nothing with *practise without audio* or *sound effects* off. Haptics are a separate preference
and never fire on the web. The guardrail that kept `expo-haptics` out of the code now allows it
only in `sfx.ts`; the feedback sheet still has no haptic and no celebration. In a lesson: a soft
chime per graded answer, the combo chime every 5 in a row (a hint keeps the run without adding
to it), a pop on each pair matched, and the complete chime once at CLOSE.

**Engagement design.** docs/16-ENGAGEMENT-DESIGN.md (in the content repo) is the product design
for the motivation layer; this app implements it as the server endpoints arrive.

## 13. Chat with the cast — the AI conversation partner (docs/16 E21) — 2026-10-04

The backend now offers `/v1/ai/*`; the app uses it as follows.

| Decision | Why |
|---|---|
| Shown only when the server offers the endpoints **and** `GET /v1/ai/status` says `available` | No teaser for a feature the server cannot run (E21 screen 5). Every learning path works without it |
| Entry point: a "Chat with the cast" shelf at the top of the Library (characters met so far, the current unit's scenario and the two before it); route `/chat/[characterId]?unit=` | E21 screen 1b. The N6 speak-node entry (1a) waits for the node sheet rework |
| One screen, three steps: pre-chat card (portrait, "AI character, not a real person", goals, fluency/accuracy, the 30-day retention line, today's allowance) → chat → end card | E21 screens 2–4 |
| Portraits are drawn from shapes and nine new `cast-*` colour tokens (skin, hair, features); `smile` and `talk` expressions; the typing indicator toggles them every 300 ms, a still "…" with reduced motion | No external art (docs/16 "Art and sound"); colours stay token-only |
| A learner turn is shown at once and keeps its `client_uuid`; a failure leaves it on screen with *Try again*, which resends the same id | The server answers a retried id once (backend DECISIONS §7.3) |
| Recasts are underlined in the reply (server spans) and explained on tap: "You said “…”. A more natural way: “…”." Fluency mode receives none until the end card | docs/07 §6.2; E21 screen 3 |
| Goal chips tick from the server's `subgoals_met`, with the `quest` sound | Nothing is detected on the device |
| End card: goal reached / "Good practice. The goal can wait for next time.", two things to work on, words used, XP from the server, *Practise again*, *Done*, *Delete this conversation* | E21 screen 4 |
| ~~Not built: *Add to my reviews* on a focus item~~ — **built as saving its words (§26)** | A recast is free text with no memory item to schedule; the course words it brought in can be saved for practice instead |
| Not built: the microphone in the chat | Needs server speech recognition, which waits on a provider (backend R15) |
| Problem types `ai_unavailable`, `ai_allowance`, `ai_ended`, `ai_busy` have their own copy | Chosen by type, never by title (§7.2) |

Review fixes (2026-10-05), matching the server's turn rules (backend DECISIONS §11.4):

| Decision | Why |
|---|---|
| One turn in flight at a time: *Send*, *Try again*, *End chat* and *See how it went* wait while a reply is being written | The server answers turns in order and refuses a second request for the same reply (409 `ai_busy`); a second `mutate` on one TanStack observer would also drop the first one's callbacks |
| A failed message is tried again with its own id before anything new is sent (*Send* waits); a failed turn shows its own error, not the latest request's. A message the server refuses as invalid (422) goes back into the input instead, and `rt_ms` is never negative (a clock set back) | A message that failed on the device (a timeout) may still be answered on the server, or answered already; retrying it gets that reply, in its place, so the transcript on the screen is the server's |
| Starting a chat and sending a turn wait up to 90 s (`AI_TIMEOUT_MS`); everything else keeps 15 s | A reply held to the learner's level can take two model calls; both requests are idempotent, so a timeout is retried safely, but a shorter timeout only produces `ai_busy` retries |
| *Start chatting* sends one `client_uuid` per start, kept across retries (a new one after the chat, or when the mode changes) | A start the device gave up on is returned, not charged twice (backend DECISIONS §11.4) |
| Recast spans are UTF-16 offsets from the server, sliced as such; an out-of-range span is not underlined | An emoji before the phrase no longer shifts the underline |
| A recast is a nested `Text` with role `link` | Android exposes a clickable span to TalkBack only for links; VoiceOver handles both |
| The explanation scrolls into view, is announced (live region) and is cleared by the next message | It used to land below the fold and stay under replies it did not belong to |
| Goal chips and the end card's goals are accessible elements whose label carries the state ("Greet people: done") | `accessibilityState` on a non-accessible view is never read |
| When every goal is met, a notice offers the end card, with *Keep chatting* | E21 screen 4 lists "goal met" as a trigger; the learner keeps the choice |
| The chat room carries the "AI character, not a real person" chip above the goals | E21: the AI is labelled wherever it speaks, not only before the chat |

## 14. Lessons composed by the server — 2026-10-04

Supersedes §9.3 for node-tiers when the server can be asked.

| Decision | Why |
|---|---|
| Opening a node-tier calls `POST /v1/sessions {minutes, node_id, tier}` when the server offers it, the learner is signed in and the device is online; minutes = the tier's estimate + 3 for the due reviews the server mixes in | docs/08 §5: the scheduler, not the device, decides what a session holds |
| The plan's order is kept exactly; the app only adds NEW INPUT cards before the first lesson item, labels production items, withholds what the device cannot present (counted), and drops the server's planned break — the runner already takes one by the real clock after 12 min | Presentation is the app's; selection and order are the server's |
| Answers carry the server session's id as `session_id`; reaching CLOSE posts `/sessions/{id}/complete` (fire and forget) | The server credits the node-tier against its own plan |
| `409 tier_locked` with `available_at` (tier 3 within 3 days of tier 2): a calm screen with the day and time it opens — a fixed time, never a countdown — and *Water the garden* | Spacing is structural (docs/08 §4.3) |
| `409 tier_locked` without a date (the server has no record of the previous tier): if **this device** finished it **in the last 24 hours**, compose on the device (its answers may still be in the outbox) — and tier 3 still waits three days after the device's tier-2 time; otherwise offer the previous tier | Offline-first, but bounded: the device marks a tier done at its close, the server only when it was passed, so an older device record must not open the next tier for ever (`deviceGate`, review fix 2026-10-05) |
| `409 new_items_capped`: no lesson, a calm reason, and reviews offered | The day's cap on new material (docs/08 §5) |
| Offline, a network error, a 5xx, an older server, or a plan the packed content cannot play — none of its items, or **any** of the node-tier's own lesson items missing: compose on the device, as before | A lesson always opens, and a review-only plan is never marked as the node-tier done |
| A plan step in a unit this build does not pack is skipped, not loaded (only units in the packed course outline are fetched) | A newer content version on another device must not turn the lesson into an error screen |
| The close screen's *Next* never offers tier 3 straight after tier 2 | Tier 3 opens three days later; *Next* goes to the following node |

## 15. Watering the garden offline — 2026-10-06

| Decision | Why |
|---|---|
| After each sync at start-up and on return to the foreground, the app saves `GET /v1/sync/bundle`'s due window (the next seven days of reviews, each with the exercise the server chose) under `lep:learner:<id>:due-window` | docs/00 §6: offline the device holds all due SRS items. Saved after the outbox is in, so the window already counts what was just answered. Under `lep:learner:`, so signing out clears it |
| When the server cannot be asked, `/review` plays the saved reviews whose `due_at` has passed — soonest first, one per memory item, none answered on this device since the window was saved, at most 15 | The dates and exercises are the server's, so this is not a guess (rule 8); the answers go to the outbox and the server re-derives every state from them. At worst a review is played once more than the server would have asked (it was reviewed on another device after the save) |
| With no saved window, the route still says it needs the server, as before | Never an invented queue |
| The app packs the whole course, so the bundle's unit list and hashes are not used to download anything yet | They serve builds that pack fewer units (docs/11 §3: Section 1 embedded, the rest on demand) |

## 16. The account's data controls (docs/11 §10) — 2026-10-06

| Decision | Why |
|---|---|
| Me → Privacy shows three switches the server keeps: voice recordings (`voice_consent`), help improve speech scoring (`training_opt_in`, off by default) and pause data collection | They are the learner's choices about the account, not this device; each says plainly what it does — turning recordings off deletes every recording, nothing uses the training opt-in yet |
| Offline the switches are disabled with the same sentence as the learning settings | A change made offline would be a promise the server has not heard |
| *Export my data* now includes the account's own copy (`GET /v1/me/export`: every row, recordings as base64, no secrets) beside the device data; when it cannot be fetched the file still holds the device data and a notice says so | The data exit stays within three taps of Me (guardrail 10) and is complete when it can be |
| *Delete my recordings* (after a confirmation) and *Delete my account* (password required; a wrong one changes nothing) call the server; after the account is gone, everything on this device goes too and the learner is signed out | docs/11 §10. The old "write to support" copy stays only for a server without these endpoints |

## 17. The four conditions of a level award (docs/00 §7) — 2026-10-06

| Decision | Why |
|---|---|
| Progress shows, after the level card, what the current CEFR level's award asks for: coverage, retention, the level exam, and writing and speaking, each met or not yet with the server's value against its threshold (`GET /v1/progress/level/{level}`) | Phase 6 asks for "the four level conditions"; the path alone never awards a level |
| Each row is written in the learner's language from the value and threshold; the server's own shortfall sentences (English) are not shown | Text from the server is never interface copy (§7.2) |
| An exam passed on fragile memory shows docs/12 §4.3's sentence, translated | The honest message the spec asks for, in a language the learner reads |
| A condition with nothing measured yet says so ("hasn't been taken yet", "haven't been scored yet"); the card is absent until the server answers | Rule 8: showing nothing beats a guess |
| The exam row offers *Take the {level} exam* (§18) and the production row *Write for {level}* (§19) while they are not met; speaking cannot be scored until a speech provider is chosen, so production stays "not yet" for everyone | Recorded in §11; the conditions are shown honestly rather than hidden |

## 18. The level exam (docs/12 §4) — 2026-10-06

| Decision | Why |
|---|---|
| `/exam/[level]`, reached from the exam row of the level conditions: rules, then (once the server has formed or resumed the exam) the number of questions, the time it ends and the pass marks, then the papers | The learner knows the bar and the deadline before the first question |
| The items are found in the packed course by the garden's search (`locateItems`); ids this build does not have are counted and said before the exam starts — they stay unanswered and count as wrong | Never a substituted item; the server grades the form it made |
| The assessment runner's `exam` mode stores every answer in the outbox under the exam's id, as a test-out does, but shows no verdict and no hint until the end | A verdict mid-exam would teach the next item; docs/12 measures what is known |
| At the end the outbox is flushed and the exam marked (`POST /v1/assessment/exams/{id}/complete`); offline, the answers stay saved and the screen says they count only if they reach the server before the end time | The server marks only answers it *received* in time (backend DECISIONS §11.2) |
| The result shows the overall share and each paper against its bar; passing is one condition of the award, never the award | docs/00 §7 |

## 19. Writing for a level, and appeals (docs/12 §5) — 2026-10-06

| Decision | Why |
|---|---|
| `/writing/[level]`: the level's tasks (the English prompt and a word range), a text field with a word count that counts as the server does (words between spaces; it accepts five or more), and *Send for rating* | The range is guidance for the task criterion, not a gate; the server's own minimum is the only refusal |
| The score shows the overall band, each of the five criteria with its band and the learner's own sentences quoted as evidence, and the level's band | Every score carries its evidence (backend DECISIONS §9.2) |
| A score from a rater not yet calibrated against human raters is labelled practice feedback that does not certify a level; a borderline score says a person will check it | The κ gate (backend §9.3), said plainly |
| With no rater available the text is saved and the screen says it will count on Progress once rated | The server keeps it `awaiting_rater` |
| *I think this score is wrong* sends one appeal with the learner's reason; a second appeal is refused with its own copy | A score may be appealed once, to a person who does not see it |
| Refusals with a `reason` slug (`assessment_conflict`, `media_refused`) get their own copy where the app has words for the reason — "data collection is paused…", "voice recording is off…" — and general copy otherwise; the five problem types the server sends that the app did not know are now known | Copy is chosen by type and reason slug, never by the server's text (§7.2) |

## 20. The monthly memory check (docs/08 §9) — 2026-10-07

| Decision | Why |
|---|---|
| `/audit`, reached from the coverage card (*Check my memory*): about 20 items the memory model calls well known, found in the packed course like the exam's, answered with feedback; each answer goes to the outbox under the check's id and counts as a review | Every item checks a different memory item, so feedback on one does not teach another; the answers are practice too |
| The result says what the model predicted and what was remembered, and — when memory was weaker by more than the server's gap — that reviews will now come a little more often, with the new target | The retention target stepped up on the server and every due date was re-derived (backend DECISIONS §9.5); the learner is told why their reviews change |
| A refusal is said with its own copy: once a month (`too_soon`), not enough known yet (`too_few`), the day to answer has passed (`expired`, with *Start a new check*); a server that cannot be reached leaves the answers saved and says to check again within the day | The check is answered cold within 24 hours; nothing is lost and nothing is guessed |
| After the check, progress, the due queue and the profile are refetched | Coverage is now checked rather than estimated, and due dates may have moved |

## 21. The session contract: profile, phases, recovery (F19) — 2026-10-08

The backend now carries what F19 asked for (B6). This extends §14.

| Decision | Why |
|---|---|
| `POST /v1/sessions` names this device's profile: `a11y_profile: {no_audio, no_vision}`, from the two accessibility switches | docs/00 §6: the server chooses only exercise types the learner can be shown, so the plan holds what this device will present. The device still withholds what it cannot present itself, and counts it |
| The switches stay a device preference. The account keeps a copy (`a11y_no_audio`, `a11y_no_vision`, `PATCH /v1/me/settings`): a change in Settings is sent in the background when signed in, and at start, when `/v1/me` shows a different copy, the device's is sent once per learner and profile. Nothing waits for it; a failure is logged and tried again at the next start. Nothing is sent signed out, or to a server whose `/v1/me` settings carry no profile (an older one; review fix 2026-10-08) | The switches decide how an exercise is shown on this device, so the device is the record. The server needs the copy where the app does not name the profile: the due queue, the offline window (`GET /v1/sync/bundle`), and crediting a node-tier it did not compose |
| With a switch on, the outbox sends the copy before it sends answers, unless `/v1/me` (or an earlier send in this run) shows the account already holds it; a send that cannot reach the server is tried again before the next sync, one the server refuses is not, and the answers go either way. Not signed out (a sync timer can outlive the session), nor to an older server (`a11yCopyFirst`, review fixes 2026-10-08) | The server credits a node-tier it did not compose when its answers arrive, by the copy it holds then. A switch turned on offline, or on a device whose copy `/v1/me` has not confirmed yet, would otherwise let a tier played without its sound exercises arrive first and never count |
| Each item keeps the server's `phase`; the close item is shown as a review, as before. A plan without phases (an older server) gets the device's own: the first 60 % of the lesson's practice items guided, the rest integration, speaking and free writing production | The phase is the server's decision, like the order. The fallback keeps older plans playing |
| NEW INPUT stays the app's: cards before the first lesson item, never tested | The server never sends a `new_input` item (docs/07 §3.2) |
| Lesson items the server left out for the profile (`withheld`) are counted on the close screen with the device's own — only ids this device has, each once | Only "no audio" withholds on the server (minimal pairs and `phoneme_id`, the app's `EXCLUDED_WITHOUT_AUDIO`), so the existing sentence ("…because you practise without audio") stays true. The server passes the node-tier on the items that can be shown |
| The server's `recovery` items (up to two, near-certain, not in the plan) travel with the session; their units load with the plan. After a wrong last graded answer the runner plays the first one not yet answered that this device can show. Without one it re-presents an item answered correctly, as before. Still one recovery item per session, marked `recovery` in the runner's record | docs/07 §3.2: never close on a failure — now with an item the memory model expects the learner to get right, not one the device guessed |
| A recovery answer goes to the outbox as an ordinary answer, with no flag; so does the runner's own pick | The server chose its recovery item as a near-certain memory item, so the answer is a real (early) review and the server needs no flag (backend DECISIONS §14.2). Nothing is waited for |

## 22. The account: a forgotten or changed password, the web's refresh cookie — 2026-10-09

The backend built what B5 and F8 waited for (backend DECISIONS §14.3–14.6, §14.10).

| Decision | Why |
|---|---|
| `(auth)/forgot` asks for the email and sends `POST /v1/auth/password/forgot`; the answer is always "if an account uses this address, a link is on its way", with how long the link works and that it works once | The server answers the same for every address; so must the screen, or it would tell anyone which addresses are registered |
| Where the server has no mail (`password_reset_unavailable`, or `GET /v1/capabilities` says `password_reset: false`, or an older server), the screen explains how to get help, as before | An absent feature is shown as absent, never as an error |
| `/reset-password?token=…` (and `lep://reset-password?token=…`) is a screen outside both auth guards, so the letter's link opens whether or not someone is signed in here. The token is sent once and never logged or kept. A reset ends every session on the server, so a signed-in device signs out too, and the learner signs in with the new password | The server revokes every session on a reset (backend §14.3) |
| A dead link (`reset_link_invalid`) or a page opened without one says so and offers a new link | Links work once, for 30 minutes, and a newer one replaces the old |
| Settings → Privacy and data → *Change password*: the current password, then the new one. The other devices are signed out, this one stays signed in; the fields are cleared once it succeeds | `POST /v1/me/password` (backend §14.3) |
| A refused new password — at registration, reset or change — is explained on the field by its reason (`password_refused` with `common`, `pattern`, `context`, `breached` or `unchanged`), in the learner's language | The server never echoes the password; the reason slug is enough for honest copy |
| On the web, the auth requests ask for the refresh cookie (`X-LEP-Token-Transport: cookie`, credentials included). A token response with `refresh_token: null` means the token is in an httpOnly `__Host-` cookie: script keeps nothing, the device remembers only that a cookie session is expected (`lep:device:cookie-session`), and a reload restores the session with one refresh. Refresh and sign-out send an empty body | F8: a web learner no longer signs in again on every reload, and no script can read the token |
| Every refresh through the cookie holds a browser-wide Web Lock (`lep-refresh`) | All tabs share the cookie; two refreshing at once would present one token twice and the server's strict reuse rule (backend §2.6) would end the session |
| A server without the cookie flow answers with a body token: kept in memory, as before. A native build never accepts a token response without a token (a failed sign-in, never a crash) | Older servers keep working; the keystore stays the native record |
| `GET /v1/capabilities` (public, cached 5 min) is read with a client that sends no token (`publicApi`); unknown when the server cannot say | The same client serves the forgot and reset screens, which run signed out |

## 23. Client events (F2) — 2026-10-09

| Decision | Why |
|---|---|
| Four events are counted on the device: `refresh_response_lost` (the session's retry), `outbox_full` (an answer the outbox could not keep), `server_plan_unplayable` (a server plan the packed content could not play) and `audio_fallback` (a recording that failed and the device voice spoke instead) | The list the backend accepts (backend §14.6); each answers a question only the device can see — first of all R13, the grace window |
| Counts are per device (`lep:device:client-events`), capped at 1,000 a name, and carry no learner, no id and no text; they are sent as names and counts with the platform and the app's version | Nothing personal leaves the device with them; signing out does not lose them |
| They are sent at start-up and on return to the foreground whenever the network is up, signed in or not; only what the server accepted is taken off, so a failure or an event counted meanwhile is kept | Never in the learner's way, never counted twice |

## 24. The report after a level exam (docs/12 §9.2) — 2026-10-09

| Decision | Why |
|---|---|
| After an exam's result, *See the full report* opens `GET /v1/assessment/exams/{id}/report` | docs/12 §9.2 asks for a full report after every level exam |
| It opens with the note that this is an internal assessment, not an accredited qualification; each paper shows its score with its two bars and a band word (secure, at the level, borderline, below), answered of asked, and seconds per answer; the overall is shown with the papers, never alone | docs/12 §9.3: no single score without an explanation |
| A skill that has not been assessed at the level (writing or speaking with no rated task) says "not assessed yet" — never 0 % or band 0 | A missing measurement is not a low one |
| Error types are the learner's own counts, with the plain sentence that no comparison with other learners exists yet | §9.3: no comparison with other learners, and the server has no norms to compare with |
| Vocabulary says how many words are known (and of this level) and that the coverage figure is an estimate; fluency shows the level's reading and speaking targets, and that the learner's own speech rate is measured once recorded speech can be scored | No number the evidence does not support |
| *Work on* lists up to five targets; one the content names opens its unit | A specific next step, as §9.1 asks of checkpoints |
| The timeline is units left at the learner's pace of the last four weeks, in weeks — or, with no pace yet, the units left and that an estimate will appear | Never a promise, never an external band |

## 25. Pronunciation, scored on the server — 2026-10-09

The server scores recorded speech (backend DECISIONS §10.3–10.5): `POST /v1/media/speech`
answers at once with a job, the scorer runs after the response, `GET /v1/media/jobs/{id}` has
the result. No provider is chosen yet (R15), so in practice this is off; it switches on by itself.

| Decision | Why |
|---|---|
| Only `repeat_after` and `read_aloud`, the items with a text to say; only when `GET /v1/capabilities` says `speech_scoring`, the learner agreed to voice recording, data collection is not paused and the device is online. Otherwise nothing is uploaded and speaking is exactly as before | GOP needs an expected text; consent is the learner's (docs/11 §10), and an absent feature stays absent |
| The caption under the microphone says which: "stays on this device" or "is sent to check your pronunciation, and deleted within 30 days" | The learner knows before they speak where the recording goes |
| The take is sent after the answer is submitted — base64 of the recorded file with its real type (Opus in WebM on the web, AAC in MPEG-4 on iOS and Android) and its length — and the lesson never waits: the result appears beside the feedback while the item is on screen, polled for about a minute, then left to the server | Brief §7.3: speaking must not become a gate; a slow scorer must not slow the lesson |
| The result: one headline out of 100, "clear" or "worth practising", at most two notes built in the learner's language from the phone data ("in “ship”, /ɪ/ sounded like /iː/"), each word with its score, and the day the recording is deleted | docs/02 §10.2: one number, at most two specific notes, never a mark against an accent |
| A refusal is said by its reason (consent, paused, today's recording time); any other failure says the check could not be done and the answer still counts | The answer was already given; the check is extra |
| The device still keeps no take after the lesson; the server keeps it until its `expires_at` (≤ 30 days) and deletes it sooner on request (Privacy and data) | docs/11 §10 |

## 26. Keeping the words a chat correction brought in — 2026-10-09

| Decision | Why |
|---|---|
| Under each "thing to work on" on the chat's end card, the course words the correction brought in — words of the corrected form the learner's own words did not have, found in the course lexicon (regular inflections too), at most three, little grammar words left out — are buttons that save the word to Practice → My saved words, and remove it again | §13 left *Add to my reviews* unbuilt: a recast is free text with no memory item. Saving its words uses the path the story reader already uses, and never writes a review the learner did not give |
| A correction that only reorders or inflects what was said (no new course word) gets no button | Nothing to save; the correction itself stays on the card |
| Not done: scheduling the corrected *pattern* (a grammar point) as a review | It needs the server to map free text to a syllabus item, and the review log must record only answers given (backend replay rule) |

## 27. The test locales, run in a browser — 2026-10-09

The web build was run end to end against the real backend (Playwright, 12 tests): the account
flows of §22 in a browser — the refresh cookie surviving a reload, `httpOnly` and `SameSite=
Strict`, cleared on sign-out; a forgotten password from the letter in the backend's file outbox
to signing in with the new password — and the pseudo locales on every main tab (A14).

| Finding | Fix |
|---|---|
| In `pseudo-rtl` every string with a placeholder showed its raw ICU text (`{date}`, mirrored on screen to `{etad}`). `pseudo-rtl` is no BCP 47 tag, and the ICU formatter threw for it | i18next-icu now formats with `icuLocale` (`parseLngForICU`): the test locales format as English |
| In both pseudo locales every plural message was broken: the generator accented the keywords between branches (`other` → `öţħéŕ`), so the message no longer parsed | The generator now parses ICU structure: argument names, types and branch keywords are kept, branch texts are accented, `#` stays |
| Two Playwright tests still expected answers to wait on the device (written before the server had `POST /v1/sync/reviews`) | They now check that the outbox empties and the server holds every answer (its own data export), and accept the path's label once the server has credited the tier |

A component test formats every message of the catalogue in both test locales with its placeholders
filled, so a broken message fails the build. The run needs the backend started with
`LEP_WEB_REFRESH_COOKIE=true` and `LEP_MAIL_BACKEND=file` (`E2E_MAIL_DIR` names its outbox) and the
web build pointed at `http://localhost:8000`: the app on `localhost:8081` and the API on
`localhost:8000` are one site, as the cookie requires. The tests that need them skip themselves
otherwise.

## 28. The performance budget, measured — 2026-10-09, closed 2026-10-10

| Decision | Why |
|---|---|
| `npm run export:web` turns on Expo's tree shaking for the web export only (`scripts/export-web.mjs`; Metro's `experimentalImportSupport` only under that flag). The web bundle went from 4.08 MB to 3.76 MB; the whole Playwright suite passed on the tree-shaken build. Native builds are unchanged until it is tried on a device | Brief §15: under 4 MB. Zod (≈ 500 KB with its 45 locales) and unused animations were shipped whole |
| `src/content/schemas.ts` uses `zod/mini` (same schemas as functions); the corpus sweep parses all 37,173 items as before | Smaller once tree-shaken |
| `npm run check:budget` fails above 4,000,000 bytes of JavaScript | A budget nobody measures is a wish (brief §15) |
| `e2e/performance.spec.ts` (opt-in, `E2E_PERF=1`) measures cold start to the path and an exercise render with the CPU slowed ×4 (`E2E_CPU_SLOWDOWN`). The render is timed in the page (a `MutationObserver` from the tap on "Continue" to the next exercise in the DOM), on node `S01U01N2`, answered by the same `answerCurrent` driver as the e2e lessons | First run on this saturated development laptop: cold start 1.7 s at ×1 and 3.7–4.4 s at ×4 — **over** the 2.5 s budget |
| The CPU profile of that start showed ≈ 105 ms in `intl-messageformat` — i18next-icu parsed every string, plain ones too — and ≈ 30 ms building the two pseudo locales. Now `src/i18n/index.ts` returns a message without `{` as it is (the catalogues use no ICU quoting, so such a string has nothing to format), and the pseudo locales are built by `loadLanguage` only when one is chosen. A component test checks that a plain message skips the parser and one with an argument is still formatted | The two largest costs of a start that were ours to remove |
| After: cold start 395 ms at ×1; at ×4, 1,294 / 1,319 / 1,395 ms over three runs; exercise renders 13–16 ms at ×1 and 14–63 ms at ×4 (medians 25–51 ms). Within the budget (2.5 s, 100 ms) on this laptop; the whole Playwright suite passes on the same build | Measured in a desktop browser with the CPU throttled, not on a phone: the figures for a real mid-range Android wait for the device pass (A2), like backend R16 |

**Later the same day** (after §29 was added): five more runs at ×4 gave 1.64–1.80 s, and runs of
one unchanged build at ×1 ranged 365–813 ms. A CPU profile of that cold start shows no league
code and no catalogue cost at all (the tabs mount lazily, so the leagues query runs only on Me);
the time is the path's own rendering and content parsing. The spread is this laptop's load, which
is why one run proves little and a phone measurement is still owed (A2). Every run stayed within
the 2.5 s budget.

## 29. Opt-in weekly leagues (docs/16 E23) — 2026-10-10

The backend built leagues (backend DECISIONS §15); this is their screen.

| Decision | Why |
|---|---|
| Me → *Leagues* (and Settings → Learning → Leagues) opens `/leagues`. Off, it says "Off. Join if you like." and shows the explainer word for word: a weekly XP ladder with 30 people at a similar pace, that some find it stressful, and that you can leave any time. Below it: what others see — the display name and the week's XP, nothing else | docs/16 E23 screen 1; docs/10 §6: offering is fine, defaulting is not |
| Joining is one request, `PATCH /v1/me/settings {leagues_opt_in: true, display_name}`, sent only from the join card's button. The name is checked on the device by the server's rules first (2–24 letters of any script, digits, spaces, `_ - '`, a letter, no `@` or dot) and the server checks again | The guardrail test now proves the one request that joins is that tap (§8.4 "never auto-enabled") |
| A learner who might be under 18 sees no Leagues row on Me and, if they reach the screen, a plain sentence and nothing to join; the server refuses with `leagues_not_for_minors` either way | docs/10 §8.8, enforced on the server; the client only stops kindly first, as for age at sign-up (§7.4) |
| The table: tier emblem and name, "Week ends {weekday, time}" in the learner's own clock — a fixed, stated time, no countdown; rank, initials, name, weekly XP; the top 7 in a green band "Moves up", the bottom places (tier 3 and up) in an orange band "Moves down", exactly as the server marks them; the learner's own row outlined, and "Your place: N of M" in the header card instead of a sticky row. Footer: only XP from scheduled work counts | docs/16 E23 screen 2. The zones are the server's (`zone`), never computed here |
| Before the first XP of the week: "Your group of up to 30 forms with your first lesson this week." Synced answers refresh the table (`leagues` is one of the server-progress queries) | A group holds learners active this week (backend §15.2) |
| Last week's result is a card on the Leagues screen and a line on Me ("Last week's result is in") until the learner presses OK (`POST /v1/leagues/result-seen`). Moving up plays `promote` and Pip cheers; staying or moving down is said as plainly as the tier, Pip happy, no sound | docs/16 E23 screen 3: shown in-app on the next visit, no push about rank or demotion. Shown on the Leagues screen rather than over the path, so a learner who did not open leagues this week is not met with a ranking on their way to a lesson |
| Leaving: a text link, then "Leave leagues? Your tier is kept for 4 weeks." with *Leave* and *Stay* — no confirm-shaming | docs/10 §8.2; the four weeks are the server's rule |
| The display name can be changed on the Leagues screen; it cannot be removed while in leagues (the server answers `display_name_required`) | Others see it; it is not shown anywhere else in the app |
| Tier names (Clay … Diamond; Loy … Olmos; Глина … Алмаз) and every string are in the three catalogues | docs/16 E23 lists en and uz; Russian drafted, flagged for the native reviewer with the rest (§9.6) |
| Tests: 8 component tests (explainer, name check, minors, refusal copy, table and zones, the result once with sound only when moving up, leaving), the guardrail, and a Playwright run against the real server: join from Me, play a lesson, find yourself in the group by name with no email anywhere, leave | |
