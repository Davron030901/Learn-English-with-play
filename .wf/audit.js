export const meta = {
  name: 'lep-audit-and-plan',
  description: 'Audit backend, frontend and content for defects; design the engagement layer and the Phase 2-9 API contract',
  phases: [
    { title: 'Audit', detail: 'parallel code audits of backend, frontend slices and content' },
    { title: 'Verify', detail: 'adversarially verify each audit finding' },
    { title: 'Design', detail: 'engagement product design -> backend contract -> frontend plan' },
    { title: 'Review', detail: 'skeptic review of the contract' },
  ],
}

const ROOT = 'C:/Users/user/Desktop/Projects/Learn English with play'
const CONTEXT = `
PROJECT: "Learn English with Play" — a gamified CEFR A1->C2 English course for Uzbek/Russian speakers.
Repo root: ${ROOT}
- docs/00..15: the product specification (gamification = docs/10, SRS/FSRS = docs/08, assessment = docs/12, exercises = docs/09, pedagogy = docs/07, course map = docs/13, data model = docs/11).
- "Claude outputs/BACKEND-PROMPT.md" and "Claude outputs/FRONTEND-PROMPT.md": the build briefs (9-phase backend build order in BACKEND-PROMPT §15; API contract sketch §12).
- lep-backend/: FastAPI + SQLAlchemy async + PostgreSQL 16 + Redis 7 + Celery, Python 3.12. ONLY Phase 1 done (auth register/login/refresh/logout, GET /v1/me, health/ready/metrics, rate limits, logging). DECISIONS.md and docs/ERD.md record decisions and the planned data model. Tests: tests/unit, tests/integration (testcontainers). venv at lep-backend/.venv (python 3.12).
- lep-frontend/: Expo SDK 57 / React Native 0.86 / expo-router app for Android, iOS and web. Ships the whole course packed in assets/content/*.lep (packed from "Claude outputs/new-in-tashkent/data" by scripts/pack-content.mjs). Lessons run offline; answers go into an outbox. It deliberately shows NO XP/streak/league/coverage because the server cannot compute them yet. DECISIONS.md records everything. Mascot "Pip" with 6 poses exists in design-system/art.json.
- "Claude outputs/new-in-tashkent/data/": the full packed course (index.json + u001..u168.json, short keys) — 168 units, ~37k items, 5,948 lexemes, 168 story episodes.
- content/, tools/, build/: the content-as-code pipeline (repo build/ holds only A1).
The owner's goal: finish the whole product so it is MORE ENGAGING THAN DUOLINGO while staying within the ethical guardrails of docs/10 §8 and §12 (no consumable gating learning, no guilt notifications, leagues opt-in, honest numbers, no confetti on every tap).
ALREADY BUILT since the brief was written (read them, design around them, do not redesign them): lep-backend/app/domain/fsrs.py (FSRS-6: Weights, MemoryState, review(), retrievability, interval, deterministic fuzz_unit/fuzzed_interval, grade_response) and lep-backend/app/domain/mastery.py (MasteryState classify, Aspect, unlocked_aspects, weakest_stability, lexeme_known), with tests; Phase 1 audit fixes (see lep-backend/DECISIONS.md §3); lep-frontend sound effects (scripts/gen-sounds.mjs -> assets/sfx/*.wav: correct, incorrect, tap, pop, combo, complete, streak, levelup, gem, unlock, water, bloom, quest; src/audio/sfx.ts exposes sfx(name), prefs soundEffects/haptics); the frontend outbox is now index-free (one row per answer). IN PROGRESS by the lead engineer, concurrently: the backend content service (Phase 2) under lep-backend/app/content/ that loads the packed course from "Claude outputs/new-in-tashkent/data" at startup and serves GET /v1/course and GET /v1/units/{unit_id} — include it in the contract as Phase 2 but do not specify a conflicting module layout for it.
You are READ-ONLY in this phase unless told otherwise: do not modify any project file.`

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'short unique slug' },
          file: { type: 'string', description: 'repo-relative path' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          category: { type: 'string', description: 'correctness | security | data-loss | performance | ux | a11y | spec-deviation | maintainability | content' },
          title: { type: 'string' },
          detail: { type: 'string', description: 'what is wrong, concrete failure scenario, evidence (quote code)' },
          fix: { type: 'string', description: 'concrete fix' },
        },
        required: ['id', 'file', 'severity', 'category', 'title', 'detail', 'fix'],
      },
    },
    notes: { type: 'string', description: 'overall assessment of this slice: quality, architecture, what is solid' },
  },
  required: ['findings', 'notes'],
}

