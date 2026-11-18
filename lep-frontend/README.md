# Learn English with Play — app (lep-frontend)

The learner app for **Learn English with Play**: one Expo / React Native codebase that runs on
**Android, iOS and the web**, built against the running **lep-backend** (Phase 1: accounts and
`/v1/me`). The whole course — 168 units, 1,344 lessons, 37,173 exercises — ships inside the app,
so lessons work without a network; answers wait in an on-device outbox until the server can
take them.

Design decisions, deviations from the brief and content defects are in **[DECISIONS.md](DECISIONS.md)**.

---

## What is in it

### Play lab (available before sign-in)

Open `/arcade`, choose **Try a free game** on the welcome screen, or open Play lab from
Practice. Word explorer, Spelling studio and Sound detective draw from all 168 course
topics, with Uzbek or Russian translations. Each round includes up to ten distinct words,
immediate corrections, curriculum examples, and a focused retry of missed or hinted words.
Listening uses the labelled device synthetic voice; a reveal button lets learners continue
when sound is unavailable. Listening is disabled when the no-audio preference is enabled.

Play lab does not require a running account server. Its round scores are temporary practice
results, not course XP or CEFR assessments. The full course, account synchronisation, and
server-backed features still require the backend described below.

To try it locally with dependencies installed, run `npm run web` from `lep-frontend`, open
the printed local URL, and choose **Try a free game**. To serve the production web bundle,
run `npm run export:web` followed by `npm run serve:web`.

Validation: `npm test` checks all course topics in both translation languages and all three
modes. `npm run test:components -- --runInBand arcade.test.tsx` checks complete rounds,
mistake replay, and exclusion of hints from unaided scores.

| Area | What the learner gets |
|---|---|
| Account | Welcome, 8-step onboarding (age check, why, first language, English variety, level, placement, daily time, study plan, honest timeline), account creation, sign-in, sign-out, "first sentence" step |
| Path | 10 sections · 168 units · 8 lessons each, tier pips for what was finished on this device, "Continue" to the next unfinished lesson, unit notes |
| Lessons | The fixed session shape (warm-up → new input → guided → integration → your turn → close), **31 exercise types** in 7 renderer families, feedback with the right form, why, L1 note and "I think my answer was right", hints, timers from B2, a 15-second break after 12 minutes, recovery item instead of ending on a mistake |
| Speaking | Record privately (never uploaded, deleted when the lesson ends) or type instead; fluency vs accuracy mode shown |
| Library | All 168 story episodes as scripts, every line playable, every word tappable for its meaning, save words |
| Practice | Mixed practice from lessons finished on this device; saved words |
| Progress | Where you are on the path and the honest time-to-level chart. Coverage, level and streak say **"Not available yet"** until the server computes them — the app never invents a number |
| Me / Settings | Account details from `/v1/me`; learning, display & language (English, Oʻzbekcha, Русский), accessibility (dyslexia-friendly font, reduce motion, timers, practise without audio, screen-reader layouts), audio, reminders (phone only), privacy (export my data, delete everything on this device), about & diagnostics |

The app holds **no TTS, ASR or LLM key** of any kind. Audio is the device's own speech
synthesiser, always labelled "Synthetic voice", until recorded audio exists.

---

## Run it

### 1. Start the backend

Follow `lep-backend`'s README. By default it listens on `http://127.0.0.1:8000` and allows web
origins `http://localhost:8081` and `http://localhost:4173` (CORS).

### 2. Install

```bash
npm install            # Node 20.19+ (22 recommended)
```

### 3. Point the app at the backend

The API base URL is read from `EXPO_PUBLIC_API_URL` (default `http://127.0.0.1:8000`).

```bash
# web, same computer as the backend
npm run web

# phone with Expo Go on the same Wi-Fi: use your computer's LAN address
EXPO_PUBLIC_API_URL=http://192.168.1.20:8000 npx expo start
```

On a phone, `127.0.0.1` is the phone itself — always use the computer's LAN IP (and start the
backend so it listens on that interface). On Windows PowerShell set the variable with
`$env:EXPO_PUBLIC_API_URL="http://192.168.1.20:8000"; npx expo start`.

### 4. Build

```bash
npm run export:web     # static web build in dist/
npm run serve:web      # serves dist/ on http://localhost:8081 (single-page fallback)

npx eas-cli@latest build --profile preview --platform android   # installable APK
```

Set the real API host in `eas.json` before an EAS build. Release builds should use **https**.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run web` / `npm start` | Expo dev server (web / devices) |
| `npm run typecheck` | TypeScript for the app, the tests and the e2e suite |
| `npm run lint` | ESLint, zero warnings allowed (includes the design-token and RTL rules) |
| `npm test` | Vitest: grader, normaliser, auth single-flight, problem parsing, outbox, runner, composition, reminders, guardrails, and the **full corpus sweep** (all 37,173 items graded right and wrong) |
| `npm run test:components` | Jest + React Native Testing Library: every renderer family, the lesson runner end to end, progress, first sentence, data export/delete |
| `npm run e2e` | Playwright against the web build and a running backend (see below) |
| `npm run check` | typecheck + lint + unit + component tests |
| `npm run gen:api` | Regenerates the typed API client from `openapi/openapi.json` (`LEP_OPENAPI_URL=http://127.0.0.1:8000/openapi.json npm run gen:api` refreshes it from the server first) |
| `npm run gen:content` | Re-packs the course content from `LEP_CONTENT_SRC` (default `../Claude outputs/new-in-tashkent/data`) |
| `npm run gen:design` | Regenerates tokens and art from `design-system/` |

