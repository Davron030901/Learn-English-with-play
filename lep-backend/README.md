# Learn English with Play — backend

The server for a gamified CEFR A1→C2 English course for Uzbek- and Russian-speaking
learners: FastAPI, PostgreSQL 16, Redis 7 and Celery on Python 3.12.

**Status: Phases 1–8 are built; the speech and voice providers are ports awaiting a choice.**
Identity and auth, the content service (168 units, 37,173 items), the FSRS-6 scheduler and
shared grader, the append-only review pipeline with offline sync and replay, coverage-first
progress, the Word Garden, XP, streaks, quests and the cosmetic shop, unit test-out and
placement, composed sessions with tier gates, level exams, rubric scoring with the κ gate, the
four-condition level award, appeals and audits, and the optional AI conversation partner. Phase 8 adds
the audio-asset register and TTS draft pipeline, voice recordings with consent, asynchronous
pronunciation and speaking scoring, audio QC, and the data controls (export, delete). Still
open: a TTS and a speech provider adapter, load testing and the runbook (Phase 9).
[DECISIONS.md](DECISIONS.md) records every assumption and the rulings still needed;
[docs/ERD.md](docs/ERD.md) has the data model for all phases.

---

## Quick start with Docker

```bash
make secrets                 # random passwords and keys in ./.secrets (git-ignored)
docker compose up --build    # postgres, redis → migrate → api, worker, beat, demo
curl -s localhost:8000/ready # {"status":"ready","checks":{"postgres":"ok","redis":"ok"}}
```

The packed course (`../Claude outputs/new-in-tashkent/data`) is mounted read-only into the
API, worker and beat; it is a separate artefact, not part of the image.

**Demo learner.** The one-shot `demo` service creates `demo@learn-english.example` (password
in `./.secrets/lep_demo_password`) through the API itself: parts of Unit 1 practised nine days
ago (so reviews are due today), the first lesson of Unit 2 played, and Unit 1 tested out. It
does nothing when the account exists, and refuses to run with `LEP_ENV=prod`. Without Docker:
`LEP_DEMO_PASSWORD=… make demo`.

Interactive docs: <http://localhost:8000/docs> (not served when `LEP_ENV=prod`).

```bash
# create an account (returns the learner and a token pair)
curl -s localhost:8000/v1/auth/register -H 'content-type: application/json' -d '{
  "email": "learner@example.com", "password": "correct horse battery staple",
  "l1": "uz", "birth_year": 2000, "tz": "Asia/Tashkent"}'

# sign in: OAuth 2.0 password grant, form-encoded
curl -s localhost:8000/v1/auth/login \
  -d grant_type=password -d username=learner@example.com -d 'password=correct horse battery staple'

curl -s localhost:8000/v1/me -H "Authorization: Bearer $ACCESS_TOKEN"
```

`make down ARGS=-v` stops the stack and deletes its volumes. The secrets in `./.secrets`
are never regenerated, because the database volume was initialised with them; delete
both together to start over.

## Local development without Docker

```bash
make install                        # uv sync --frozen: .venv with runtime + dev deps
cp .env.example .env                # fill in; nothing reads .env automatically
set -a; source .env; set +a
make migrate                        # as LEP_DB_MIGRATOR_USER
make run                            # uvicorn with reload
make worker                         # Celery worker with beat embedded (dev only)
```

The API connects as a role that can read and write rows but cannot change the schema
(see *Database roles*). To create one on a local server:

```sql
CREATE ROLE lep_app_rw NOLOGIN;
CREATE ROLE lep_app LOGIN PASSWORD '…' IN ROLE lep_app_rw;
```

## Tests and checks

| Command | What it runs |
|---|---|
| `make test-unit` | unit tests — no Docker, no services |
| `make test` | everything, with coverage |
| `make lint` | `ruff check`, `black --check`, `mypy --strict` over app, migrations, tests and scripts |

Integration tests run against real PostgreSQL 16 and Redis 7 and never mock the
database. They get them in one of two ways:

1. **testcontainers** (default): Docker starts `postgres:16-alpine` and `redis:7-alpine`.
2. **Existing services**: set `LEP_TEST_PG_HOST`, `LEP_TEST_PG_PORT`, `LEP_TEST_PG_USER`
   (a superuser), `LEP_TEST_PG_PASSWORD`, `LEP_TEST_REDIS_HOST`, `LEP_TEST_REDIS_PORT`
   and `LEP_TEST_REDIS_PASSWORD` — for CI service containers, or wherever Docker cannot
   pull images. Each run creates and drops its own database and login role, and uses
   Redis databases 14 and 15.

