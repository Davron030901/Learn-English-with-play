# Decisions

Every assumption, every ambiguity in the specification, and every deviation from the
brief, with its reason. The brief is `BACKEND-PROMPT.md`, cited as **brief §n**; the
specification is `docs/00`–`docs/15`, cited as **docs/NN §n**.

Status: **Decided** — implemented, and changing it is a normal code change.
**Needs ruling** — implemented conservatively, or not yet needed, but it belongs to the
curriculum or product owner. The phase in brackets is the first one that depends on it.

---

## 0. What the specification available to this build contains

Only **docs/00** (master spec) was in the workspace, together with the ten build
reports, the content README and the design handoff. **docs/01–15 were not available.**
Every "read docs/NN" instruction in the brief other than docs/00 is therefore
unverified, and the brief's own quotations stand in for the doc text.

Phase 1 depends on none of them. **Phase 3 cannot start safely without docs/08, 09, 10,
11 and 12**, because the FSRS formulas, grading rules, streak rules and rubric rules
must be checked against the source, not against a paraphrase (brief §0 rule 1).

## Open rulings

| # | Question | Default taken | Needed by |
|---|---|---|---|
| R1 | Memory-item ID convention: the build's `G-107.form` or docs/08's `gram.G-107.form`? | Store the build's IDs (brief §3.3) | **Phase 4, before the first review is written** |
| R2 | Which aspects are "required" for lexeme mastery? | Those the build exercises, with aspect coverage shown next to every mastery figure | Phase 3 |
| R3 | Is `prod` from `repeat_after`/`read_aloud` (imitation) the same memory item as free production? | To be checked against the build at load time | Phase 2 check, ruling by Phase 3 |
| R4 | Are the 1,472 `txt.*.comp` story items scheduled? | Log them, do not schedule them, keep them out of mastery | Phase 4 |
| R5 | Has the grammar ID space forked (docs/03 numbers G-001→G-412; the build allocated G-143→G-374 section by section)? | Unknown; must be settled | **Phase 4** |
| R6 | Item count: 37,173 (brief) or 37,203 (build report)? | Loader asserts the artefact's own count | Phase 2 |
| R7 | C2 level exam: ≥ 80 %, no paper < 70 % (brief) or ≥ 75 %, no section < 60 % (docs/00 §7)? | docs/00, unless docs/12 states a C2 rule | Phase 7 |
| R8 | Retention condition: 85 % of *memory items* (brief) or of *items* (docs/00 §7)? | Syllabus items at their minimum stability | Phase 7 |
| R9 | Streak freezes: "2 held at all times, regenerating 1 every 5 days" contradicts itself | Cap of 2, +1 every 5 days | Phase 6 |
| R10 | p(correct) bands: warm-up ≥ 0.95 (brief) or ≈ 0.90 with practice 0.80–0.92 and stretch 0.55–0.75 (docs/00 §4.2) | docs/00 bands, enforced by the composer | Phase 5 |
| R11 | FSRS-6 details that differ from the reference implementation as recalled | Check against docs/08 and the published reference code | Phase 3 |
| R12 | Grade and state precedence when rules overlap | Hint → Hard; suspended > retired > leech > durable > retained > young > learning | Phase 3 |
| R13 | Refresh-token reuse: strict, or with a short grace window for flaky mobile networks? | Strict (§ 2.6) | Product decision; revisit with telemetry |
| R14 | Breached-password screening (NIST SP 800-63B requires it): may a hash prefix go to Have I Been Pwned? | Built (§14.5): a built-in screen always; the HIBP range check behind `LEP_HIBP_ENABLED`, **off** | Before public launch |
| R15 | Which TTS, alignment/GOP and ASR providers (quality, speech-data residency, cost)? | None wired; the features answer 503 (§10.1) | Before speaking is scored |
| R16 | The p99 < 300 ms bar "at target concurrency": what concurrency per API instance, on what hardware? | Measured and reported, not certified, on the development laptop (§12.3) | Before launch: a run on production-like hardware |
| R17 | Which mail relay sends password-reset links, from which domain (SPF, DKIM, DMARC)? | Any SMTP relay by configuration; none chosen — without one, reset answers 503 and the app shows how to get help (§14.3) | Before public launch |
| R18 | Section checkpoints gate progression (docs/12 §3) and include a speaking task: until speech is scored (R15) nobody could pass one. Gate only once R15 is settled, or accept a self-assessed speaking part for the gate? | Not built: no unit is locked; the app opens every unit (frontend F22) and the level exam stays the formal check (§14.9) | Before section gating is switched on |

---

## 1. The specification against the brief

Conflicts found by comparing the brief with docs/00. The rule (brief §0 rule 1) is that
the doc wins; where only the brief speaks, it is followed.

### Memory-item ID convention — Needs ruling (R1) [Phase 4]

The build emits `lex.03421.recall`, `G-107.form`, `P-014.disc`, `F-023.ex01`,
`txt.00042.comp`. docs/08 §3 (as quoted in brief §3.3) prefixes the families
(`gram.G-107.form`, `phon.P-014.disc`, `func.F-023.ex07`), and docs/00 §4.1 rule 1 names
the families `gram.*`, `phon.*`, `func.*` too.

**Default:** store the build's IDs verbatim, as brief §3.3 requires, because learner
records must match the content they point at. The mapping between the two forms is
lossless (`G-` ↔ `gram.G-`, `P-` ↔ `phon.P-`, `F-` ↔ `func.F-`; `lex.` unchanged;
`txt.` has no counterpart in docs/08), so exports can render either form.

This becomes permanent at the first `review_log` insert (brief §0 rule 3: IDs are
immutable). The curriculum owner should confirm before Phase 4 writes a real learner's
row.

How the value object will validate IDs (Phase 3):

* Split on the **last** dot: `lex.03421` itself contains one.
* Validate the **(family, aspect) pair**, not the aspect alone:
  lex {`recog`, `recall`, `aural`, `spell`, `prod`} · G {`form`, `judge`, `choice`} ·
  P {`disc`} · F {`ex{nn}`, `prod`} · txt {`comp`}. A flat enum of eleven aspects would
  accept `P-014.spell`.
* `ex01` is parametric (`ex{nn}`, the rank of the exponent in docs/05; docs/08's own
  example is `ex07`). The build only ever emits `ex01`, so every function is trained on
  its top-ranked exponent only.
* Reserved and rejected until content exists: `lex.coll`, `G.trans`, `P.prod`.
  `listen.decode` cannot be placed in a family without docs/08 §3.
* The type → aspect table in brief §3.2 becomes a load-time invariant
  (`aspects(item) ⊆ table[type]`), not the grader's input: an item's own references
  say which `G-nnn` a `form` belongs to; its type cannot.

### Aspect coverage is thin — Needs ruling (R2) [Phase 3]

11,791 distinct memory items, minus at most about 1,750 non-lexical ones, leaves about
1.7–1.8 of the five lexical aspects per lexeme. If "required aspects" means docs/08's
five, most lexemes can never be mastered. If it means "whatever the build exercises",
a word practised only by recognition counts as mastered, which is the failure docs/00
§1.2 warns against. **Default:** the second, with an aspect-coverage figure shown
next to every mastery number so the gap stays visible.

### `prod` mixes imitation and free production — Needs ruling (R3) [Phase 2 → 3]

`repeat_after` and `read_aloud` (4,100+ items) write `prod`, as do `speak_prompt` and
`write_sentence`. If the imitation types target `lex.*.prod`, the progression gate in
brief §3.4 (prod unlocks at recall S ≥ 21 d) locks every repeat-after on a word's first
appearance. Either the gates govern only scheduler-chosen reviews, or imitation is the
reserved articulation kind (`P.prod`). Phase 2 will report which families these items
actually reference.

### Other conflicts

| # | The brief says | The source says | Resolution | Phase |
|---|---|---|---|---|
| 1 | Retention: ≥ 85 % of the level's *memory items* retained or better (§8.1) | docs/00 §7: ≥ 85 % of the level's *items* — with mastery = weakest aspect, a different number | Count syllabus items at their minimum stability (R8) | 7 |
| 2 | C2 exam: ≥ 80 %, no paper < 70 % | docs/00 §7: ≥ 75 %, no skill section < 60 %, no C2 exception | docs/00, unless docs/12 states the C2 rule (R7) | 7 |
| 3 | Warm-up at p(correct) ≥ 0.95; no band for other items (§6.6) | docs/00 §4.2: warm-up p ≈ 0.90; practice 0.80–0.92; stretch 0.55–0.75; "the scheduler enforces it" | The composer enforces all three bands (R10) | 5 |
| 4 | `l1` is `'uz'` or `'ru'` | docs/00 §6: L1 glosses in ≥ 12 languages at v1; L1-agnostic content model | **Done:** language-tag format checked in the DB; the accepted set comes from `LEP_SUPPORTED_L1` (default `uz,ru`) and, from Phase 2, from the content | 1 |
| 5 | No spelling preference | docs/00 §2.1: the learner picks US or UK at onboarding | **Done:** `learner_settings.spelling_variant`, default `us` | 1 |
| 6 | `is_minor bool`, no age input | docs/00 §4.4: the main track is 13+; the Kids track (7–12) is separate and not built | **Done:** registration takes `birth_year`; under-13 refused; `is_minor` derived (§ 2.4) | 1 |
| 7 | `review_log` has no content version | docs/00 §9: every learner record stores the version it was taught under | `content_version` on review attempts | 4 |
| 8 | The grader returns no error type | docs/00 §4.3: errors are typed and logged; three of a type trigger a micro-lesson | `error_type` on attempts and in the grade result | 3–4 |
| 9 | No volume statistics | docs/00 §3.3: words read, hours heard, words written, minutes spoken are first-class | `immersion_events` table | 6 |
| 10 | 1,472 story items target only `txt.*` | docs/00 §4.1 rule 1: every exercise traces to a syllabus ID; §1.3: everything taught is scheduled | Log them, do not schedule them, keep them out of mastery (R4) | 4 |
| 11 | 37,173 items (§2.1, §14, Phase 2 acceptance) | Build report and content README: 37,203; the report's per-type table sums to 37,203 | The loader asserts the artefact's own count; the 30-item gap needs explaining (R6) | 2 |
| 12 | Syllabus IDs are immutable | docs/03 numbers G-001→G-412; the build allocated G-143…G-374 section by section while writing B1–C2 "from scratch" | If build G-200 ≠ docs/03 G-200, the ID space has already forked (R5) | 4 |
| 13 | Freezes: "2 held at all times, regenerating 1 every 5 days" | Contradicts itself | Cap of 2, +1 every 5 days, unless docs/10 says otherwise (R9) | 6 |
| 14 | FSRS formulas (§6.1) | The reference FSRS-6, as recalled, differs in three details: same-day growth floored at 1 for G ≥ 3; post-lapse cap `S / e^(w17·w18)` rather than `S`; a minimum-S clamp | Nothing is asserted from memory: Phase 3 checks against docs/08 and the published reference code, and takes the default weights from that package (R11) | 3 |
| 15 | Grades and states (§6.2, §6.5) | A hinted but fast answer is both Hard and Easy; leech and retired overlap other states | Hint → Hard; precedence suspended > retired > leech > durable > retained > young > learning (R12) | 3 |

