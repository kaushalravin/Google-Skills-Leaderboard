## Hard constraints (these override everything below)
1. DO NOT MODIFY these protected files (they were tested against real profiles):
   - server/scraper/webScraper.js (scraper logic and selectors)
   - server/scraper/test.js
   - server/seeds/userSeed.js
   - server/models/users.js, server/models/badges.js, server/models/userBadges.js (core schemas)
   New code may require() and call them, but never edit, rename, move or wrap them in a way that changes their behaviour.
   No new fields on these schemas.
2. No over-engineering: no unnecessary abstractions, wrapper layers or boilerplate. Prefer the simplest correct code.
3. Security (input validation/sanitisation, rate limiting, secure admin auth) and robust error handling are required features.
4. Data integrity: a failed or empty crawl must never delete or corrupt existing participant or badge records. No duplicate participants or badges.

The protected files are byte-identical to commit `34b7e84`. `tests/unit/protected.test.js` enforces this, and `.gitattributes` marks them `-text` so checkout never rewrites line endings. Check with:
`git diff 34b7e84 -- server/scraper server/models/users.js server/models/badges.js server/models/userBadges.js server/seeds` (must be empty).

---

# GDG MIT Google Skills Leaderboard: maintenance guide

The backend crawls participants' public Google Skills profiles every 6 h, stores competition badges, and serves a precomputed leaderboard. It uses CommonJS, Node ≥ 22, Express 5, Mongoose 9, node-cron, zod, pino, helmet and express-rate-limit. The README covers setup, the API, and the go-live checklist.

## Working rules for future sessions
- Re-read this file first.
- Make one change at a time.
- Run the full suite (`npm test` in `server/`) after each change, and keep the protected diff above empty.
- When behaviour changes, update this file, and the README (API reference and the Architecture diagrams).
- Tests never hit the network: inject `scrape`, and use the in-memory MongoDB.
- Never commit secrets, `.env` or participant data. The only committed CSV is `server/data/Accepted Badges.csv`.
- Every bug fix gets a test.
- **Never `require()` `seeds/userSeed.js`**: it runs on load and deletes all users. Check it only with `node --check`.
- Write to the protected models only with `updateOne` / upsert and `$set` / `$setOnInsert`. Never use `save()`, deletes or `syncIndexes`.
- Never call `syncUserBadges` or `scrape` from `scraper/webScraper.js`: the first deletes everything on an empty list, the second is the old crawl loop. Never run that file directly.
- Style: 4-space indent, double quotes, small modules. Comments only for a non-obvious why. Logs are structured JSON with ids, never emails.