With neither available, integration tests **fail** with instructions; they never skip.
The app under test connects as a role that is only a member of `lep_app_rw`, so the
suite also proves the API works with production privileges.

**Load test** (Phase 9). `tests/integration/test_operations.py` always checks graceful
shutdown on a real uvicorn server and the number of SQL round trips per hot-path request. The
latency test itself is opt-in, because it measures the machine as much as the code: it starts
the API in its own process and drives it with `scripts/loadtest.py`.

```bash
LEP_LOAD=1 LEP_LOAD_LEARNERS=50 LEP_LOAD_SECONDS=60 uv run pytest tests/integration/test_operations.py -k hot_path -s
```

`LEP_LOAD_WORKERS` sets uvicorn workers, `LEP_LOAD_P99_MS` the bar (300) and
`LEP_LOAD_REPORT` a file for the JSON report. Against a deployment, run the script directly
(docs/RUNBOOK.md §3).

## Migrations

```bash
make migrate                      # alembic upgrade head
make downgrade                    # one step back
make revision m="add review_log"  # new migration file
uv run alembic upgrade head --sql # print the SQL instead of running it
```

* Alembic connects as the **schema owner** (`LEP_DB_MIGRATOR_USER`), never as the API's
  role. Each migration runs in its own transaction with `lock_timeout = 5s`, so a
  migration that cannot get its lock fails fast instead of queueing behind live traffic.
* **Every migration that creates a table must grant it to `lep_app_rw`** (see
  `0001_identity_baseline`). Otherwise the API cannot read it, and the integration
  tests fail because they connect with those privileges.
* `tests/integration/test_schema.py` checks that the migrations produce exactly the
  schema the models describe, and that `downgrade base` followed by `upgrade head` works.

## Deploying

One image serves every process; the command chooses the role.

| Process | Command | Replicas |
|---|---|---|
| migrations | `alembic upgrade head` | a one-shot job before each release |
| API | default `CMD` (uvicorn, port 8000) | any |
| worker | `celery --quiet -A app.workers.main:celery_app worker --loglevel=INFO` | any |
| beat | `celery --quiet -A app.workers.main:celery_app beat --loglevel=INFO` | **exactly one** |

`--quiet` drops Celery's start-up banner, so the output stays one JSON object per line.

* **Probes.** `GET /health` is liveness: it never touches a dependency, so a database
  outage does not trigger restarts. `GET /ready` is readiness: it answers 503 when
  PostgreSQL or Redis does not respond within 2 s.
* **Shutdown.** On SIGTERM, uvicorn stops accepting connections, finishes in-flight
  requests (`--timeout-graceful-shutdown 25`), then closes the pools. Give the pod at
  least 30 s (`terminationGracePeriodSeconds`). Celery finishes its current task on
  SIGTERM, and `acks_late` requeues a task whose worker is killed.
* **Behind a proxy.** Set `FORWARDED_ALLOW_IPS` to the proxy's addresses so
  `X-Forwarded-For` is trusted from it — and only from it — for client IPs (rate limits,
  logs).
* **Secrets.** Mount them as files in `/run/secrets` (`LEP_SECRETS_DIR`), named after
  the variable in lower case (`lep_jwt_secret`), or pass them as environment variables.
* **Production guards.** With `LEP_ENV=prod`, the process refuses to start if the
  database connection is not TLS (`require` or `verify-full`), if Redis has no
  password, or if the Argon2id parameters are below the OWASP minimum.
* **Database roles.** Provision once per database (`deploy/postgres/init/10-roles.sql`
  does the same for Compose):

  ```sql
  CREATE ROLE lep_owner LOGIN PASSWORD '…';                   -- runs migrations
  CREATE DATABASE lep OWNER lep_owner;                        -- owns the schema
  CREATE ROLE lep_app_rw NOLOGIN;                             -- privileges come from migrations
  CREATE ROLE lep_app LOGIN PASSWORD '…' IN ROLE lep_app_rw;  -- the API and workers
  ```

  `lep_owner` needs no superuser rights: `citext` is a trusted extension, which a
  database owner may install.

