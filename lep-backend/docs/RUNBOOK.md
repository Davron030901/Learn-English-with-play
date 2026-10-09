# Runbook — Learn English with Play backend

What to do, in order, when something needs doing or something is wrong. The README covers
installing, configuring and deploying; DECISIONS.md says why things are the way they are. Every
command here is run from `lep-backend/` with the release's image or virtualenv.

## 1. What runs

| Process | Count | Healthy when | If it is down |
|---|---|---|---|
| API (uvicorn) | any, behind a load balancer | `GET /ready` → 200 | learners cannot sync; the app keeps working offline and queues answers |
| Celery worker | ≥ 1 | consuming the `celery` queue | scheduled clean-ups wait; nothing learner-facing breaks at once |
| Celery beat | **exactly one** | logs `beat: Starting…` once | no scheduled jobs (§4); two beats run every job twice |
| PostgreSQL 16 | primary (+ replicas) | `/ready` | API answers 503; nothing is lost on the device |
| Redis 7 | one | `/ready` | rate limits fail open, except sign-in, registration and account deletion, which fail closed |
| CDN (optional) | — | bundle URLs answer 200 | devices fall back to `/v1/units/…` only if `LEP_CONTENT_CDN_BASE_URL` is unset |
| Claude API (optional) | — | `GET /v1/ai/status` → `available` | chat answers 503 `ai_unavailable`; starts are refunded |

`GET /health` is liveness only (it never touches a dependency): never alert on it alone.

## 2. Releasing

1. **Content first.** If the course changed: `make bundle DIR=var/bundle`, then copy
   `var/bundle/` to the bucket behind `LEP_CONTENT_CDN_BASE_URL` (`Cache-Control: public,
   max-age=31536000, immutable`). Files are named by hash, so this never breaks a running
   release. Point `LEP_CONTENT_DIR` of the new release at the same packed course.
2. **Migrations.** Run the one-shot job: `alembic upgrade head` as `lep_owner`. Migrations
   are additive within a release; a destructive change ships in two releases (stop using,
   then drop).
3. **Roll the API and workers.** Each API pod gets SIGTERM, finishes its in-flight requests
   (`--timeout-graceful-shutdown 25`, pod grace ≥ 30 s), then closes its pools — no write in
   flight is lost (tested: `tests/integration/test_operations.py`). Workers finish their
   current task; `acks_late` requeues a task whose worker is killed.
4. **Verify.** `/ready` is 200 on every pod; `GET /v1/content/bundle` names the new
   `content_version`; the error rate (`http_requests_total{status=~"5.."}`) and p99
   (`http_request_duration_seconds`) are flat for 15 minutes.

### Rolling back
Redeploy the previous image. Its schema is still compatible (step 2); do not run
`alembic downgrade` in production unless the release notes say it is safe. The previous
content bundle is still on the CDN under its own hashes.

## 3. Capacity

Measured with `scripts/loadtest.py` (session open, a 10-answer sync, a single answer and the due
queue, in a loop per virtual learner; see DECISIONS §12.3 for the latest numbers and the
machine). To measure a deployment, raise the rate limits for the source IP, then:

```bash
python -m scripts.loadtest --base-url https://api.example.org --learners 200 --seconds 300
```

The exit status is 1 when the p99 of a session or review endpoint is above 300 ms or any request
failed. Scale API replicas before the p99 reaches 200 ms at peak. Each API process holds
`LEP_DB_POOL_SIZE` + `LEP_DB_MAX_OVERFLOW` connections: keep replicas × that below PostgreSQL's
`max_connections` minus the workers' and migrations' share.

## 4. Scheduled jobs (beat, UTC)

| Job | When | What | If it failed |
|---|---|---|---|
| `lep.auth.purge_expired_sessions` | 03:17 daily | deletes expired refresh sessions and expired password-reset links | harmless for a day; run it by hand |
| `lep.ai.purge_expired_conversations` | 03:23 daily | deletes AI transcripts past 30 days | **retention promise**: run by hand the same day |
| `lep.media.purge_expired_recordings` | 03:29 daily | deletes recordings past `expires_at` (tombstones stay), fails and refunds jobs queued > 1 h | **retention promise**: run by hand the same day |
| `lep.media.seed_assets` | 02:05 daily | records the audio the content needs | idempotent; next run catches up |
| `lep.media.tts_drafts` | hourly at :35 | synthetic drafts for missing audio (skips while no TTS provider) | next run catches up |
| `lep.assessment.bias_audit` | Mondays 04:41 | rater bias by L1 and age band | see §5.6 |

Run a job by hand: `celery -A app.workers.main:celery_app call <task name>`. Expired voice
recordings and transcripts are hidden from learners at once even before the purge runs; the
purge is what deletes them from disk and the database.

## 5. Incidents

### 5.1 API answers 503
1. `/ready` names the failing dependency in its body.
2. **PostgreSQL**: check `pg_stat_activity` for long transactions and lock waits
   (`wait_event_type = 'Lock'`). Review ingest and AI replies take a per-learner advisory lock
   (`review-ingest:<learner>`); a lock held for long means a stuck transaction — terminate it,
   the client retries idempotently. Statement timeout is `LEP_DB_STATEMENT_TIMEOUT_MS`.
3. **Pool exhaustion** (`pool timeout` in logs, 503 with `dependency_unavailable`): scale
   replicas or raise `LEP_DB_POOL_SIZE` within PostgreSQL's connection budget (§3).