### `review_log` storage — Decided (design) [Phase 4]

Full plan in [docs/ERD.md](docs/ERD.md). The deviations from brief §5 and the reasons:

* **Two tables: `review_attempts` (one row per answer) and `review_log` (one row per
  memory item touched).** An answer touches about 1.3 memory items (48,684 references
  over 37,173 items), so brief §11's `UNIQUE (learner_id, client_uuid)` cannot sit on a
  per-memory-item table: the second row of any multi-target item would violate it.
  Aspects can also grade differently within one answer (the error spotted but the
  correction wrong → `judge` 3, `form` 1). And replay reads only memory item, time and
  grade, so keeping `answer_raw` on the attempt makes the replayed table several times
  narrower.
* **Partitioned from day one** (declarative, monthly, by `ts`), where brief §5.2 says to
  design for it now and enable it later. Converting a populated 100 M-row table means
  copying it; creating it partitioned costs nothing now. A beat task keeps three months
  of partitions ahead, and a DEFAULT partition catches bad clocks and raises an alert
  when it is not empty.
* **Append-only by trigger, not by rule.** Brief §5.1 says "enforce with a rule", but a
  `DO INSTEAD NOTHING` rule makes an UPDATE *succeed* with 0 rows, which fails Phase 4's
  own acceptance test ("an attempted UPDATE is rejected by the database"). BEFORE
  UPDATE/DELETE and BEFORE TRUNCATE triggers raise instead, and the API's role has only
  INSERT and SELECT. The single delete path is the erasure job (docs/11 §10), under a
  separate role.

---

## 2. Phase 1 decisions

### 2.1 Stack — Decided

As fixed by brief §4. SQLAlchemy is pinned `<2.1` because the brief names 2.0 and 2.1
has been released. uv manages the lock file (`uv.lock`); `make install` runs
`uv sync --frozen`.

### 2.2 Configuration — Decided

* Three settings classes, one per process, so that each gets only what it needs: the
  worker and the migration job cannot read the JWT key, and the API never holds the
  schema-owner password.
* Secrets can be files in `LEP_SECRETS_DIR` (the Docker/Kubernetes convention) or
  environment variables.
* Loading fails before start-up with exit status 78 (`EX_CONFIG`). The message lists
  each missing or invalid variable by name. It never contains a value, because
  pydantic's own error text includes the inputs, and those may be secrets.
* With `LEP_ENV=prod` the process also refuses a database connection without TLS, a
  Redis without a password, and Argon2id parameters below the OWASP minimum.

### 2.3 Database roles — Decided

* `lep_owner` owns the schema and runs migrations. `lep_app` (the API and workers) is a
  member of `lep_app_rw` and can only SELECT, INSERT, UPDATE and DELETE the tables the
  migrations grant. `tests/integration/test_schema.py` proves the API role cannot
  create, drop, alter or truncate.
* Every migration that adds a table grants it to `lep_app_rw`. Migration 0001 creates
  the group role if it does not already exist; downgrading leaves it, and the `citext`
  extension, in place, because both are shared beyond this schema.

### 2.4 Identity schema — Decided

* **UUIDv7** primary keys: time-ordered, so inserts append to the index, and not
  enumerable. Python 3.12 has no `uuid.uuid7`, so `app/ids.py` implements RFC 9562 §5.7.
* **Email** is `citext`, unique regardless of case, normalised by `email-validator`
  (domain lower-cased, no DNS lookups). Lookups cast the parameter to `citext`; compared
  as `text`, PostgreSQL would cast the column down instead and the match would become
  case-sensitive.
* **Age.** Only the birth year is collected (data minimisation). docs/00 §4.4 makes the
  main track 13+ and the Kids track is not built, so registration is refused unless the
  learner is certainly 13 or older. A learner born in 2013 is refused in 2026 even
  though they may already be 13; that is the conservative reading of an ambiguous rule
  (brief §0 rule 7). Minor protections (docs/11 §10) apply while the learner *might*
  be under 18. `is_minor` is derived on every read and never stored, because a stored
  flag goes stale on the eighteenth birthday.
* **Time zone** is required and must be an IANA name: it decides where a learner's day,
  and so their streak, starts (Phase 6).
* **`daily_goal_min`** stays on `learners`, where brief §5.1 puts it. The other settings
  are in `learner_settings`, created with defaults at registration.
* `rest_days` holds ISO weekday numbers (1 = Monday … 7 = Sunday), at most two, checked
  in the database. Brief §5.1 gives no numbering; ISO removes the Sunday-or-Monday
  ambiguity.
* CHECK constraints repeat the API's validation in the database, as the last defence
  against a bug, a script or a future endpoint that skips the schema.
* `updated_at` is maintained by a trigger, so it is correct whoever writes the row.

### 2.5 Sign-in — Decided

* **Password grant.** `POST /v1/auth/login` is the OAuth 2.0 resource-owner password
  grant, form-encoded (RFC 6749 §4.3), as brief §4 asks ("OAuth2 password"). Swagger's
  Authorize button works against it. Refresh and logout take JSON.
* **Error bodies** follow RFC 9457 everywhere (brief §12), including the token endpoint,
  where RFC 6749 §5.2 would use `{"error": "invalid_grant"}`. This is a first-party API,
  not a general OAuth server.
* **Timing.** A sign-in for an unknown email verifies against a dummy Argon2 hash, so it
  takes as long as a wrong password. The two failures return identical bodies.
* **Enumeration at registration.** Registering an existing email answers 409. Hiding it
  would need an email round trip (verification), and there is no email service yet.
  Sign-in, the high-volume path, reveals nothing.
* **Suspended or deleted accounts** get the same "invalid email or password" as a wrong
  password.
* **Password policy** follows NIST SP 800-63B: 10 to 256 characters, no composition
  rules, not equal to the email address. Hashes made with older Argon2 parameters are
  upgraded on the next successful sign-in. Screening against breached passwords, which
  the NIST guideline requires, is **not implemented** (R14): it needs a password corpus
  or an outbound call to the HIBP range API, and neither is available yet.
* **Argon2id** at the OWASP minimum (m = 19 MiB, t = 2, p = 1) by default, run in worker
  threads behind a limit of `LEP_PASSWORD_HASH_CONCURRENCY` at a time. That bounds
  memory at concurrency × 19 MiB however many sign-ins arrive at once. No database
  connection is held while a hash is computed.

### 2.6 Tokens and sessions — Decided (R13 open)

* **Access tokens:** HS256 JWTs, `typ: at+jwt` (RFC 9068), 15 minutes, carrying no
  personal data. Verification pins the algorithm, the type and the key id before it
  checks the signature. Keys rotate through `LEP_JWT_PREVIOUS_SECRET`. HS256 is enough
  while one service issues and verifies; move to EdDSA if another service needs to
  verify tokens without being able to sign them.
* **Refresh tokens:** 256-bit random values prefixed `lep_rt_`, so secret scanners can
  recognise one. Only their SHA-256 is stored. They rotate on every use and last 30 days.
* **Sessions** last at most 90 days however often they are refreshed.
* **Reuse detection is strict.** Presenting an already-rotated refresh token revokes the
  whole session, for the thief and the legitimate holder alike. Two concurrent refreshes
  with the same token therefore end the session: one succeeds, and the second is treated
  as reuse. Clients must serialise refreshes. A grace window (accepting a replay for a
  few seconds) would suit flaky mobile networks better, but it also gives a thief that
  window. This is left as a product decision (R13), to revisit with telemetry on how
  often `refresh_reuse_detected` fires.
* **Immediate revocation.** Every authenticated request checks that its session is still
  live — one primary-key lookup — so sign-out and reuse detection take effect at once,
  not when the access token expires. `GET /v1/me` ships in Phase 1 because without one
  authenticated endpoint there would be no way to prove that.
* A session stores the user agent (truncated to 256 characters) to support a future
  "your devices" screen, and does not store the IP address.
* A daily beat task deletes sessions that ended, and refresh tokens that expired, more
  than `LEP_AUTH_SESSION_RETENTION_DAYS` (30) ago. A used token is kept until it
  expires, so a replay of it is still recognised as reuse.

### 2.7 Rate limits — Decided

* Token buckets in Redis, updated atomically by one Lua script that reads the Redis
  server's clock, so API instances with drifting clocks share one timeline.
* Limits: every `/v1` request per IP; authenticated requests per learner; sign-in per
  IP and per email; registration per IP; refresh and sign-out per IP. Defaults are in
  the README.
* **Fail policy when Redis is unreachable:** sign-in and registration fail closed (503),
  so an outage cannot open the door to password guessing; everything else fails open.
  **Revised (audit, 2026-10-03):** refresh and sign-out now fail *open* as well — a
  refresh token is 256 random bits, so there is nothing to guess, while failing closed
  signed every learner out within one access-token lifetime. `/ready` reports Redis
  down, so the load balancer drains the instance.
* **IPv6 clients are limited per /64** and IPv4-mapped addresses as their IPv4
  (`deps.rate_limit_ip_key`): keying on the full IPv6 address let one host rotate
  through its /64 and escape every per-IP limit.