* **Observability.** JSON logs go to stdout, one object per line. Every line emitted
  while a request is handled carries its `request_id` (process start-up and shut-down
  lines have none). Metrics are at `GET /metrics`; set `LEP_METRICS_TOKEN` if that path
  is reachable from outside the cluster. Tracing starts when
  `LEP_OTEL_EXPORTER_OTLP_ENDPOINT` is set, and log lines then also carry `trace_id`.
* **Scaling.** Run one uvicorn process per container and scale with replicas. Metrics
  are per process, which is what Prometheus expects.

## API (Phase 1)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | liveness |
| `GET` | `/ready` | readiness: PostgreSQL and Redis |
| `GET` | `/metrics` | Prometheus (optional bearer token) |
| `POST` | `/v1/auth/register` | create an account and sign in (201, `Location: /v1/me`) |
| `POST` | `/v1/auth/login` | OAuth 2.0 password grant, form-encoded → token pair |
| `POST` | `/v1/auth/refresh` | rotate: refresh token → new token pair |
| `POST` | `/v1/auth/logout` | end the session that owns a refresh token (204) |
| `POST` | `/v1/auth/password/forgot` | email a link to set a new password (202, the same answer for any address) |
| `POST` | `/v1/auth/password/reset` | set a new password from the link; every session ends (204) |
| `GET` | `/v1/me` | the signed-in learner's profile and settings |
| `POST` | `/v1/me/password` | change the password; other devices are signed out (204) |
| `GET` | `/v1/capabilities` | which optional features this server has configured (public, cached 5 min) |
| `POST` | `/v1/client-events` | count events only the device sees (an allow-list; nothing personal) |

Every later phase's endpoints are in [openapi.json](openapi.json) — among them the offline
pair: `GET /v1/content/bundle?since=` (public: every content file with its SHA-256 and URL, or
nothing when the device is current) and `GET /v1/sync/bundle?since=` (the next five units and
the reviews due in the next seven days), with `POST /v1/sync/reviews` to replay the outbox.
`make bundle` writes the content files under immutable, hash-named paths for a CDN.

The contract is in [openapi.json](openapi.json); `make openapi` regenerates it, and a
unit test fails when the committed copy is stale. Operations: [docs/RUNBOOK.md](docs/RUNBOOK.md).

* **Errors** are RFC 9457 problem documents (`application/problem+json`) with a stable
  `type` slug — `validation_error`, `email_taken`, `invalid_credentials`,
  `invalid_token`, `session_revoked`, `age_requirement_not_met`, `rate_limited`,
  `payload_too_large`, `dependency_unavailable`, `not_found`, `internal_error`,
  `reset_link_invalid`, `password_reset_unavailable`, `origin_refused` (and each later
  phase's own, in the OpenAPI document) — plus the `request_id`. A problem body never echoes a submitted value, a stack trace or SQL.
* **Request IDs.** Send `X-Request-ID` (8–128 characters from `A–Z a–z 0–9 . _ : -`) to
  set one; otherwise the server generates one. It is returned in the `X-Request-ID`
  header.
* **Tokens.** Access tokens are JWTs valid for 15 minutes. Refresh tokens are opaque,
  valid for 30 days, and replaced on every use. A session lasts at most 90 days however
  often it is refreshed. Presenting a refresh token that has already been used ends the
  whole session, for every holder (reuse detection). Sign-out takes effect immediately,
  because every request checks that the session is still live. With
  `LEP_WEB_REFRESH_COOKIE=true`, a web client that sends `X-LEP-Token-Transport: cookie`
  gets its refresh token as an `httpOnly`, `Secure`, `SameSite=Strict` `__Host-` cookie
  instead of in the body (DECISIONS §14.4); every tab shares it, so the web client serialises
  refreshes across tabs.
* **New passwords** — at registration, reset and change — are refused when they are common,
  a simple pattern, built from the email or the app's name, or (with `LEP_HIBP_ENABLED`)
  found in Have I Been Pwned's breach corpus (k-anonymity: five hex digits of the SHA-1
  leave the server).

## Configuration

Environment variables, prefixed `LEP_`. A secret may instead be a file in
`LEP_SECRETS_DIR`. Loading fails at start-up, and exits with status 78, if a required
value is missing or invalid; the error names the variable and never prints its value.
Nothing reads `.env` automatically.