const VERDICT = {
  type: 'object',
  properties: {
    real: { type: 'boolean' },
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'not-a-bug'] },
    reasoning: { type: 'string' },
    corrected_fix: { type: 'string' },
  },
  required: ['real', 'severity', 'reasoning'],
}

const AUDITS = [
  { key: 'backend', prompt: `Audit lep-backend (Phase 1) thoroughly: app/**, migrations/**, tests/**, docker-compose.yml, Dockerfile, pyproject.toml. Look for real bugs: auth/token/refresh-rotation races, rate-limit bypasses, transaction misuse, timezone bugs, error-handler leaks, config/secret handling, Celery task correctness, migration/model drift, test gaps that hide bugs. Read every file in app/. Report only concrete, evidenced defects (quote the code). Also note in 'notes' the patterns new code must follow (DI container, deps, repositories, problem errors, migrations granting lep_app_rw, etc.).` },
  { key: 'fe-core', prompt: `Audit lep-frontend core plumbing: src/api/** (transport, session single-flight refresh, problem parsing, tokenStorage), src/outbox/**, src/state/**, src/content/** (adapter, repository, schemas, queries, source), src/lib/**, src/features/useBootstrap.ts, src/app/_layout.tsx, scripts/pack-content.mjs. Look for real bugs: race conditions, lost answers in the outbox, token leaks, stale caches, wrong zod schemas vs the packed data (check against actual files in "Claude outputs/new-in-tashkent/data"), memory issues loading 16MB of content, web-vs-native divergences. Evidence required.` },
  { key: 'fe-lesson', prompt: `Audit lep-frontend lesson engine: src/runner/** (machine, compose, phases), src/grading/** (normalise, grade, distance, contractions, usUk, feedback, hints), src/exercises/** (all 7 families, registry, parts, shuffle), src/features/lesson/** (LessonRunner, FeedbackPanel, PresentCard, Interstitials, record, useCountdown), src/audio/**, src/app/lesson/[sessionId].tsx. Look for real bugs: grading accepting wrong answers or rejecting right ones, state machine dead-ends, double submission, timers leaking, shuffle mapping errors, audio not stopping, accessibility breaks. Evidence required (quote code; if possible reason with real items from the packed data).` },
  { key: 'fe-ui', prompt: `Audit lep-frontend screens and UI: src/app/** (tabs index/path, practice, library, progress, profile, auth/onboarding, unit, story, settings), src/design/** (Path, Button, Bits, Exercise, Honest, theme, tokens), src/features/** (path, story, unit, settings, onboarding, errors), src/i18n/**. Look for real bugs (navigation dead-ends, broken states, layout overflow at 360px, dark-mode contrast, i18n keys missing in uz/ru, a11y labels) AND UX weaknesses that make the app feel dull compared with Duolingo (flat path, no reward loop, no character, no sound, no celebration, empty progress tab). Evidence required for bugs; UX weaknesses are category 'ux'.` },
  { key: 'content', prompt: `Audit the course content the app ships: "Claude outputs/new-in-tashkent/data" (index.json, u001..u168.json), lep-frontend/scripts/pack-content.mjs and lep-frontend/assets/content (packed .lep files — inspect format), plus repo content/schemas and tools/*.py. Write and run small read-only node or python scripts (in a temp dir, e.g. the system temp folder; the repo's python is 'python', node is available) to COUNT and CHECK: units/sections/items/lexemes/stories, item type distribution, items with missing answers/options, duplicate options, answer not among options, empty prompts, story characters (list the recurring named characters and their roles — the engagement designer needs them), per-unit node structure (node kinds, tiers). Report data defects as findings (file = data file) and put in 'notes' a PRECISE data-shape reference for the backend loader: every short key and its meaning, the unit file structure, the item envelope, how memory items/targets can be derived, and the story structure (with character names).` },
]