* The per-email sign-in key lower-cases, decomposes and drops combining marks
  (`schemas.auth.rate_limit_key_for_email`), so it is never finer than the `citext`
  match the account lookup uses (`İ` and `i` share a bucket). Sign-in looks the email
  up under the same email-validator normalisation registration stored.
* The per-email sign-in limit counts attempts from any IP, which means someone can make
  a victim wait for the window to refill by guessing their email. That is the usual
  trade: the alternative lets a botnet guess one account's password without limit.
* Identities are SHA-256-hashed before they become Redis keys, so Redis never holds an
  email in plain text.

### 2.8 Errors — Decided

* One problem shape everywhere (brief §12, RFC 9457), with a stable `type` slug. The
  slug is a relative URI reference, which RFC 9457 allows. A resolvable URL would need
  a domain this project controls.
* Validation errors list `{field, message}` pairs and never the submitted value:
  pydantic's error includes the input, which on the sign-in form is the password.
* Anything that escapes the application becomes a generic 500. PostgreSQL or Redis
  being unreachable becomes 503 with `Retry-After`: asyncpg raises plain `OSError` from
  connect, and those are recognised by errno or message. Stack traces and SQL go to the
  log, with the request ID, and never to the client.

### 2.9 Request IDs and logging — Decided

* A well-formed incoming `X-Request-ID` (8–128 characters from `A–Z a–z 0–9 . _ : -`) is
  kept, so a mobile client can correlate its own logs; anything else is replaced by a
  generated UUIDv7. The ID is returned in the response header and in every problem body.
* Every line logged while a request is handled carries its `request_id`, whichever
  library wrote it: structlog and the standard library share one pipeline, and
  `request_id` is bound in contextvars. uvicorn's access log is off, replaced by one
  line per request from the middleware. Process start-up and shut-down lines carry no
  request ID, because they belong to no request. That is the reading taken of "a request
  ID appears on every log line" (Phase 1 acceptance).
* Keys such as `password`, `token`, `refresh_token` and `authorization` are redacted
  whoever logs them. SQL statements are never logged at INFO, since they can contain
  learner data.
* The access line includes the client IP, for abuse investigation. IP addresses are
  personal data, so log retention must be set accordingly.

### 2.10 Metrics, tracing, headers — Decided

* RED metrics are labelled by route **template**, never by raw path. FastAPI now
  includes routers lazily, and `scope["route"].path` is relative to the included router
  (`/auth/register`), so the full template is read from FastAPI's effective route
  context. A test pins this, so an upgrade that moves it fails the build instead of
  silently relabelling every metric.
* Each app instance owns its Prometheus registry. One uvicorn process per container,
  scaled by replicas, so Prometheus multiprocess mode is not needed.
* Default headers: `nosniff`, `no-referrer`, `X-Frame-Options: DENY`, a `default-src
  'none'` CSP (except on `/docs`), `Cache-Control: no-store` (most responses carry
  personal data; Phase 2 content responses will set their own), and HSTS in production.
* CORS is off unless origins are listed, `*` is refused, and credentials are not
  allowed: the API uses bearer tokens, not cookies. **Revised (§14.4):** allowed only while
  the web refresh cookie is on; that cookie is the one cookie the API reads.
* `/docs` and `/openapi.json` are off in production by default. `/metrics` accepts an
  optional bearer token.

### 2.11 Celery — Decided

* JSON only (pickle would let anyone who can write to Redis run code on the workers),
  `acks_late` and `reject_on_worker_lost` (at-least-once delivery, so every task is
  idempotent), prefetch 1, and a visibility timeout of twice the task time limit.
* The broker uses its own Redis database (`LEP_CELERY_BROKER_DB`), apart from rate
  limits and caches.
* Tasks retry only on dependency failures, with exponential backoff, never on logic
  errors.
* Request-ID propagation from the API into tasks waits for the first API-enqueued task
  (Phase 8, TTS and ASR). Worker log lines carry `task_id` and `task_name`.

### 2.12 What this build environment could not verify — Decided

* **`docker compose up` and testcontainers were not run.** The sandbox has Docker, but
  its network allowlist refuses Docker Hub, so no `postgres`, `redis` or `python`
  image could be pulled and the `Dockerfile` could not be built. Every integration test
  ran instead against a local PostgreSQL 16.13 and Redis 7.0.15 through the
  `LEP_TEST_*` variables, which is the same code path CI service containers use. The
  first `docker compose up` and a testcontainers run on a machine with Docker Hub access
  remain to be done.
* The compose file was validated with `docker compose config`.

## 3. Audit fixes (2026-10-03)

An independent audit of Phase 1, each finding verified against the code before fixing:

| Finding | Fix |
|---|---|
| Registration stripped surrounding spaces from the **password** (`str_strip_whitespace`), sign-in did not, so such accounts could never sign in | Only `email`, `l1` and `tz` are trimmed; the password is never altered. Integration test signs in with `"  pass phrase …  "` |
| Errors raised *mid-query* (statement timeout, admin shutdown, too many connections, dropped connection) arrive wrapped in a plain `DBAPIError` and became 500s, never retried by Celery | `is_dependency_failure` unwraps the asyncpg cause and SQLSTATE (57014, 57P01–03, 53300, class 08); the purge task retries through that predicate |
| SQL bind parameters (emails, Argon2 hashes) and frame locals reached the JSON log | `hide_parameters=True` on every engine; tracebacks rendered without locals; dependency failures log type and SQLSTATE only |
| Per-IP limits keyed on the full IPv6 address | Keyed per /64 (§2.7) |
| Per-email sign-in key could split one account into several buckets | §2.7 |
| Refresh and sign-out failed closed on a Redis outage | Fail open (§2.7) |
| An empty `LEP_REDIS_PASSWORD` passed the production guard; `/metrics` could be public in production | Empty secrets count as missing; `LEP_METRICS_TOKEN` is required when `LEP_ENV=prod` |
| A client `traceparent` could force 100 % trace sampling | Remote parents are sampled at the configured ratio |
| Local CORS origins did not include the Expo web build (:8081) or the e2e server (:4173) | Added to `docker-compose.yml` and `.env.example` |

## 4. Phases 2–3 (content service and the pure core) — 2026-10-03

### 4.1 The content source — Decided
The backend loads the **packed course the app ships** (`Claude outputs/new-in-tashkent/data`:
`index.json` + `u001…u168.json`, `LEP_CONTENT_DIR`), not `build/`, which holds A1 only. This
resolves R6: the loader asserts the artefact's own figures — 168 units, 1,344 nodes, 3,019
populated node-tiers, 37,173 items, 5,948 lexemes, 11,791 memory items — and computes the
same `content_version` hash as the app's packer (`sha256:15517a0ea7373e00` today), so the
version an answer carries can be checked against the content the server holds. Structural
faults (unknown type, missing answer, index out of range, duplicate id, a unit out of
sequence) stop start-up; known content defects are counted and logged
(`stress_syllables_do_not_spell_the_word`: 380, `no_feedback`: 7,264,
`node_with_missing_tiers`: 4, `single_option`: 2). Node kinds come from position, levels
from the unit (brief §14.1). `GET /v1/course` and `GET /v1/units/{id}` are public,
cacheable, with strong ETags; `/ready` reports the content and its version.

### 4.2 Memory items — Resolves R1, R3, R4 (data); R4 scheduling still open
The bundle drops each item's `memory_items`, so `app/content/memory_items.py` derives them
from (exercise type × target family). The derivation reproduces the build **exactly** —
48,684 references, 11,791 distinct items, and every per-aspect count in brief §3.1 — which
is asserted in tests. Storage uses the build's convention (`G-107.form`, no family prefix).
docs/08's four unbuilt kinds (`coll`, `trans`, `decode`, phonology `prod`) are reserved in
the `Aspect` enum and parse, but nothing emits them. R3 answered by the data: `prod` from
`repeat_after`/`read_aloud` and from `speak_prompt` is one memory item per lexeme.

### 4.3 The grader is a port of the app's, proved by vectors — Decided
`app/domain/grading.py` (+ `spelling.py`) is a line-for-line port of the app's grader, not
an independent implementation of brief §7.1, because a learner must never see the device
and the server disagree. `tests/fixtures/grading-vectors.json.gz` holds **106,918**
verdicts the app's own grader gave to real items (right, wrong, and near-misses for case,
punctuation, spacing, curly quotes, contractions, US/UK spellings and one-letter slips);
the server agrees with every one. Regenerate it with the app's
`tests/sweep/vectors.test.ts` whenever either grader changes. Where the brief and the app
differ (brief: `typo1` is plain Levenshtein; app: Damerau–Levenshtein on one word of 4+
letters, never a course word, never in `spelling_bee` — docs/09 §5 rule 7), the app's
docs-backed rule is used. Bank answers are graded from the tile indices; the text the
client sends is never trusted. The course word list for the real-word exclusion is built
exactly as the packer builds `words.lep` (9,591 words, identical).

### 4.4 FSRS-6 — Decided (R11)
`app/domain/fsrs.py` implements docs/08 §2 with the published FSRS-6 default vector,
`scheduler_version = "fsrs6-2026-10-02"`. Two places follow the reference implementation
where docs/08 is silent: a Good/Easy same-day review never lowers stability, and stability
is floored at 0.001. Fuzz is a deterministic hash of (learner, memory item, review count),
so replaying a log reproduces state exactly. Property tests cover `R(S,S) = 0.9`, the
inverse interval, `S_fail ≤ S`, `D ∈ [1,10]` over 10,000 random sequences, and the three
monotonicity properties of docs/08 §2.6.

### 4.5 XP — Decided, with one reading recorded
docs/10 §3 exactly (base by effort class, difficulty ×0.5/×1.5, re-grind ×0.25, timed and
no-hints ×1.25 each). docs/10 measures "effort on scheduled work" without saying what a
wrong answer earns: **a wrong answer earns half, a timeout nothing**, an ungraded free
response in full. XP is rounded once per session.

### 4.6 Streaks — Decided (R9)
`app/domain/streaks.py`, on learner-local calendar days: pause → rest day → free automatic
freeze → reset, in that order, for each missed day. Freezes: at most 2, one back every 5
days (R9 read as a cap of two). Repair within 2 local days of the break, by a double
session, once per calendar month, restores the old length plus days since. Pause: 1–30
days. The reset message is docs/10 §5's copy, with the broken streak's length. There is no
purchase path — a test fails if the module grows anything named buy, purchase, gem, price
or shop.