**All processes**

| Variable | Default | Meaning |
|---|---|---|
| `LEP_ENV` | *required* | `dev`, `test` or `prod`. `prod` enforces TLS to the database, a Redis password and Argon2 minimums; it also turns on HSTS and turns off `/docs` |
| `LEP_SERVICE_NAME` | `lep-backend` | the `service` field in logs, PostgreSQL `application_name`, the tracing service name |
| `LEP_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING` or `ERROR` |
| `LEP_LOG_JSON` | `true` | `false` prints human-readable lines for local development |
| `LEP_OTEL_EXPORTER_OTLP_ENDPOINT` | unset | OTLP/HTTP collector base URL, e.g. `http://otel-collector:4318`; tracing is off when unset |
| `LEP_OTEL_SAMPLE_RATIO` | `0.05` | fraction of traces sampled (parent-based) |
| `LEP_SECRETS_DIR` | `/run/secrets` | directory of secret files |
| `LEP_CONTENT_DIR` | `../Claude outputs/new-in-tashkent/data` (repo-relative) | the packed course (`index.json`, `u001.json` … `u168.json`) the API and worker load at start-up; malformed content stops start-up |
| `LEP_CONTENT_CDN_BASE_URL` | unset | https base where `scripts/export_bundle.py` output is published; the bundle manifests (`/v1/content/bundle`, `/v1/sync/bundle`) then point there (immutable files named by hash) instead of at `/v1/course` and `/v1/units` |

**Database** (the API and worker use `LEP_DB_USER`; migrations use `LEP_DB_MIGRATOR_USER`)

| Variable | Default | Meaning |
|---|---|---|
| `LEP_DB_HOST` | *required* | PostgreSQL host |
| `LEP_DB_PORT` | `5432` | |
| `LEP_DB_NAME` | *required* | database name |
| `LEP_DB_SSL_MODE` | `require` | `disable`, `prefer`, `require` or `verify-full` |
| `LEP_DB_CONNECT_TIMEOUT_S` | `5` | connection timeout |
| `LEP_DB_STATEMENT_TIMEOUT_MS` | `5000` | server-side `statement_timeout` for the API and workers (migrations run without one) |
| `LEP_DB_POOL_SIZE` | `10` | pooled connections per API process |
| `LEP_DB_MAX_OVERFLOW` | `5` | extra connections allowed under a burst |
| `LEP_DB_POOL_TIMEOUT_S` | `5` | wait for a free pooled connection before answering 503 |
| `LEP_DB_USER` | *required* | runtime login role, a member of `lep_app_rw` |
| `LEP_DB_PASSWORD` | *required*, secret | |
| `LEP_DB_MIGRATOR_USER` | *required for migrations* | the schema owner |
| `LEP_DB_MIGRATOR_PASSWORD` | *required for migrations*, secret | |

**Redis** (the API and worker)

| Variable | Default | Meaning |
|---|---|---|
| `LEP_REDIS_HOST` | *required* | Redis host |
| `LEP_REDIS_PORT` | `6379` | |
| `LEP_REDIS_DB` | `0` | database for rate limits and caches |
| `LEP_REDIS_PASSWORD` | unset, secret | required when `LEP_ENV=prod` |
| `LEP_REDIS_SSL` | `false` | TLS (`rediss://`) |
| `LEP_REDIS_SOCKET_TIMEOUT_S` | `1` | per-command timeout |
| `LEP_REDIS_CONNECT_TIMEOUT_S` | `1` | connection timeout |
| `LEP_REDIS_MAX_CONNECTIONS` | `64` | pool ceiling per process |
| `LEP_CELERY_BROKER_DB` | `1` | database for the Celery queues; must differ from `LEP_REDIS_DB` |

**API**