const BATCH_VERDICT = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          real: { type: 'boolean' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'not-a-bug'] },
          reasoning: { type: 'string' },
          corrected_fix: { type: 'string' },
        },
        required: ['id', 'real', 'severity', 'reasoning'],
      },
    },
  },
  required: ['verdicts'],
}

// The machine has 4 CPUs, so a workflow runs only 2 agents at once: the audits run one after
// another in one slot (each verified by ONE skeptic for the whole slice) while the design chain
// owns the other slot.
async function auditsChain() {
  const out = []
  for (const a of AUDITS) {
    if (args && args.skipKeys && args.skipKeys.includes(a.key)) continue // audited, verified and fixed already
    if (args && args.cachedKeys && args.cachedKeys.includes(a.key)) {
      // Audited in an earlier run; the findings are in .wf/cached-audits.json under this key.
      const v = await agent(`${CONTEXT}\n\nAn auditor reported defects in the ${a.key} slice. Read them from the JSON file "${ROOT}/.wf/cached-audits.json" (key "${a.key}", field "findings"). For EACH finding whose severity is not "low", try to REFUTE it by reading the actual code/data. Default to real=false if the evidence does not hold up or the scenario cannot happen. If real, give the correct severity and a corrected fix if the proposed one is wrong. Return one verdict per finding id.`, { label: `verify:${a.key}`, phase: 'Verify', schema: BATCH_VERDICT })
      out.push({ key: a.key, cached: true, verdicts: (v && v.verdicts) || [] })
      log(`audit ${a.key}: verified from cache`)
      continue
    }
    const res = await agent(`${CONTEXT}\n\nTASK (${a.key} audit):\n${a.prompt}\n\nBe exhaustive within your slice but report ONLY real, evidenced issues. Severity: critical = data loss/security/crash on main path; high = wrong behaviour users will hit; medium = edge case or spec deviation; low = polish.`, { label: `audit:${a.key}`, phase: 'Audit', schema: FINDINGS })
    if (!res) continue
    const serious = res.findings.filter(f => f.severity !== 'low')
    const lows = res.findings.filter(f => f.severity === 'low')
    let verified = []
    if (serious.length) {
      const v = await agent(`${CONTEXT}\n\nAn auditor reported the defects below in the ${a.key} slice. For EACH one, try to REFUTE it by reading the actual code/data. Default to real=false if the evidence does not hold up or the scenario cannot happen. If real, give the correct severity and a corrected fix if the proposed one is wrong. Return one verdict per finding id.\n\nFINDINGS:\n${JSON.stringify(serious, null, 2)}`, { label: `verify:${a.key}`, phase: 'Verify', schema: BATCH_VERDICT })
      const byId = new Map(((v && v.verdicts) || []).map(x => [x.id, x]))
      verified = serious.map(f => ({ ...f, verdict: byId.get(f.id) || null }))
    }
    out.push({ key: a.key, notes: res.notes, verified, lows })
    log(`audit ${a.key}: ${serious.length} serious, ${lows.length} low`)
  }
  return out
}

const PRODUCT = {
  type: 'object',
  properties: {
    vision: { type: 'string', description: 'one paragraph: why this will be more engaging than Duolingo' },
    features: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          priority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
          why_engaging: { type: 'string' },
          ethics_check: { type: 'string', description: 'how it passes docs/10 learning/autonomy/honesty tests and §8/§12' },
          screens: { type: 'string', description: 'concrete screen/component spec: layout, states, animations, copy (en + uz), sounds/haptics' },
          backend_needs: { type: 'string', description: 'data/endpoints the server must provide, or "none"' },
        },
        required: ['id', 'name', 'priority', 'why_engaging', 'ethics_check', 'screens', 'backend_needs'],
      },
    },
    rejected: { type: 'array', items: { type: 'string' }, description: 'ideas considered and rejected, with reason' },
    art_and_sound: { type: 'string', description: 'mascot/characters, colour, motion and sound design plan that can be produced WITHOUT external assets (SVG drawn in code, sounds synthesised by a script)' },
  },
  required: ['vision', 'features', 'rejected', 'art_and_sound'],
}