## 5. Phase 4 (review pipeline) and Phase 6 (progress and gamification) — 2026-10-04

### 5.1 Review ingest — Decided
`POST /v1/sync/reviews` takes the app's outbox rows as they are (reviews and disputes, up to
500), `POST /v1/reviews` one. Per record: idempotent on `client_uuid` (a retry gets the first
verdict back), graded on the server with the shared grader, RT clamped to [250 ms, 120 s] and
turned into an FSRS grade with population medians per exercise family (per-learner medians
come later; the stored grade makes replay independent of them). One `review_attempts` row per
answer and one `review_log` row per memory item; free speech and free writing write attempts
but no log rows. Pairs games grade each lexeme by its own pair. A device clock more than five
minutes ahead is re-timed to the server's and flagged. Ingest is serialised per learner with an
advisory lock; one bad record (unknown item, malformed submission) is rejected with its reason
and the rest are accepted.

### 5.2 Replay equals state — Decided
`app.domain.scheduling.apply_review` is the one function the ingest path and the replay
command (`make replay LEARNER=…`) both fold over the log, with the deterministic fuzz draw and
the learner's time zone and retention. A record older than an item's last review (a second
device syncing late) re-derives that item from its whole log. Log rows written in one batch get
strictly increasing UUIDv7s (`Uuid7Sequence`) so same-instant reviews replay in the order they
were applied. A new retention preset re-derives every due date (`reschedule`). Tests: replay
shows zero drift after interleaved batches, after a late batch, and after a 500-answer batch.

### 5.3 Append-only in the database — Decided
`lep_append_only()` triggers raise on UPDATE, DELETE and TRUNCATE of `review_attempts` and
`review_log` unless the transaction set `lep.erasure = 'on'` (account erasure, and test
clean-up); the API role has INSERT and SELECT only. Monthly partitions 2026-01…2027-12 plus a
DEFAULT partition are created by the migration — partitions are DDL, which least privilege keeps
from the API and worker, so next year's months need a migration.

### 5.4 The award pipeline — Decided
Runs in the ingest transaction (`app.services.gamification`): learner-local days (answers,
accuracy, time on task = RT + 3 s per answer for reading feedback, runs, speaking, listening,
words watered), XP (docs/10 §3; a re-grind is an answer whose every memory item was already
known and not due), the daily goal (+10 gems), node-tiers (passed in one session: ≥ 60 % of the
tier's items answered, 70/80/85 % right, ≤ 2 hints at tier 2, none at tier 3, tier 3 ≥ 3 days
after tier 2), units (every lesson, story and speaking node at tier ≥ 2, or its highest tier
when fewer are populated: +30 gems and the unit's can-do statements as passport stamps),
quests (3 daily, 2 weekly, deterministic per learner and day, targets scaled by the daily goal,
+15 gems once each) and the streak (settled lazily on read and on ingest — no nightly job is
needed, and settling is idempotent). Every award is idempotent: gems by (reason, ref), progress
by key. The sync response carries `awards` for the lesson-end summary.

### 5.5 Coverage is an estimate, and says so — Decided
`GET /v1/progress` puts coverage first. A lexeme is known only when the weakest aspect the
course exercises for it is retained (S ≥ 21 d). The percentage is the known lexemes' share of
the course word list weighted by a Zipf curve over the teaching order, labelled
`audited: false` with its method until the monthly retention audit exists (docs/08 §9).

### 5.6 The Word Garden — Decided
`GET /v1/garden/summary` and `/garden/beds`: one plant per seen lexeme, stage = the weakest
aspect's mastery state (seed, sprout, bush, bloom, tree; leech; paused), health = its
retrievability now, thirsty when any aspect is due. Plants never die. `GET /v1/reviews/due`
orders by 1 − R (leeches weighted up) and picks, for each memory item, an exercise of a family
suited to its state and never the type used last time (docs/08 §5.1).

## 6. Phase 7 (test-out and placement) and the cosmetic shop — 2026-10-04

### 6.1 Test-out — Decided
`POST /v1/assessment/checkpoints {unit_id}` gives a fixed form of twelve auto-graded items, tier
3 then tier 2, round-robin over the unit's nodes, chosen deterministically from the checkpoint's
UUID (a fixed form until IRT calibration exists, docs/12 §3). The answers travel through the
ordinary `POST /v1/sync/reviews` with `session_id` = the checkpoint id, so they schedule memory
like any answer and need no second upload path. `…/complete` grades the first answer per item:
a pass needs ≥ 90 % of the form answered and ≥ 85 % right. A pass credits tier 2 on every node
not yet there (`tested_out`), completes the unit (+30 gems, its passport stamps) and adds +60
gems once per unit. A fail costs nothing; test-outs are free and unlimited (docs/10 §4).

### 6.2 Placement — Decided
`POST /v1/assessment/placement` then `…/{id}/answers`: a binary search over the ten
sub-levels, five quick text-only items a stage (no audio, so it works anywhere), ≥ 80 % right
means the level is known. At most four stages. It grades on the server and writes no reviews:
placing is assessing, not practising. The result is the first sub-level not yet known and its
first unit; the app offers it as a starting point and never locks earlier units.

### 6.3 The shop sells looks only — Decided
`GET /v1/shop`, `POST /v1/shop/purchase`, `POST /v1/shop/equip`. The catalogue
(`app.domain.shop`) has three kinds — Pip outfits, themes, path skins — with one equipped per
slot. Nothing buys a lesson, hint, test attempt, streak freeze or repair (freezes are free,
docs/10 §8), nothing expires and nothing is "limited time"; a unit test fails if an item id or
kind drifts toward learning. A purchase is a negative `gem_ledger` row (`reason='purchase'`),
so the balance stays the ledger's sum and every gem is accounted for.

## 7. Phase 8, first part: the AI conversation partner — 2026-10-04

### 7.1 Optional, server-side, and off without a key — Decided
The partner (docs/16 E21) exists only when `LEP_AI_API_KEY` is set; `GET /v1/ai/status` says
`available: false` otherwise and the app hides it. Every learning path works without it. All
calls go through the server (`app.ai.partner.ClaudePartner`, behind the `ConversationModel`
port), so no provider key or host ever reaches a client. Model `claude-opus-5-5` at effort `low`
with structured output (`PartnerTurn`: reply, ≤ 2 recasts, goals met, off-limits flag), the
system prompt cached as a stable prefix, and server-side refusal fallback on. A refusal or an
off-limits request gets a fixed, kind line that steers back to the scenario (§11.4).

### 7.2 The character speaks at the learner's level — Decided
Characters are the story's cast, offered only from the unit where the learner first meets them,
and know only the episodes up to the learner's unit (no spoilers). A reply is checked for
sentence length and known-word coverage against the course vocabulary so far
(`domain.conversation.check_level`); a reply that fails is regenerated once with an operator
note. Goals are the unit's can-do statements.

### 7.3 Turns are idempotent and never hold a connection over the network — Decided
Each learner turn is stored (and counted) in one short transaction, the model is asked outside
any transaction, and the reply is stored in a second one. Retrying with the same `client_uuid`
returns the stored reply, or resumes a turn whose model call failed. A start whose opening
line could not be fetched is rolled back and its allowance refunded.

### 7.4 Allowance, privacy, retention — Decided
Five conversations, twelve turns each and 400k tokens per learner-local day by default: uniform,
published, and never sold for gems or money. Emails, phone numbers and links are redacted before
anything is stored or sent, and the character's reply is cleaned the same way. Minors get a
stricter topic rule. Transcripts carry `expires_at` (30 days); a daily worker job
(`lep.ai.purge_expired_conversations`, 03:23 UTC) deletes them, and the learner can delete one
at any time. Accuracy mode shows recasts during the chat; fluency mode keeps them for the
end-of-chat summary (two things to work on, words used, XP: 3 per turn of ≥ 3 words).

### 7.5 Not yet built in Phase 8
TTS drafts, ASR + GOP pronunciation scoring, and LLM rubric raters with versioned prompts are
still open; speaking items keep their self-assessed fallback until then.

## 8. Phase 5 (session composition) — 2026-10-04

### 8.1 A pure composer — Decided
`app.domain.composer` is pure (no I/O) and does all of docs/08 §5: the budget split by length,
the review block by priority `(1 - R) × importance × (1 + 0.3·leech) × (1 + 0.2·in current
level)`, the new block in syllabus order, warm-up (up to 2 items at R ≥ 0.95) and close (the
weakest memory item just reviewed, through a different exercise), leeches ≤ 5 % of the time,
a 15 s break every 12 min above 20 minutes, and fit to T + 10 % from expected seconds (the
learner's median RT per exercise family over the last 400 answers, ≥ 8 per family, else the
population median; plus 3 s to read feedback). `app.services.sessions` only gathers and stores.

### 8.2 Interleaving as hard rules — Decided (one reading recorded)
On the whole sequence: ≤ 3 consecutive items on one target, ≤ 2 of one exercise type, and the
same item never twice running. "Rotate modality read / listen / type / speak" is read as a
preference for the next modality in the cycle at every pick, plus a hard cap of **3 consecutive
items of one modality** — a strict cycle cannot be met by a corpus where half the types are
"read". An item that no position can take without breaking a rule is **left out and listed in
`deferred`**, never forced in. Tested over 1,000 random learner states.

### 8.3 "New items" are syllabus targets — Decided
The daily cap (15 at A1–A2, 20 at B1+) counts **targets** — a lexeme, grammar point, phonology
point or function — not memory items (one word has up to five aspects, so 15 memory items would
be three words). A target is new when none of its memory items has state; today's count is the
targets whose first `review_log` row falls on the learner-local day. No new material while the
backlog exceeds 3× a normal day (normal = daily goal × 60 s / 10 s per review); the review queue
is then capped at 1.5× normal and the response carries `catching_up.days_left`.

### 8.4 Node sessions and tier gates — Decided
`POST /v1/sessions {minutes, node_id, tier}`: tier 1 is always open, tier 2 needs tier 1, tier 3
needs tier 2 **and 3 days** (`TIER3_SPACING`, now shared with the award pipeline) — else 409
`tier_locked` with `available_at`. The node-tier's items come first and whole (their 60 / 30 / 0 %
new mix is built into the content); due reviews fill the remaining time. An opened lesson is not
trimmed to fit the new cap: it is refused whole with 409 `new_items_capped` — except the day's
first lesson, so a tier-1 node larger than the cap can always be played.