## Code map (`server/`)
The diagrams are in the README, under Architecture.
- `index.js`: entry point. Validates env, connects, waits for the schema index builds (`waitForIndexes`, so first requests on a fresh DB can't slip past the unique indexes), reconciles orphaned runs, starts the HTTP server and cron, and handles graceful shutdown.
- `app.js`: Express app. Middleware order and route mounting, with health unthrottled and limiters before auth and body parsing.
- `config/`: `env.js` (zod-validated env, `.env` loading), `timezone.js` (forces TZ=UTC, boot self-check), `db.js`, `logger.js` (pino with redaction).
- `models/`:
  - protected: `users`, `badges`, `userBadges`;
  - ours: `crawlerLog` (`crawler_logs`), `leaderboard` (single snapshot doc `_id: "current"`), `jobLock` (`job_locks`).
- `services/`:
  - `crawl.js`: `crawlAll`, retries and the Retry-After gate, plus the valid-badge rule `selectValidBadges`.
  - `crawlRunner.js`: `startCrawl` (lock → log → crawl → rebuild → release), `activeRuns`, `lastSuccessfulRun`, `reconcileOrphanedRuns`.
  - `lock.js`: `tryAcquire`, `getLockState`.
  - `leaderboard.js`: `rebuildLeaderboard` (serialized) and `getSnapshot`.
  - `ingest.js`: `normalizeProfileUrl` and `ingestParticipants`.
- `routes/`: `admin.js` (crawl, status, logs), `participants.js` (ingestion), `leaderboard.js` (public), `health.js`.
- `middleware/`: `errors.js` (`AppError` + central handler), `validation.js` (zod → 400), `requireAdmin.js`, `security.js` (helmet, CORS, limiters), `requestId.js`.
- `jobs/scheduler.js`: node-cron with `noOverlap`; every tick goes through `startCrawl`.
- `scripts/`: `crawl-once.js` (real crawl via the lock, or `--dry-run`), `check-real.js` (read-only real-DB report, including unique-index health via `listIndexes`).
- `data/Accepted Badges.csv`: the whitelist.
- `tests/unit`, `tests/integration`, `tests/helpers` (`startMongo`, `buildTestApp`, `testConfig`).
- `tests/e2e`: the real server as a child process against an in-memory replica set, with Google replaced by `helpers/fakeGoogle.js` (nock preload driven by a scenario JSON); `helpers/harness.js` gives per-test servers/DBs, crawl and ingest helpers, and integrity checks.
- `../docs/google-form-apps-script.gs`: Google Form → ingestion endpoint.

## Business rules (with the reason for each)
- **Whitelist: 10 skill badges, from `data/Accepted Badges.csv`.** The protected scraper filters scraped badges by this file, and `crawl.js` loads it with the same normalization (trim, collapse spaces, lowercase) for counting. This way old non-whitelisted rows never count.
- **Date rule: the displayed profile date must be on or after `COMPETITION_START_DATE` (2026-10-26), and on or before `COMPETITION_END_DATE` if set.** Profiles show only a calendar date, which is stored as UTC midnight (hence TZ=UTC).
  - Accepted edge: if profiles display US time, badges earned 00:00–09:29 IST on Oct 26 show as Oct 25 and don't count. The profile date is the source of truth.
- **A null date never counts.** The scraper returns `earnedAt: null` when it can't parse a date. Such badges are skipped and logged, never defaulted to "now".
- **Zero-seconds rule: a valid `earnedAt` has zero seconds and milliseconds.** Old code stamped rows with `new Date()`, while real parsed dates are always midnight. Such rows are excluded (never deleted) until a scrape rewrites them, since every successful scrape rewrites `earnedAt`.
- **One count per badge name per user**, matched by normalized name with the earliest date winning. Duplicate Badge docs with the same name must not double-count.
- **Nothing is ever deleted**: not users, badges or userbadges. A crawl only upserts `UserBadge` (unique on user + badge) and `$set`s `user.badgeCount`. `credits` are never touched.
- **`badgeCount` means competition-valid badges**, but the dashboard reads `validBadgeCount` from the API, never the DB.
- **Badge identity:** a Badge is found by exact `name` (oldest doc if duplicates exist), or created from the scraped fields. Creation is serialized per name within a run. On E11000, re-find by name; if there is still none (e.g. a renamed badge colliding on `externalId`), the user fails with `badge_conflict`.
- **Empty result.**
  - It writes nothing, because a sign-in wall or markup change looks exactly like "no badges".
  - If the user had no valid badges, it counts as succeeded (with zero).
  - Otherwise it is an `empty_result` failure, counted in `failed` and `counts.empty`, and it makes the run `partial`: a profile with badges that comes back empty is something to look at.
- **Thrown scrape after retries.** It writes nothing, and the failure is `http_<status>` or the error code. Retries happen only on network errors, 429 and 5xx, with full-jitter backoff. `Retry-After` pauses all workers.
- **Suspicious empty run.** A run is marked `failed` with `error: "suspicious_empty_run"` when it has ≥ `SUSPICIOUS_EMPTY_MIN_USERS` (5) users AND either every scrape that returned was empty, or `empty_result` ≥ `SUSPICIOUS_EMPTY_RATIO` (0.3) of the users who had valid badges before the run.
  - Then there is no rebuild and no new `lastSuccessfulUpdate`.
  - Reason: a block or CAPTCHA must not look like a successful run.
- **Run status**, checked in this order:
  1. `failed` if the run crashed;
  2. `aborted` if the lock was lost or the server shut down;
  3. `failed` if the run was suspicious, or if `total > 0` and nobody succeeded;
  4. `partial` if `failed > 0` (including `empty_result`);
  5. otherwise `success`.

  `lastSuccessfulUpdate` is the `finishedAt` of the latest `success`/`partial` run.
- **Ranking**: `validBadgeCount` desc, then `latestValidBadgeAt` asc (earlier finisher ranks higher).
  - Only an identical (count, date) pair shares a rank (1, 1, 3); display order within a rank is by username.
  - Zero-badge users share the last rank.
- **Snapshot**: rebuilt after every `success`/`partial` run (still holding the lock) and after every ingestion with ≥ 1 write. Ingestion keeps the existing `lastSuccessfulUpdate` and never fakes a crawl time.
  - Rebuilds run one at a time in the process, so an older rebuild can't overwrite a newer one.
  - A failed run leaves the old snapshot.
- **Ingestion identity**: `skillsUrl` is canonical `https://www.skills.google/public_profiles/<id>` (the seed's form, id case preserved).
  - http, no-www, the `cloudskillsboost.google` host, a trailing slash and a query/hash are accepted. Everything else is rejected (SSRF guard).
  - Dedupe is case-insensitive. An existing user keeps its stored `skillsUrl`; only username and emails are updated.
- **Concurrency**: one crawl at a time via the `job_locks` lease (DB clock, heartbeat every ttl/3, owner-checked release). Run a single app instance: the rate limiter, ingestion queue and rebuild queue are in-process.
- **Orphaned runs**: a `running` log whose process died is marked `failed` / `error: "orphaned"` at boot (unless its lease is still live) and, at the latest, by the next run that takes the lock, since holding the lock proves no other run is alive.

## How to make common changes
- **Change the competition start date**:
  - set `COMPETITION_START_DATE` (and optionally `COMPETITION_END_DATE`) in the env;
  - the next crawl or ingestion rebuild applies it;
  - nothing in the DB changes, because counts are always recomputed.
- **Google renames a badge**:
  - update its title in `data/Accepted Badges.csv` (the protected scraper matches by title);
  - the signal is `badge_conflict` or a sudden drop in counts in `crawler_logs` / `GET /api/admin/crawl/status`;
  - old Badge docs stay; counting is by name;
  - update `tests/unit/protected.test.js` (its expected list) and the README.
- **Add or replace an accepted badge**: edit the CSV (columns `Course Name,Course URL,Type of Course,# of credits required`), then update the expected list in `tests/unit/protected.test.js` and the README's scoring list.
- **Change the crawl schedule or politeness**: use `CRON_SCHEDULE`, `CRON_TIMEZONE`, `CRAWL_CONCURRENCY`, `CRAWL_MIN_GAP_MS` and the retry variables. If you add a new variable, add it to `config/env.js`, `.env.example` (a test checks this file is complete) and the README table.
- **Add an endpoint**:
  1. Put the route in `routes/` and mount it in `app.js`. Admin routes go under `/api/admin` (already rate-limited). A new admin router sets `Cache-Control: no-store` and then uses `requireAdmin`, like `adminRouter` and `participantsRouter`, so even 401s aren't cached.
  2. Validate input with `parse(schema, input)` from `middleware/validation.js`, and throw `AppError` for other errors. Unknown query keys are deliberately ignored (a dashboard's cache-busting `?_=…` must never break a request), and an ingestion batch where every row is rejected is a 422, not a 400.
  3. Never expose `email`/`skillsEmail` publicly.
  4. Update the README API reference, and the diagram if the flow changes.
- **Tests**:
  - `npm test` runs `tests/unit` and `tests/integration` (explicit globs keep the protected `scraper/test.js` out).
  - Use `startMongo()` for an in-memory replica set, `buildTestApp(configOverrides, { crawlDeps: { scrape } })` for the app, and inject `scrape` into `crawlAll` / `startCrawl`.
  - CLI and boot tests spawn real processes with `ENV_FILE=""`.
  - End-to-end scenarios go in `tests/e2e/` (`npm run test:e2e`, kept out of `npm test` because it takes over a minute). Change fake profiles with `setProfiles()`; the fake blocks all other network access.
  - Timing assertions must hold on a loaded machine: compare against what the code guarantees, not against how fast requests usually start.

## Known edges and accepted risks
- **xlsx 0.18.5** has unpatched advisories (prototype pollution, ReDoS on crafted files). It only reads the committed CSV and the organisers' local seed spreadsheet, never uploads.
- **A scrape can't be cancelled mid-request**, because the protected `scrapeProfile` takes no signal. An abort stops new users and all writes after it.
- **Windows can't deliver a catchable SIGTERM to a child process.** `index.js` also accepts an IPC `"shutdown"` message, only when `NODE_ENV=test`, and the shutdown test uses it on win32.
- **A blocked page and "no accepted badges" both come back as `[]`.** Hence the empty-result and suspicious-empty-run rules.
- **`seeds/userSeed.js` deletes all users** before importing. Never run it against the live DB. It is only a one-time initial import.
- **Index builds at boot**: if a unique index can't be built (e.g. duplicates already in the data), the error is logged and the server still starts, without that guarantee. Check the boot logs for `index build failed`; `npm run check:real` reports any missing unique index.
- **`skillsUrl` is indexed twice** in the protected User schema. Mongoose warns about it, and it is harmless.

## Commands (from `server/`)
```bash
npm install
npm start                          # node index.js (TZ forced to UTC in code)
npm run dev                        # node --watch index.js
npm test                           # unit + integration (tests/unit, tests/integration)
npm run test:e2e                   # end-to-end: real server, fake Google (tests/e2e)
npm run crawl:once                 # one real crawl through the lock (exit 2 if one is running)
npm run crawl:once -- --dry-run    # report only; no writes, no lock, no collections
npm run check:real                 # read-only real-DB report (README)
mongodump --uri "$MONGO_URI" --out backup-YYYYMMDD   # before any risky operation
```

## Current status
- Feature-complete: crawl with lock and logs, cron, admin crawl/status/logs, ingestion, leaderboard snapshot and public API, health, security, graceful shutdown.
- Before enabling cron in production, follow the go-live checklist in the README.
- The deployment target (host, process manager, MongoDB plan) is still to be chosen.