Examples written as `NAME=value command` are for macOS/Linux shells. In Windows PowerShell write
`$env:NAME="value"; command` instead.

### End-to-end tests

```bash
npm run export:web
npm run e2e
```

The suite registers a few accounts per run. The backend allows 20 registrations per IP per hour,
so for repeated local runs start it with `LEP_RATE_LIMIT_REGISTER_IP_PER_HOUR=1000`.
`E2E_API_URL` points the setup calls at another backend; `PW_CHROMIUM` uses a local Chromium.

Covered: onboarding → account → first sentence → path with `/v1/me`; the under-13 stop (no
request is made); sign-in, wrong password, and a 503 that is never called a wrong password; a whole
lesson to CLOSE, its effect on the path, and every answer reaching the server; offline banner and a
lesson opening offline; 503 on `/v1/me` keeps you signed in, `session_revoked` signs you out with no
refresh; no horizontal scrolling at 360 px; no token in any web storage; the refresh cookie
surviving a reload; a forgotten password from the letter to the new sign-in; the pseudo and
RTL-pseudo locales on every main tab (screenshots in `e2e/.results/`); joining the weekly leagues
from Me with a display name, and finding yourself in the week's group after a lesson.

For the cookie and the reset tests, start the backend with `LEP_WEB_REFRESH_COOKIE=true`,
`LEP_MAIL_BACKEND=file` and `LEP_PASSWORD_RESET_URL=http://localhost:8081/reset-password`, export
with `EXPO_PUBLIC_API_URL=http://localhost:8000` (one site with the app on `localhost:8081`), and
set `E2E_MAIL_DIR` to the backend's `LEP_MAIL_OUTBOX_DIR`; without them those tests skip.

---

## How it fits the backend

| Server today | What the app does |
|---|---|
| `POST /v1/auth/register`, `/login`, `/refresh`, `/logout`, `GET /v1/me` | Used as specified. One refresh in flight at a time (the server rotates refresh tokens and treats reuse as theft); `session_revoked` signs out; 503/429/network errors never do |
| No course endpoints | The course is packed into the app (`assets/content/*.lep`); the content layer is written so `GET /v1/course` and `/v1/units/{id}` can replace it by changing two query functions |
| No review/sync endpoints | Every answer is stored in the outbox with a UUIDv7 `client_uuid`, the content version and a monotonic clock. Sync switches on by itself when `POST /v1/sync/reviews` appears in the server's OpenAPI document (`npm run gen:api`) |
| No scheduler, mastery or progress endpoints | No review queue, no level, no streak, no XP and no coverage figure is shown. Progress says why |
| No settings `PATCH` | Account settings are shown read-only; device settings live on the device |

On the **web** the refresh token is kept in memory only (never in browser storage), so reloading
the page signs you out — by design, until the backend offers an httpOnly-cookie flow.

---

## Layout

```
src/
  app/              routes (expo-router): (auth)/…, (tabs)/…, lesson/[sessionId], unit/[unitId],
                    story/[textId], settings/[page], first-sentence, +not-found
  api/              transport, problem documents, session (single-flight refresh), generated client
  content/          schemas (zod), adapter, repository, queries, packed-asset source
  grading/          normaliser, contractions, US/UK, typo tolerance, grader, feedback, hints
  runner/           session phases, local composition, the lesson state machine
  exercises/        the 7 renderer families and the type → renderer registry
  features/         lesson runner, story reader, unit notes, settings, onboarding, errors
  outbox/           durable answer queue and its sync
  design/           tokens, theme, typography, icons, components
  i18n/             en / uz / ru interface strings (ICU), pseudo-locales
  audio/, notifications/, state/, lib/, a11y/
tests/              unit, guardrails, sweep (Vitest) · components (Jest)
e2e/                Playwright
assets/content/     the packed course
```

## Known limits

- No recorded audio yet: everything is the device voice, labelled. Minimal-pair items whose
  spoken text is phonetic notation are withheld (a synthesiser cannot say them honestly).
- No images: `mcq_image` and `listen_choose_image` are not in the content.
- Reminders work in the phone apps only; the web sends none and says so.
- The Uzbek and Russian interface strings were machine-drafted and need a native reviewer.
- Immersion and review nodes carry no exercises in the content; they point to the Library and to
  Practice.
- Exporting the account's server-side data and deleting the account need server endpoints that do
  not exist yet; the app says so where the learner looks for them.