### 8.5 Not done in Phase 5
* **Daily load balancing** (moving the least urgent items forward when a day is over capacity by
  20 %) is not applied to stored due dates: it would make an item's due date depend on other
  items, and replay equals state (§5.2) only holds while each item's schedule is a function of
  its own log. The queue cap and priority order give the same day-to-day smoothing at read time.
* **Interference separation** inside a session (docs/08 §8) relies on the build, which already
  keeps interfering pairs in different nodes; the composer does not check it again.
* ~~The app still composes node sessions on the device~~ — done: the app asks `POST
  /v1/sessions` and composes on the device only as a fallback (frontend DECISIONS §14).

## 9. Phase 7, the rest: level exams, rubrics, the level award, audits — 2026-10-04

### 9.1 The four conditions, each with its value — Decided
`app.domain.level_award.evaluate_level_award` (pure) returns coverage, retention, exam and
production separately, each with its computed value, threshold and a plain shortfall ("250 more
memory items to reach 'known' (21 days)"). **Coverage** counts the level's syllabus targets (a
lexeme, grammar point, phonology point or function, from the memory items of the level's items)
whose teaching nodes include one passed at tier ≥ 2. **Retention** is the share of the level's
memory items now `retained` or better. **Exam** is the latest completed level exam: ≥ 75 %
overall and no paper below 60 % (C2: 80 / 70; this resolves R7 — docs/12 §4.3 agrees with the
brief). **Production** needs writing and speaking at the level's band (A1 = 1 … C2 = 6) by a
machine score and, from B1, by a certifying score. Passing the exam on fragile memory returns the
docs/12 §4.3 sentence verbatim and no award. `GET /v1/progress/level/{level}` evaluates;
`POST …/award` evaluates and stores the whole evidence object on `level_awards`.

### 9.2 Rubrics: median, cap, evidence — Decided
`app.domain.rubric`: 5 writing, 6 speaking and 4 mediation criteria, bands 1–6 in half steps;
overall = median (floored to a half step) capped at one band above any criterion two or more
below it (6/6/6/6/2 → 3). A criterion without evidence fails validation; the service also drops
any quotation that is not in the learner's text, so a rater cannot invent its evidence. Borderline
= within 5 % of the scale (±0.25 band) of the level's band.

### 9.3 Raters and the κ gate — Decided
Quadratic weighted κ is computed in `app.domain.rubric`; `rater_calibrations` holds κ per
(rater version, level, task kind), written by the rating team (the API role can only read it).
`certifying` is decided **when a score is stored**: a human, or a machine rater at κ ≥ 0.75 for
that level and kind. With no calibration rows — the state of a new deployment — every machine
score is formative only, so no level from B1 up can be certified until the panel has measured
the rater. The writing rater is Claude (`app.ai.rater`, effort `medium`, structured output, a
versioned prompt). "Temperature 0" cannot be set on current models; determinism is met by rating
each submission once and returning the stored score. Human audit rows are queued for every
borderline certifying score, a deterministic 10 % of the rest, and every appeal (once per score).

### 9.4 Level exams — Decided (one gap recorded)
There is no exam item bank yet (docs/12 §4.4 asks for 8× the exam length). A form draws the
level's tier-3 then tier-2 items per paper (listening, reading, use of English, docs/12 §4.1
counts), spread over exercise types, never an item from the learner's exams in the last 12
months, deterministic from the exam id; a paper with under half its blueprint is refused as
unfair. Answers come through the review sync like test-outs; unanswered items count as wrong.
Writing and speaking tasks are authored in `app.domain.exam`. Speaking is scored through the
speech port (§10.5) once a provider is chosen; until then the production condition cannot pass
for anyone, and the award says so in its shortfall rather than skipping the condition.
Mediation is not scored yet.

### 9.5 The retention audit — Decided
`POST /v1/assessment/audit`: 20 `retained`/`durable` memory items, each through an auto-graded
exercise (recall families first; never speech), at most once every 28 days. Predicted recall is
the mean retrievability now; actual is the first-answer share right. When actual is more than 10
points below predicted, the desired retention steps up one preset and every due date is
re-derived (as `PATCH /v1/me/settings` does). Per-learner FSRS refitting is not implemented.

### 9.6 Bias audit and BKT — Decided
A weekly Celery task (`lep.assessment.bias_audit`, Mondays 04:41 UTC) compares machine-rated mean
bands by L1 and age band per level and task kind (groups of ≥ 20) and logs `rater_bias_alert`
when a gap exceeds 0.3 bands. Gender and accent group are not collected, so they cannot be
audited. `app.domain.bkt` is the knowledge-tracing baseline (p(guess) from the exercise family);
it is pure and tested but not yet surfaced — it may only ever inform, never gate.

### 9.7 Not built
The placement test stays the binary search of §6.2: the 2PL IRT CAT needs a calibrated bank of
≥ 1,500 items, which needs response data first. Section checkpoints that gate progression
(R18, §14.9), human-rater tooling and proctored mode are not built. ~~The exam report (docs/12 §9.2)~~ —
built (§14.7).

## 10. Phase 8, the rest: audio, speech, raters, consent — 2026-10-04

### 10.1 Providers are ports, and none is chosen — Needs ruling (R15)
`app.media.ports` defines `TtsEngine` and `SpeechScorer` (forced alignment, GOP per phone,
stress, timings and an independent ASR pass). No adapter is wired: the voice, the acoustic model
and the ASR are product decisions (quality — human voices are required below C1 anyway, docs/15
§5 —, speech-data residency, cost). With `LEP_TTS_PROVIDER` / `LEP_SPEECH_PROVIDER` at `none`,
`POST /v1/media/tts` and `POST /v1/media/speech` answer 503 `media_unavailable` and store nothing;
the `tts_drafts` job logs that it skipped. Everything around the ports is built and tested with
fakes, so an adapter is the only missing piece. **Ruling needed: which TTS and speech providers.**

### 10.2 The audio situation, stated honestly — Decided
`media_assets` records every audio file the content refers to — **2,947 distinct item files**
(10,506 items share them; the brief's 20,792 also counted option, lexeme and story audio the
packed content does not reference) — as `missing`, with the text it should say (the item's own
`say`, as the packer resolved it). The daily `lep.media.seed_assets` job is idempotent.
`GET /v1/media/assets/{path}` reports `source: none | synthetic | recorded` and a URL only when
the file exists. A synthetic draft never overwrites a human recording. Human recordings pass
`qc_master` (`app.domain.audio_qc`): 48 kHz mono, BS.1770-4 integrated loudness −16 LUFS ± 1
(K-weighting and both gates; the implementation reads the standard's calibration tone at −3.01
LUFS), no clipping, edges trimmed, the encoded file ≤ 60 kB. Opus encoding itself is outside
the server.

### 10.3 Pronunciation policy — Decided
`app.domain.pronunciation`: one headline (0–100), at most two notes (contrast substitutions
first, then stress), per-word scores, judged against the level's bar (docs/02 §10.2). Accent is
never an error: a phone the scorer marks as the right phoneme keeps a passing score however low
its GOP; only a substituted contrastive phoneme counts (ship → sheep).

### 10.4 Recordings: consent, ceiling, asynchronous, deletable — Decided
A recording is accepted only with `voice_consent` on, data collection not paused, at most
`LEP_MAX_RECORDING_SECONDS`, within the daily seconds ceiling; it is stored with `expires_at`
(≤ 30 days) and scored **after the response is sent** (FastAPI background task) — the app polls
`GET /v1/media/jobs/{id}`, so a lesson never waits. Audio travels as base64 JSON (≤ 2 MB), which
keeps multipart out of the API. Withdrawing consent deletes every recording; so does
`DELETE /v1/me/recordings`; the daily `lep.media.purge_expired_recordings` job deletes expired
ones. Deletion is real (row and audio) and leaves a tombstone with only the id, time and reason.
`training_opt_in` is a separate setting, off by default, and nothing reads it yet.

### 10.5 Speaking tasks and every score's evidence — Decided
A speaking task's transcript is rated on range, accuracy, fluency (with the measured speech rate
and pause ratio), interaction and coherence by the speaking rater (Claude, prompt
`speaking-rater-2026-10-04`); phonology is the pronunciation headline mapped to a band, with the
scorer's notes as its evidence. The score goes through the same path as writing — quotations not
in the transcript are dropped, the κ gate, human audit. The database now refuses a rubric score
with no criteria or a machine score with no prompt version.

### 10.6 Data controls — Decided
`GET /v1/me/export` returns every row of every learner-owned table (recordings as base64),
leaving out the password hash and token material. `POST /v1/me/delete {password}` deletes the
account and everything that cascades from it, inside a transaction that declares an erasure for
the append-only review tables. `PATCH /v1/me/settings` takes `voice_consent`, `training_opt_in`
and `data_collection_paused`; while paused, no recordings or writing are accepted.

## 11. Review fixes for Phases 5–8 — 2026-10-05

An adversarial review of Phases 5–8 (64 candidate findings, each checked against the code and,
where possible, reproduced) led to these changes. Each has a regression test.

### 11.1 Session composition — Decided
* **The new-material cap counts everything a session introduces**: lesson items, reviews and the
  close share one allowance of fresh targets (a target with no memory state yet). A due review
  that would introduce a target is avoided when another exercise of the same memory item does
  not; the close never introduces anything and is never a leech.