const CONTRACT = {
  type: 'object',
  properties: {
    contract_path: { type: 'string' },
    summary: { type: 'string' },
    tables: { type: 'array', items: { type: 'string' }, description: 'every new table, one line each' },
    endpoints: { type: 'array', items: { type: 'string' }, description: 'METHOD path — purpose' },
    work_packages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          depends_on: { type: 'array', items: { type: 'string' } },
          owns_files: { type: 'array', items: { type: 'string' }, description: 'files/dirs this package creates or exclusively edits' },
          shared_edits: { type: 'array', items: { type: 'string' }, description: 'shared files it must make small additive edits to (router.py, container.py, ...)' },
          scope: { type: 'string', description: 'precise description of what to build, with acceptance tests' },
        },
        required: ['id', 'title', 'depends_on', 'owns_files', 'shared_edits', 'scope'],
      },
    },
    open_questions: { type: 'array', items: { type: 'string' } },
  },
  required: ['contract_path', 'summary', 'tables', 'endpoints', 'work_packages', 'open_questions'],
}

phase('Design')
const designChainFn = async () => {
  const product = await agent(`${CONTEXT}\n\nTASK: You are a world-class game/product designer for language learning. Read docs/10 (gamification, ethics), docs/07 (pedagogy), docs/06 §7 (Immersion Engine), docs/08 §9 (retention audit), the frontend's current screens (lep-frontend/src/app/**, src/design/**, src/features/**), its DECISIONS.md, the design system (lep-frontend/design-system/README.md, tokens.json, art.json incl. mascot Pip's poses), and sample story episodes in "Claude outputs/new-in-tashkent/data" (find the recurring characters of "New in Tashkent").\n\nDesign the ENGAGEMENT LAYER that makes this app more fun and habit-forming than Duolingo WITHOUT breaking docs/10 §8/§12. Must cover at least: XP (effort-weighted per docs/10 §3), daily goal ring, streak with free auto-freezes / rest days / repair / pause and milestone celebrations, gems (earned only) and a cosmetic shop (themes, Pip outfits, path skins), daily (3) and weekly (2) quests generated from scheduler work, badges = CEFR can-do achievements, lesson-end summary screen, unit/section/level celebrations (rare), in-lesson combo feedback (subtle, not confetti per tap), Pip mascot reactions (never guilt), sound effects + haptics, a vivid winding path with section themes and story characters, an SRS review hub framed as a "Word Garden" (each learned word is a plant whose health = FSRS retrievability; due words wilt; reviewing waters them — honest AND fun), story chapters unlocked by progress, opt-in weekly leagues (30 people, 10 tiers), friends by code (activity, not scores), cohort cooperative goal, optional Perfectionist Mode, placement test & test-out, profile with avatar/badges/stats, and an AI conversation partner with story characters (server-side LLM, optional when a key is configured). Add any other high-impact idea you can justify. Prioritise P0 (must ship now) vs P1 vs P2. Be concrete enough that an engineer can build each screen without asking. Also plan art and sound that can be produced with NO external assets (SVG in code via react-native-svg, sounds synthesised by a Node script into small WAV files).`, { label: 'design:engagement', phase: 'Design', schema: PRODUCT })

  const contract = await agent(`${CONTEXT}\n\nTASK: You are the backend architect. Read lep-backend fully (app/**, migrations, tests/integration/conftest.py, DECISIONS.md, docs/ERD.md, README.md), "Claude outputs/BACKEND-PROMPT.md" in full, docs/08, docs/10, docs/12 §2-§4, docs/11, and the packed content shape in "Claude outputs/new-in-tashkent/data" (read index.json and a couple of unit files; the content will be loaded by the backend from that directory or from a copy).\n\nThe engagement designer produced this product spec (the backend must support all P0 and P1 features):\n${JSON.stringify(product)}\n\nWRITE the file lep-backend/docs/API-CONTRACT.md (you may create this one file; nothing else). It must define, for Backend Phases 2-9 plus the engagement features: (1) module layout under app/ (domain/ pure core: fsrs, grading, mastery, xp, streaks, quests, badges, leagues, placement IRT; content/ loader; services; repositories; api/v1 routers); (2) every new table with columns, types, constraints, indexes, and which migration file (0002_..., 0003_..., in order) creates it — follow the ERD plan and the existing migration conventions (grant to lep_app_rw, append-only triggers for review tables); (3) EVERY endpoint with exact request and response JSON schemas (field names, types, nullability, enums), status codes, problem-type slugs, idempotency rules, auth, rate limits — consistent with the existing /v1 style (see app/schemas, app/errors.py); (4) the XP formula, streak rules, quest generation, badge rules, gem earn rates, league mechanics, Word Garden data (per-lexeme retrievability), placement CAT algorithm — precisely; (5) how the content service loads and validates the packed data and how memory items are derived from items; (6) Celery beat jobs (streak day roll-over at learner-local midnight, league week close, partition maintenance). Keep the server authoritative and deterministic (injectable Clock).\n\nAlso return work_packages that split the backend implementation into 5-8 packages with DISJOINT owned files so several engineers can build in parallel (one package must own ALL migrations+ORM models so there are no migration conflicts; later packages depend on it), each with acceptance tests.`, { label: 'design:contract', phase: 'Design', schema: CONTRACT })

  phase('Review')
  const review = await agent(`${CONTEXT}\n\nTASK: Act as a hostile senior reviewer of the backend contract at lep-backend/docs/API-CONTRACT.md (read it in full) against BACKEND-PROMPT.md, docs/08, docs/10, docs/12, the existing Phase 1 code conventions, and the frontend's needs (lep-frontend/src/api/**, outbox client_uuid semantics, DECISIONS.md F19/F26/B11). Find: contradictions, missing fields the frontend will need, non-idempotent sync, FSRS formula errors (check against docs/08 §2 exactly), streak/timezone edge cases (learner-local day, DST, rest days, freezes), ethics violations of docs/10 §8/§12, migration ordering problems, work-package file overlaps, underspecified algorithms. Then FIX them by editing lep-backend/docs/API-CONTRACT.md directly (you may edit only that file). Return a concise list of what you changed and anything still open.`, { label: 'review:contract', phase: 'Review' })

  const fePlan = await agent(`${CONTEXT}\n\nTASK: You are the frontend lead. Read "Claude outputs/FRONTEND-PROMPT.md" (esp. §8, §9, §10, §11, §18 build order), lep-frontend/DECISIONS.md (§9-§11), lep-frontend/README.md, the current src/ tree, and the finished backend contract lep-backend/docs/API-CONTRACT.md. The engagement spec is:\n${JSON.stringify(product)}\n\nProduce a frontend implementation plan: which FRONTEND-PROMPT phases are already done vs missing; the new routes/screens/components/stores/queries needed for every P0/P1 feature; how to replace device-local placeholders (Honest 'Not available yet' stats, local composition, outbox sync) with the server; how to keep offline-first; asset generation (SVG Pip/characters/garden plants in code, synthesized WAV sounds via a script under scripts/); i18n keys for en/uz/ru; tests to add. Split into 5-8 work packages with DISJOINT owned files (paths) and shared files they make small additive edits to (e.g. src/app/(tabs)/_layout.tsx, i18n locale json files — note: locale json files are shared by everyone, so assign each package its own key namespace). Return the plan as JSON-like structured text.`, { label: 'design:frontend-plan', phase: 'Design', schema: CONTRACT })

  return { product, contract, review, fePlan }
}

const [design, auditsRaw] = await parallel([() => designChainFn(), () => auditsChain()])
const audits = (auditsRaw || []).filter(Boolean)
const fresh = audits.filter(a => !a.cached)
const confirmed = fresh.flatMap(a => a.verified.filter(f => f.verdict && f.verdict.real && f.verdict.severity !== "not-a-bug").map(f => ({ slice: a.key, ...f })))
const refuted = fresh.flatMap(a => a.verified.filter(f => !f.verdict || !f.verdict.real || f.verdict.severity === "not-a-bug").map(f => ({ slice: a.key, id: f.id, title: f.title, why: f.verdict ? f.verdict.reasoning : "verifier died" })))
log(`audit: ${confirmed.length} confirmed, ${refuted.length} refuted (fresh slices only)`)
return {
  confirmed,
  refuted,
  cached_verdicts: audits.filter(a => a.cached).map(a => ({ key: a.key, verdicts: a.verdicts })),
  lows: fresh.flatMap(a => a.lows.map(f => ({ slice: a.key, ...f }))),
  slice_notes: fresh.map(a => ({ key: a.key, notes: a.notes })),
  design,
}