| Variable | Default | Meaning |
|---|---|---|
| `LEP_CORS_ORIGINS` | empty | comma-separated browser origins; empty turns CORS off (mobile clients do not need it); `*` is refused |
| `LEP_MAX_BODY_BYTES` | `1048576` | larger request bodies get 413 |
| `LEP_DOCS_ENABLED` | on except in `prod` | serve `/docs` and `/openapi.json` |
| `LEP_METRICS_TOKEN` | unset, secret | when set, `/metrics` requires `Authorization: Bearer <token>` |
| `LEP_JWT_SECRET` | *required*, secret | access-token signing key, at least 32 random bytes |
| `LEP_JWT_PREVIOUS_SECRET` | unset, secret | the previous key, still accepted during a rotation |
| `LEP_JWT_ISSUER` | `lep-backend` | `iss` claim |
| `LEP_JWT_AUDIENCE` | `lep-api` | `aud` claim |
| `LEP_ACCESS_TOKEN_TTL_S` | `900` | access-token lifetime (60–3600) |
| `LEP_REFRESH_TOKEN_TTL_S` | `2592000` | refresh-token lifetime (30 days) |
| `LEP_SESSION_MAX_AGE_S` | `7776000` | absolute session lifetime (90 days) |
| `LEP_ARGON2_TIME_COST` | `2` | Argon2id iterations (at least 2 outside tests) |
| `LEP_ARGON2_MEMORY_KIB` | `19456` | Argon2id memory in KiB (at least 19456 outside tests) |
| `LEP_ARGON2_PARALLELISM` | `1` | Argon2id lanes |
| `LEP_PASSWORD_HASH_CONCURRENCY` | `4` | hashes computed at once per process (bounds memory) |
| `LEP_RATE_LIMIT_IP_PER_MINUTE` | `300` | every `/v1` request, per client IP; fails open |
| `LEP_RATE_LIMIT_ACCOUNT_PER_MINUTE` | `600` | authenticated requests, per learner; fails open |
| `LEP_RATE_LIMIT_LOGIN_IP_PER_MINUTE` | `20` | sign-in attempts per IP; fails closed |
| `LEP_RATE_LIMIT_LOGIN_ACCOUNT_PER_15MIN` | `10` | sign-in attempts per email, from any IP; fails closed |
| `LEP_RATE_LIMIT_REGISTER_IP_PER_HOUR` | `20` | registrations per IP; fails closed |
| `LEP_RATE_LIMIT_REFRESH_PER_MINUTE` | `30` | refreshes and sign-outs per IP; fails open (DECISIONS §2.7: a refresh token cannot be guessed, and failing closed would sign everyone out) |
| `LEP_RATE_LIMIT_PASSWORD_RESET_IP_PER_HOUR` | `10` | reset-link requests per IP; fails closed |
| `LEP_RATE_LIMIT_PASSWORD_RESET_ACCOUNT_PER_HOUR` | `3` | reset-link requests per address, from any IP; fails closed |
| `LEP_RATE_LIMIT_CLIENT_EVENTS_IP_PER_MINUTE` | `30` | `POST /v1/client-events` batches per IP; fails open |
| `LEP_HIBP_ENABLED` | `false` | also screen new passwords against Have I Been Pwned's range API (fails open, counted) |
| `LEP_HIBP_TIMEOUT_S` | `2` | timeout of that lookup |
| `LEP_WEB_REFRESH_COOKIE` | `false` | give web clients their refresh token as an `httpOnly` cookie; turns on CORS credentials for `LEP_CORS_ORIGINS`. Only when the web app and the API share a site |
| `LEP_SUPPORTED_L1` | `uz,ru` | first languages accepted at registration (language tags) |
| `FORWARDED_ALLOW_IPS` | `127.0.0.1` | read by uvicorn: proxies trusted to set `X-Forwarded-For` |

**Audio and speech** (providers are server-side only; with `none` the feature answers 503 and stores nothing)