4. Devices keep every answer in their outbox and replay it with true timestamps on reconnect:
   an outage loses no learning data. Nothing needs replaying by hand.

### 5.2 Redis is down
Rate limits fail open (per-IP and per-account) so learning continues; sign-in, registration and
account deletion fail closed (they answer 503) because their limits are the brute-force guard.
The Celery broker is down too: scheduled jobs wait. Restore Redis; nothing needs replaying.

### 5.3 The AI partner fails
* `ai_unavailable` spikes: the provider is down or rate-limited. Learners see a kind message;
  starts are refunded; a turn can be retried. Nothing to do unless it lasts — then unset
  `LEP_AI_API_KEY` to hide the feature (`/v1/ai/status` → unavailable) until it recovers.
* `ai_bad_request` / `ai_api_error` in logs: our request is wrong or the key is bad (401),
  the account is out of credit (400) or the model is retired (404). Starts are refunded. Fix the
  key or `LEP_AI_MODEL` and redeploy.
* `ai_unparseable` / `ai_refusal` rising: the model is declining or breaking the schema; the safe
  line is shown. Check the prompt version (`partner-…`) of the affected conversations.
* Cost: `ai_usage_daily` holds tokens per learner per day; the published ceiling
  (`LEP_AI_DAILY_TOKEN_BUDGET`) is enforced on every call.

### 5.4 A content release is wrong
Redeploy the previous release (§2, rolling back). Devices keep cached units whose hash is
unchanged and re-download only what differs. Answers given against the bad content are graded
by the server against the content it had, and stay in the log; replay (§6) re-derives state.

### 5.5 Sign-in abuse or a leaked signing key
* Abuse: lower `LEP_RATE_LIMIT_LOGIN_*` and redeploy; the per-email limit holds across IPs.
* Leaked `LEP_JWT_SECRET`: set the new key as `LEP_JWT_SECRET` and the old one as
  `LEP_JWT_PREVIOUS_SECRET`, redeploy; after one access-token lifetime (15 min), remove the
  previous key and redeploy again. If the key was used maliciously, delete all rows of
  `auth_sessions` instead: every learner signs in again; no learning data is touched.

### 5.5a Password-reset letters do not arrive
* `mail_events_total{kind="password_reset",outcome="failed"}` rising, with
  `password_reset_mail_failed` in the logs (the relay's error type, never the address): the
  relay refused or could not be reached. Check `LEP_SMTP_*` and the relay's status; the
  learner's link was stored and simply asks again — a newer request voids the old link.
* `outcome="no_account"` is normal: a request for an address with no active account.
* A learner says the link "does not work": links last `LEP_PASSWORD_RESET_TTL_S` (30 min) and
  work once; a second request voids the first. Ask them to request one more and use the newest.
* Abuse (many requests): the per-address limit (`LEP_RATE_LIMIT_PASSWORD_RESET_ACCOUNT_PER_HOUR`)
  holds across IPs; lower the per-IP one if needed. Every answer is 202 whatever the address,
  so an attacker learns nothing from it.
* `password_screen_total{outcome="lookup_failed"}` rising: Have I Been Pwned is unreachable;
  new passwords are still screened by the built-in list (it fails open by design).

### 5.6 Rater bias alert (`rater_bias_alert` in logs)
A machine rater's mean band differs by more than 0.3 between L1 or age groups. Machine scores
are formative only until a calibration says otherwise (DECISIONS §9.3): remove that rater
version's rows from `rater_calibrations` so its scores stop certifying, and tell the rating
team. Scores already certified are listed by `rater_version` in `rubric_scores` for re-audit.

### 5.7 A learner's memory state looks wrong
`make replay LEARNER=<uuid>` re-derives every memory item from the review log and reports
drift (exit 0 = none). `make replay LEARNER=<uuid> WRITE=1` repairs it. The log is append-only
in the database; never edit it.

## 6. Data requests

| Request | How | Notes |
|---|---|---|
| Export | the learner: `GET /v1/me/export` | every row they own, recordings included; secrets left out |
| Delete recordings | the learner: `DELETE /v1/me/recordings`, or withdraw voice consent | tombstones keep id, time and reason only |
| Delete account | the learner: `POST /v1/me/delete` with their password | erases everything that cascades; review tables allow it only inside the erasure transaction |
| Delete for a learner who cannot sign in | as `lep_owner`: `BEGIN; SET LOCAL lep.erasure = 'on'; DELETE FROM learners WHERE id = '<uuid>'; COMMIT;` — recordings and transcripts are rows and go with it | no tombstones are written this way: record who asked and when, outside the database |

Backups: voice recordings and AI transcripts are rows in PostgreSQL, so point-in-time
recovery keeps **at most 30 days**: a deleted recording or transcript is then gone from backups
within the promised period. `LEP_MEDIA_DIR` holds course audio only (human masters and synthetic
drafts) — back it up like content.

## 7. Checks after any incident

* `/ready` is 200 everywhere; error rate and p99 are back to their baseline.
* Beat is running exactly once (one `beat: Starting…` per deploy).
* The day's purges ran (`*_purged` log lines with counts, or run them by hand, §4).
* Write down what happened, what the learners saw, and what changes — in DECISIONS.md when it
  changes how the system behaves.