* **The new block keeps its authored order and is never dropped**: interleaving is enforced on
  the review block, and spare reviews are placed between lesson items as spacers. A run may
  only exceed the limits where a lesson item is placed (§8.2's "left out" applies to reviews).
* A node session's budget is at least warm-up plus the whole node-tier; a session of 5 minutes
  or less that is not a node-tier introduces nothing.
* The queue cap applies **after** sorting by priority, so the most urgent reviews are kept.
* Leech repeats avoid the exercise types of the item's last three failures.
* `tier_gate` reads the node's populated tiers: the lowest populated tier is open; a tier opens
  after any populated tier below it; replaying a finished tier is allowed; tier 3's spacing
  applies only when tier 2 exists. The award pipeline uses the same function.
* While catching up (backlog > 3× a normal day), a node-tier that would introduce new targets is
  refused with `new_items_capped`; the day's first lesson is still exempt.

### 11.2 Level exams, production, audits — Decided
* An exam has `ends_at` (the papers' minutes plus a 10-minute grace, `app.domain.exam`); only
  first answers the server **received** inside the window count, ordered by the server's uuid7
  ids — a client-chosen `answered_at` cannot backdate a retry. An open exam is resumed, not
  re-drawn. When the 12-month exclusion leaves too few items, the form may reuse items from older
  exams (never the last one) and says so (`reused: true`).
* Writing is rated once per (task, text): resubmitting the same text returns the stored score.
* **Production** takes each task's latest submission; a human score overrides a machine score; a
  machine score certifies only when it is certifying **and not borderline** (a borderline score
  waits for its human audit). The band is the lowest over **every** production task of the level;
  a missing task fails the condition.
* The retention audit must be answered within 24 hours; the 28-day spacing counts from completed
  audits; a learner with too few eligible items is refused after selection, not before; the
  learner is locked before the desired retention is raised.
* The bias audit averages per learner first, so a prolific learner cannot dominate a group.
* κ is 0 when the ratings have no variance (it used to divide by zero).
* New writing is refused while data collection is paused.

### 11.3 Recordings and speech — Decided
* **The seconds charged are proven by the audio**: a WAV states its length; any other file
  cannot be shorter than its size at the highest bitrate the app records at (8 kB/s). The charge
  is the larger of that and the client's figure; over the cap is 422.
* The daily usage row is created with `INSERT … ON CONFLICT DO NOTHING` and then locked, so two
  parallel requests cannot both pass the ceiling; consent and the pause flag are read `FOR SHARE`.
  The day charged is stored on the recording, so a refund goes back to the right day.
* A scorer failure of any kind marks the job failed and refunds it; a job still queued after an
  hour (a lost worker) is marked abandoned and refunded by the nightly purge.
* A recording past `expires_at` is gone for the learner at once (job, list, export), before the
  purge deletes it.
* **Free speech is judged on intelligibility** — the agreement of two independent recognition
  passes — not on forced alignment against a text it never had. Word scores are floored at the
  level's GOP bar, so at C1/C2 an accented but correct phoneme is never a fail; a contrastive
  substitution (ship → sheep) still is. Phone-level scores are returned with each word.
* TTS drafts are written to a `.draft` file and moved into place inside the transaction, only if
  no file has appeared meanwhile — a human recording is never overwritten.
* `safe_path` rejects a NUL byte (it used to raise a 500); deleting the account is rate-limited
  like sign-in.

### 11.4 The AI partner — Decided
* **The adapter parses the structured output itself** (`messages.create` with the JSON schema as
  `output_config.format`): a refusal after partial output, a reply cut off at `max_tokens`, or
  JSON that does not fit the schema is a refusal — with its tokens counted — never a 500.
* **Any failure to open refunds the start** (the conversation row is deleted and the allowance
  given back — once, even if a retry already reclaimed it), not only a provider outage. The opening line is cleaned like every reply and is
  never empty.
* **A start is idempotent by the app's `client_uuid`**: a retry (after a client timeout — the
  server keeps going when the client gives up) returns the same conversation, charged once; 409
  `ai_busy` while its opening line is still being written; a start abandoned for longer than a
  reply could take is given back and started afresh (should the abandoned request still finish,
  its tokens are counted and it answers 404 — the retry's chat is the one that stands).
* **One model call per reply**: the learner turn holds a lease (`answering_until`, 4 × the
  timeout + 15 s) while its reply is written; a duplicate request, a new message and `end` all get
  409 `ai_busy` meanwhile. A failed call — or a reply that could not be stored — gives the lease
  back at once, but **only this request's lease** (matched by `client_uuid` and the exact lease
  value): a request that outlived its lease never clears a newer request's.
* **A message that was never answered, and is no longer leased, is replaced by the next one**,
  in its place: the transcript always alternates, every reply answers the latest message, and
  turn numbers never go backwards. The app does not rely on this: it retries a failed message
  with its own id before it sends anything new (frontend DECISIONS §13), because a message that
  failed on the device may still be answered on the server. `end` waits for a reply being
  written; a reply that arrives after the chat ended (its lease ran out) is not stored.
* **Every model call is counted** against the token budget, including duplicates, a reply
  that lost a race, and the first call when the level retry fails (that first reply is then
  used: above the level, but a reply). A resumed turn checks the allowance again.
* The reply's transaction takes its locks in one order — the conversation, then the learner
  (the lock review ingest and `start` take), then the day's usage row — before it writes: no lost
  updates to the day's aggregate, no deadlock with a reply or a start running beside it, and a 404
  rather than a foreign-key 500 when the chat was deleted meanwhile.
* **An off-limits request gets the fixed safe line**, never the model's text, and earns no
  recasts, goals or production XP; the flag is stored with the reply (`off_limits`) so a replay
  reports it too. The level check is skipped for such replies.
* The level-retry note quotes the rejected reply (it is not in the history).
* The level check reads contractions (*don't* → *do*, *can't* → *can*, *won't* → *will*) and
  typographic apostrophes.
* Redaction also catches links without a scheme (`t.me/…`, `instagram.com/…`, known TLDs; TLDs
  that are English words — *me*, *by*, *uk*, *info*, … — only with a path, so "I went home.By the
  way" stays) and `@handles`; recasts are redacted too. A phone
  number needs a `+` and 7 digits, 10 digits, or 9 digits not grouped in thousands — dates
  (12.05.2010) and prices (1 500 000 so'm) the learner is practising stay.
* Words used counts multi-word lemmas (*thank you*, *in front of*) said in a row.
* Recast spans are UTF-16 offsets — what the app's JavaScript `slice` counts.
* **Reach**: a conversation may only use a unit the learner has reached (the furthest unit
  worked in, the one after the furthest completed, or where placement put them); the cast list is
  capped there, so the story is never spoiled through the API.

## 12. Phase 9: sync, hardening, operations — 2026-10-05

### 12.1 Offline bundles — Decided
* `GET /v1/content/bundle?since=` (public, cacheable, ETag): every content file — the course
  outline and each unit — with its SHA-256, size and URL; with `since` equal to the current
  content version, `unchanged: true` and nothing else. A device keeps a cached file while its
  hash matches and checks what it downloads.
* `GET /v1/sync/bundle?since=` (signed in): `current_unit`, the next **five units** from it,
  and every memory item due in the next **seven days** (soonest first, at most 5,000, with the
  total) — backend brief §11, docs/00 §6. Each due entry carries the exercise to review it by
  (`item_id`), chosen as for `GET /v1/reviews/due` but from units the learner has reached
  wherever one exists (nothing later in the course is spoiled), so the app can water the garden
  offline exactly as the server would have asked (frontend DECISIONS §15); the bundle lists the
  units those exercises are in.
* Every file's hash is computed at start-up (about a second, in a thread), so no request hashes
  22 MB on the event loop. Every content ETag — the course, each unit, the manifest — is the
  hash of the bytes served, not the content version: a release that serialises content
  differently, or a moved CDN, is never answered with a 304 and the old body.
* **CDN.** `make bundle` writes `course.<hash>.json` and `units/<unit>.<hash>.json` with a
  manifest; with `LEP_CONTENT_CDN_BASE_URL` set, the manifests point there (immutable URLs keyed
  by hash), otherwise at `/v1/course` and `/v1/units/…`. Bundles are **not signed with a key**:
  they hold no learner data or secret, and the hash, delivered over the authenticated API, is
  what proves a file is the one the server meant (docs/11 §3's "signed" read as integrity).
* Offline answers already replay through `POST /v1/sync/reviews` with their true timestamps and
  re-derive state from the log (§5.1–5.2); a 500-answer batch is tested to replay exactly.

### 12.2 Graceful shutdown — Decided
Tested on a real uvicorn server: a 40-answer sync is held *inside* its open transaction (the
learner's lock taken, a pooled connection checked out) when the shutdown begins (what SIGTERM
does); it commits and answers 200, every row is stored, a new connection after the shutdown began
is refused, and the pools close only after the commit (the order is asserted). Workers: `acks_late` and
`reject_on_worker_lost` (§2.11).

### 12.3 Load — Decided (numbers measured, bar not certified: R16)
`scripts/loadtest.py`: each virtual learner signs up, then loops — open a session (a tier-1
lesson the first time, then a ten-minute session of what is due), sync ten answers in it (real
multiple-choice items, 80 % right), send one answer, read the due queue. Any refusal counts as a
failure, and percentiles are nearest-rank. (The first runs below counted the day's
new-material refusals as served lesson opens; the scenario was corrected after review.) The
first run found the hot path doing one INSERT per row (a 10-answer sync made 65 SQL round
trips) and recompiling every `insert(...).values(dict)` statement, which has no cache key:

* the review ingest now grades the whole batch in memory and writes attempts, log rows, keys
  and memory states in **one round trip per table**, through cacheable Core statements; the
  award pipeline checks every touched node-tier with **one** query; days and streaks are
  cacheable upserts. A 10-answer sync went from 65 statements to 22, and a 60-answer sync
  makes no more than a 10-answer one — **a test now fails if the hot path's round trips grow
  with the batch** (`test_the_hot_path_makes_few_round_trips_whatever_the_batch_size`);
* the progress indexes are built at start-up, not by the first request (1.5–3.5 s).

Measured on the development laptop — a 2-core i3-1115G4 shared by PostgreSQL and Redis (in
WSL), the API (one uvicorn process), the load generator and the desktop, at 100 % CPU and
1.8 GB free — over 60 s (ms):

| Learners | Endpoint | Requests | p50 | p95 | p99 | Failed |
|---|---|---|---|---|---|---|
| 50 | `POST /v1/sessions` | 157 | 4281 | 8701 | 9892 | 16 |
| 50 | `POST /v1/sync/reviews` | 157 | 6774 | 13658 | 15627 | 37 |
| 50 | `POST /v1/reviews` | 157 | 5843 | 9281 | 10307 | 29 |
| 50 | `GET /v1/reviews/due` | 157 | 3138 | 7860 | 9873 | 10 |

(before the changes, above; after, below — the two are **not comparable**: the host's own
load changed between runs, and the same code's `GET /v1/reviews/due` for a single learner took
30 ms in one run and 90 ms in the next. What can be compared is per request: SQL statements
65 → 22 for a 10-answer sync, constant in the batch size; process CPU for one warmed learner,
in process with the client, about 30–45 ms to open a lesson, 95–110 ms for a 10-answer sync
and 95–140 ms for one answer. Most of the rest is round trips: on this host every socket send
to the WSL network costs about 0.4 ms. The failures are 503s from the database pool timeout
(5 s) under queueing.)

| Learners | Endpoint | Requests | p50 | p95 | p99 | Failed |
|---|---|---|---|---|---|---|
| 10 | `POST /v1/sessions` | 50 | 2301 | 3075 | 3118 | 0 |
| 10 | `POST /v1/sync/reviews` | 50 | 4823 | 6171 | 6184 | 0 |
| 10 | `POST /v1/reviews` | 50 | 4327 | 5455 | 5654 | 0 |
| 10 | `GET /v1/reviews/due` | 50 | 1186 | 1341 | 1360 | 0 |
| 50 | `POST /v1/sessions` | 100 | 10740 | 15760 | 16693 | 25 |
| 50 | `POST /v1/sync/reviews` | 100 | 9156 | 14840 | 16038 | 44 |
| 50 | `POST /v1/reviews` | 100 | 8531 | 13790 | 16530 | 35 |
| 50 | `GET /v1/reviews/due` | 100 | 5967 | 9722 | 10384 | 26 |

With the corrected scenario (a lesson, then sessions of what is due; every refusal a failure),
same machine, one API process, 60 s (ms):

| Learners | Endpoint | Requests | p50 | p95 | p99 | Failed |
|---|---|---|---|---|---|---|
| 10 | `POST /v1/sessions` | 317 | 364 | 850 | 923 | 0 |
| 10 | `POST /v1/sync/reviews` | 317 | 631 | 1059 | 1189 | 0 |
| 10 | `POST /v1/reviews` | 317 | 575 | 879 | 957 | 0 |
| 10 | `GET /v1/reviews/due` | 317 | 207 | 360 | 501 | 0 |
| 50 | `POST /v1/sessions` | 351 | 2027 | 4002 | 5024 | 0 |
| 50 | `POST /v1/sync/reviews` | 351 | 2436 | 4428 | 5352 | 1 |
| 50 | `POST /v1/reviews` | 351 | 2501 | 4299 | 5469 | 0 |
| 50 | `GET /v1/reviews/due` | 351 | 1726 | 3789 | 4694 | 0 |

On this machine the bar is not met even at 10 concurrent learners on one process: the one
process serves about 20 of these requests a second here, so ten learners already queue behind
each other and fifty queue for seconds. The numbers are recorded, not certified. The bar needs a run on
production-like hardware (several API processes, PostgreSQL on its own host) with the same
script — docs/RUNBOOK.md §3 gives the command — and a ruling on the concurrency per instance
it applies to (**R16**).

### 12.4 Runbook — Decided
`docs/RUNBOOK.md`: what runs and what a failure of each means for learners, the release order
(content to the CDN first, migrations, rolling restart, verification) and rollback, capacity,
the scheduled jobs and what to do when one fails, incident playbooks (database, Redis, the AI
partner, a bad content release, sign-in abuse and a leaked signing key, rater bias, memory-state
drift) and data requests, with backup retention bounded by the 30-day voice and transcript
promise.

## 13. Definition of done, checked — 2026-10-07

* **`docker compose up` could not have started the API.** The image carries `app/` and
  `migrations/` only, and the content's default path (repo-relative) does not exist inside it;
  a malformed or missing bundle stops start-up by design. The packed course is now mounted
  read-only (`LEP_CONTENT_DIR=/srv/content`) into the API, the worker, beat and the demo seed —
  it stays a separate artefact, as a content release is. A unit test reads the compose file and
  fails if a process that loads the course loses its mount.
* **A demo learner.** `scripts/seed_demo.py` (`make demo`, and the one-shot `demo` service in
  compose) creates `demo@learn-english.example` through the API in process — the same grading,
  scheduling and awards as a learner: parts of Unit 1 practised nine days ago, so reviews are due
  today; the first lesson of Unit 2 (before the test-out, which uses up the day's new material —
  the day's first lesson is always allowed); Unit 1 tested out. Idempotent; refuses `LEP_ENV=prod`;
  the password comes from `LEP_DEMO_PASSWORD` or the `lep_demo_password` secret and is never
  printed. The helper that builds a correct answer from an item's key moved from the tests to
  `app.content.answers`, so the seed can use it.
* **Operations scripts are in the image** (`COPY scripts`), so the runbook's `make replay`
  equivalent (`python -m scripts.replay`) and the seed run inside a container. `httpx`, which the
  seed and the load test use, reaches the image through the Anthropic SDK.
* **Coverage** (2026-10-07, the full suite): 91 % overall (statements and branches), 95.7 % of
  `app/domain` statements — against the brief's 70 % and 85 %. `mypy --strict` is clean over
  `app`, migrations, tests and scripts.
* Not verifiable on this machine: Docker does not start here, so `docker compose up` itself was
  not run; the compose file is checked by the test above and by parsing.

## 14. What the app was waiting for — 2026-10-08

The frontend's "waiting on others" list (frontend DECISIONS §11) named five things the backend
did not have. All five are built; the app side is in frontend DECISIONS §21 onwards.

### 14.1 The accessibility profile reaches the scheduler (F19, F6) — Decided
* The profile is a learner setting (`a11y_no_audio`, `a11y_no_vision`; migration
  `0009_access`), changed with `PATCH /v1/me/settings` and returned by `GET /v1/me`. A session
  request may name a profile of its own (`a11y_profile`), which wins for that session; the plan
  records which one it was chosen for.
* One table, `app.domain.accessibility`, the same as the app's `src/a11y/profile.ts`: without
  audio, `minimal_pair_discrimination` and `phoneme_id` are **never** chosen (no text route tests
  the same thing); listening and dictation types are a *degraded* route (read from the
  transcript), as are `memory_match` and `word_race` without vision (a list). Every place that
  picks an exercise for a memory item — the session's reviews, warm-up, close and recovery, the
  due queue, the offline window of `GET /v1/sync/bundle` — takes full routes first, a degraded
  one only when nothing else reviews the item, and an excluded one never.
* A node-tier's own lesson items cannot be swapped: those the profile has no form for are left
  out of the plan and listed in `withheld`. A tier is then **passed on the items it could show**
  (the 60 % coverage counts those), under the profile the server planned that session for, or
  the saved one for a session the server did not compose. Without that, a learner who cannot
  hear could never pass the 1,163 node-tiers that hold sound-only items (some are 80 % minimal
  pairs). A test asserts that no node-tier is left with nothing to show.
* Not applied to assessment forms (test-out, placement, the level exam, the memory check): the
  app withholds and counts there, and a form's score is over what was answered. A
  profile-aware form needs the item bank's IRT parameters (§9.7) to stay comparable.

### 14.2 Phases and recovery on every plan (F19, S14) — Decided
* Each step carries its docs/07 §3.2 `phase`: warm-up, review, close and break are the role's;
  a lesson item is **production** when it is speaking or free writing, otherwise **guided** for
  the first 60 % of the lesson's practice items and **integration** after them — the rule the
  app already used, now the server's. No item is `new_input`: new material is presented, never
  tested, and the app presents it before the first lesson item. Plans stored before this read
  back with the role's phase.
* `recovery`: up to two items the learner is almost sure to get right — p(correct) ≥ 0.95 now,
  through a recognition exercise, a different type each, introducing nothing, not in the plan.
  The app plays one before CLOSE only when the last graded answer was wrong (docs/07 §3.2:
  never close on a failure), so they are outside the plan's time. The app used to re-present
  an item from the same session; a near-certain item the scheduler chose is the better ending,
  and its answer is a real (early) review.

### 14.3 Forgotten and changed passwords (B5) — Decided (the relay: R17)
* `POST /v1/auth/password/forgot` answers **202 with the same body for every address**, and
  does the same work inside the request either way (two rate-limit checks); the lookup, the
  token and the letter happen after the response, so neither the answer nor its timing tells
  which addresses are registered. Rate-limited per IP (10 an hour) and per address (3 an hour),
  both failing closed.
* A link is a 256-bit token, stored as its SHA-256, valid **30 minutes** and **once**; a newer
  request voids older links. The letter is plain text in the learner's first language when
  the app speaks it, then English.
* `POST /v1/auth/password/reset`: the link is checked under a row lock, the new password is
  screened and hashed *between* two short transactions (Argon2 never holds a connection), and
  the second transaction re-checks the link, sets the password, uses the link, voids the others
  and **revokes every session** (`password_change`) — whoever knew the old password is out. The
  learner signs in again; a reset never signs anyone in by itself.
* `POST /v1/me/password`: the current password first (in the sign-in rate-limit bucket, so it
  cannot be guessed here instead), and not the same as the new one; the other devices are
  signed out, this one stays.
* Mail is a port with two adapters: **SMTP** (STARTTLS or implicit TLS, certificate verified;
  every provider speaks it, so choosing one is configuration) and a **file outbox** for local
  and test stacks (refused in prod). The local compose stack writes letters to a volume
  (`make mail` prints the newest). With no backend, the endpoint answers 503
  `password_reset_unavailable` and the app shows how to get help.
* Expired links are deleted by the daily auth purge.

### 14.4 The web's refresh cookie (F8) — Decided; §2.10 revised
* Off unless `LEP_WEB_REFRESH_COOKIE`. Then a client that sends `X-LEP-Token-Transport: cookie`
  gets the refresh token as `__Host-lep_refresh` — `HttpOnly`, `Secure`, `SameSite=Strict`,
  `Path=/`, no `Domain`, `Max-Age` of the token — and `refresh_token: null` in the body; `/refresh`
  and `/logout` read it from there (`/logout` also clears it). Native clients are unchanged.
* Forgery: the cookie is never sent cross-site (`SameSite=Strict`); it is read only with the
  custom header, which a form cannot send and which forces a CORS preflight; and a request with
  an `Origin` that is neither the API's nor in `LEP_CORS_ORIGINS` is refused (403
  `origin_refused`). Reuse detection applies to cookies as to bodies.
* **§2.10 revised:** CORS credentials are allowed when, and only when, the cookie is on. No
  other route reads a cookie; every other call still authenticates with the bearer token.
* It needs the web app and the API on one *site* (`app.example.org` and `api.example.org`, or
  one origin): a cross-site API would need `SameSite=None`, which this does not offer.

### 14.5 New passwords are screened (R14) — Decided; HIBP behind a switch
* At registration, reset and change — never at sign-in — a password is refused (422, with a
  reason, never echoing it) when it is one of the most common ten-plus-character passwords, a
  common word padded with digits or symbols, one or two characters repeated, a run along the
  alphabet, the digits or a keyboard row, or little more than the email's name or the app's.
* With `LEP_HIBP_ENABLED`, also against Have I Been Pwned's Pwned Passwords range API with
  k-anonymity: five hex digits of the SHA-1 leave the server, padding is requested, the rest is
  compared here. It **fails open** (an outage there must not stop sign-up), and every outcome
  is counted (`password_screen_total{outcome}`). Off by default: sending even a hash prefix to a
  third party is the product owner's call — R14 now asks only that.

### 14.6 Capabilities and client events (F2) — Decided
* `GET /v1/capabilities` (public, cached five minutes): whether the conversation partner, TTS,
  speech scoring, password reset and the web refresh cookie are configured, how passwords are
  screened, and the content version. The app shows an unconfigured feature as absent, never as
  an error.
* `POST /v1/client-events`: a fixed list of events only the device can see —
  `refresh_response_lost` (the data R13 waits for), `outbox_full`, `server_plan_unplayable`,
  `audio_fallback` — each with a count, plus the platform and app version. No learner, device
  id or free text; counted in `client_events_total{name,platform}` and logged once per batch,
  never stored. Anyone may send them (an event often follows a lost session): rate-limited per
  address, failing open.

### 14.7 The report after a level exam (docs/12 §9.2) — Decided
`GET /v1/assessment/exams/{id}/report`, for a completed exam (409 `incomplete` before), built
from what is stored — the first answer received for each item inside the exam's window (the
answers that were scored) — so it says the same thing whenever it is asked for.

* **Papers**: each score with its two bars and a band word — *secure* (10 points or more above
  the overall bar), *pass*, *borderline* (above the paper bar only), *below* — and the median
  seconds per answer. The overall is shown with the papers, never alone (§9.3).
* **The four skills** (and "language", the use-of-English paper): listening and reading are the
  paper shares; writing and speaking are the latest rated tasks' bands (1–6) against the
  level's band, **null when not assessed** — never zero, never guessed.
* **Error types** by what the item practises (vocabulary, grammar, function, pronunciation,
  comprehension — from the memory-item ids). `error_norms` is always null: norms need answers
  from many learners and there are none yet, so none are shown (§9.3).
* **Vocabulary**: known lexemes overall and of the level, and the coverage *estimate*.
* **Fluency**: what was measured (seconds per answer per paper) beside the level's reading and
  speech-rate targets from docs/06; the speech rate itself is null until recorded speech is
  scored (R15).
* **Work on**: at most five targets, the most often wrong first (then the larger share wrong,
  then the earliest in the syllabus), each with its label and the first unit that teaches it.
  Story comprehension is not a target to drill and is left out.
* **Timeline**: units not yet completed up to the end of the next level, at the pace of the
  last four weeks (units completed a week); null with `no_pace` when there is no pace yet, and
  `top_level` after C2. Never a prediction of an external exam band.

### 14.8 "Checked, not estimated" is now true — Decided
The app says, after a memory check, that the coverage figure is checked rather than estimated;
the server answered `audited: false` always. It now answers `true` on `GET /v1/progress` and
`GET /v1/garden/summary` while a memory check finished within the last 35 days (the checks are
28 days apart): what counts as *known* has then been tested against recall, not only predicted.
The percentage of everyday English those words cover stays an estimate and says so.

### 14.9 Section checkpoints are not built — Needs ruling (R18)
docs/12 §3's section checkpoint is a miniature level exam that **gates** the next section, with
a writing and a speaking task, two attempts 48 hours apart and a remediation plan before a
third. Its speaking task cannot be scored until a speech provider exists (R15), so a gate built
now could never be passed — every learner would stop at the end of Section 1. Nothing is locked
instead: the level exam (§9.4, with the report of §14.7) remains the formal check, and the
unit test-out stays free and unlimited. R18 asks whether to wait for R15 or to accept a
self-assessed speaking part for the gate; the immersion volume it also requires (docs/06 §7.2)
is not yet measured on the server either.

### 14.10 Review of §14 — fixed (2026-10-09)
An independent review of this section's code found these; each is fixed and tested.

* **A sign-in in flight could outlive a reset.** Sign-in verifies the password between two
  transactions; a reset committing in that gap left the new session unrevoked, and a rehash
  (after Argon2 parameters rise) could write the *old* password back. Sign-in, reset, change
  and a new reset link now take a lock on the learner's row, and sign-in starts a session only
  for the hash it verified (a change likewise only replaces the hash it verified). The same lock
  stops two simultaneous forgot requests from both leaving a working link.
* **The email address itself was accepted** as a new password at reset and change (registration
  refused it): a password containing the whole address is now refused as `context`.
* **Cookie tossing.** `__Secure-` allows a `Domain`, so a sibling host on the same site could
  plant its own refresh cookie (and the server reads the last one). The cookie is now
  `__Host-lep_refresh` (no `Domain`, `Path=/`); only `/refresh` and `/logout` read it.
* **Several tabs share the cookie**, and two refreshing at once trip reuse detection. That is
  the §2.6 policy (R13 is the grace-window question), not a server defect: the web client must
  serialise refreshes across tabs (the frontend's F8 work does).
* **Config:** in prod the reset link must be https — a custom scheme can be claimed by any app
  on the device (and the app's scheme is `lep`, not the `learnenglish` the README named);
  `LEP_SMTP_USERNAME` and `LEP_SMTP_PASSWORD` come together or not at all; with the web cookie
  on in prod, every CORS origin must be https.
* **The data export** (`GET /v1/me/export`) leaves reset links out, as it leaves out sessions and
  refresh tokens: they are credentials' bookkeeping, not the learner's learning data.
* **Found running the web build end to end** (frontend DECISIONS §27): nothing on the server; the
  browser confirmed the cookie flow and the reset letter work as designed.

## 15. Opt-in weekly leagues (docs/16 E23) — 2026-10-10

Brief Phase 6 lists "cohorts, opt-in leagues"; neither was built, and this record did not say
so. Leagues are built now; cohorts are §15.6.

### 15.1 Off by default, adults only, joined only by the learner — Decided
`PATCH /v1/me/settings {leagues_opt_in: true}` is the only way in. It is refused with 403
`leagues_not_for_minors` for a learner who might be under 18 (docs/10 §8.8, the same reading of
the birth year as §2.4), and with 409 `display_name_required` without a display name — the
others in a group see it. The name may come in the same request: `display_name`, 2–24
characters of letters (any script, Uzbek's ʻ and ʼ included), digits, spaces, `_`, `-` and `'`,
NFKC-normalised; no `@`, no dot, no control or direction-override character
(`app.domain.display_names`). It cannot be removed while the learner is in leagues. A row in a
group carries the display name and weekly XP only — never an id, email, level or streak.

### 15.2 The week — Decided
Every week ends at the same stated instant: **Sunday 20:00 in Tashkent** (15:00 UTC; Tashkent
has no daylight saving, so a week is exactly seven days). A learner joins a group of their tier
when they first earn XP that counts in the week — so a group holds learners who are learning
this week, never idle names — and not while their streak is paused. Only XP that is not a
re-grind counts (docs/16 E23: "only novelty 1.0 XP"), read from `xp_events` by the event's
time.

### 15.3 Groups — Decided (one reading recorded)
docs/16 E23: groups of 30 "matched by the previous week's XP band (±50 %)". Read as: the group
of the tier whose seed (its first member's XP the week before) is within ±50 % of the learner's
own; **if none, the nearest seed with room, rather than a new group** — with few learners at a
tier, strict bands would leave most of them racing alone, and a group of one is not a race. A
new group starts only when every group of the tier is full. The open groups of a tier are
locked in one order while a learner joins, so two learners cannot both take the 30th place.

### 15.4 Settlement — Decided
Ranked by weekly XP, ties to whoever joined first. The top 7 move up (none above tier 10, and
only with some XP); from tier 3 the bottom 5 move down, but never a place in the top 7 of a
small group (a group of 10 sends 3 down); tiers 1 and 2 never move down. A learner whose streak
is paused on the week's last day keeps their place and does not move. A week is settled once,
under its league's row lock, by the Sunday job (`lep.leagues.settle`, 15:02 UTC) or by the first
member who asks after it ended — whichever is first; XP synced after that is not counted.
Settlement writes the league's own rows; each learner's tier follows on their own next request,
so settling never locks thirty accounts. The result is returned by `GET /v1/leagues/current`
until the app has shown it (`POST /v1/leagues/result-seen`): no push about rank or demotion.

### 15.5 Leaving — Decided
One request (`leagues_opt_in: false`) takes the learner out of this week's group at once; a
settled week stays in their history (`GET /v1/leagues/history`, cursor-paginated) and in the
data export. The tier is kept for four weeks after leaving (docs/16 E23), then starts again at
1; a result still waiting is applied before that is decided.

### 15.6 Cohorts are not built — Needs a measure first
docs/10 §6 and docs/16 E27: cohorts of 20–40 learners with a shared monthly **reading** goal,
on by default. The server does not measure reading (immersion) volume yet — the gap R18 also
names — so a cohort goal could not be counted honestly. Cohorts wait for reading to be recorded
on the server.