| Variable | Default | Meaning |
|---|---|---|
| `LEP_MEDIA_DIR` | `var/media` | where audio files (synthetic drafts, cached speech, recordings' masters) are kept |
| `LEP_TTS_PROVIDER` | `none` | the synthetic voice for drafts and `POST /v1/media/tts`; no adapter is wired yet |
| `LEP_SPEECH_PROVIDER` | `none` | alignment + GOP + independent ASR for `POST /v1/media/speech`; no adapter is wired yet |
| `LEP_TTS_CHARS_PER_DAY` | `4000` | synthesised characters per learner per day; uniform, never sold |
| `LEP_SPEECH_SECONDS_PER_DAY` | `900` | seconds of speech scored per learner per day; uniform, never sold |
| `LEP_VOICE_RETENTION_DAYS` | `30` | recordings are deleted after this (at most 30, docs/11 §10), daily at 03:29 UTC |
| `LEP_MAX_RECORDING_SECONDS` | `90` | longest accepted recording |

**Email** (only for password-reset links; with `none` the feature answers 503 and the app shows how to get help instead)

| Variable | Default | Meaning |
|---|---|---|
| `LEP_MAIL_BACKEND` | `none` | `smtp` (any relay or provider), `file` (writes `.eml` files; local and test stacks only) or `none` |
| `LEP_MAIL_FROM` | unset | the From header, e.g. `Learn English <no-reply@example.org>`; required with a backend |
| `LEP_MAIL_OUTBOX_DIR` | `var/mail` | where the `file` backend writes |
| `LEP_SMTP_HOST` | unset | the relay; required with `smtp` |
| `LEP_SMTP_PORT` | `587` | |
| `LEP_SMTP_USERNAME` | unset | |
| `LEP_SMTP_PASSWORD` | unset, secret | |
| `LEP_SMTP_TLS` | `starttls` | `starttls`, `ssl` (implicit, port 465) or `none` (a local catcher; refused in prod) |
| `LEP_SMTP_TIMEOUT_S` | `10` | |
| `LEP_PASSWORD_RESET_URL` | unset | the page that sets a new password; the token is appended as `?token=`. `https://` in prod (a custom scheme can be claimed by any app); the app's own `lep://reset-password` is accepted elsewhere |
| `LEP_PASSWORD_RESET_TTL_S` | `1800` | how long a link works (5–60 minutes); a link works once |

**AI conversation partner** (optional — every learning path works without it; `GET /v1/ai/status` reports `available: false` and the app hides the feature)

| Variable | Default | Meaning |
|---|---|---|
| `LEP_AI_API_KEY` | unset, secret | Claude API key; the feature exists only when this is set. It is used by the server alone and never reaches a client |
| `LEP_AI_MODEL` | `claude-opus-5-5` | model id |
| `LEP_AI_EFFORT` | `low` | `low`, `medium` or `high` (`output_config.effort`); short in-character replies need little thinking |
| `LEP_AI_FALLBACKS` | `true` | server-side refusal fallback (`fallbacks: "default"`) |
| `LEP_AI_TIMEOUT_S` | `45` | per-request timeout to the provider |
| `LEP_AI_DAILY_CONVERSATIONS` | `5` | conversations a learner can start per learner-local day; uniform, never sold |
| `LEP_AI_MAX_TURNS` | `12` | learner turns per conversation |
| `LEP_AI_DAILY_TOKEN_BUDGET` | `400000` | model tokens (input + output) per learner per day; past it, new turns are refused until tomorrow |
| `LEP_AI_RETENTION_DAYS` | `30` | conversations and their turns are deleted after this long (daily worker job) |

**Worker**

| Variable | Default | Meaning |
|---|---|---|
| `LEP_CELERY_TASK_TIME_LIMIT_S` | `600` | hard task time limit; the soft limit is 30 s earlier |
| `LEP_AUTH_SESSION_RETENTION_DAYS` | `30` | ended sessions, expired refresh tokens and expired reset links are deleted after this long (daily at 03:17 UTC) |

Rate limits are token buckets: the number is the burst size, refilled evenly over the
window. "Fails open" means the request goes through if Redis is unreachable; "fails
closed" means it gets 503, so an outage cannot open the door to password guessing.

## Project layout

```
app/
  main.py             app factory, lifespan, middleware order, OpenAPI post-processing
  config.py           Settings / WorkerSettings / MigrationSettings, fail-fast loading
  container.py        process-wide clients built at start-up
  deps.py             FastAPI dependencies: session, services, rate limits, caller
  errors.py           domain errors → RFC 9457 problems; dependency-failure detection
  db.py  redis_client.py  clock.py  ids.py (UUIDv7)
  middleware/         request context (id, logs, metrics, body limit, 500/503), headers
  observability/      JSON logging, Prometheus metrics, OpenTelemetry
  security/           Argon2id, tokens, Redis token-bucket rate limiter
  domain/             pure logic, no I/O (age policy now; FSRS, grading, mastery in Phase 3)
  models/  repositories/  services/  schemas/  api/
  workers/            Celery factory, entry point, tasks
migrations/           Alembic (async), one migration per change
deploy/postgres/init/ role provisioning for the Compose database
scripts/              secrets for Compose, OpenAPI export
tests/unit            no I/O
tests/integration     real PostgreSQL and Redis
```
