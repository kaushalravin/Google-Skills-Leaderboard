## Hard constraints (these override everything below)
1. DO NOT MODIFY these protected files (they were tested against real profiles):
   - server/scraper/webScraper.js (scraper logic and selectors)
   - server/scraper/test.js
   - server/seeds/userSeed.js
   - server/models/users.js, server/models/badges.js, server/models/userBadges.js (core schemas)
   New code may require() and call them, but never edit, rename, move or wrap them in a way that changes their behaviour.
   No new fields on these schemas.
2. No over-engineering: no unnecessary abstractions, wrapper layers or boilerplate. Prefer the simplest correct code.
3. Security (input validation and sanitisation, rate limiting, secure admin auth) and error handling that never loses data or leaks details are required features.
4. Data integrity: a failed or empty crawl must never delete or corrupt existing participant or badge records. No duplicate participants or badges.

The protected files are byte-identical to commit `34b7e84`. `tests/unit/protected.test.js` enforces this, and `.gitattributes` marks them and the badge CSV `-text` so checkout never rewrites line endings. Check with:
`git diff 34b7e84 -- server/scraper server/models/users.js server/models/badges.js server/models/userBadges.js server/seeds` (must be empty).

---

# GDG on Campus MIT Google Skills leaderboard: maintenance guide

The backend crawls participants' public Google Skills profiles every 6 h, stores competition badges, and serves a precomputed leaderboard. It uses CommonJS, Node ≥ 22, Express 5, Mongoose 9, node-cron, zod, pino, helmet and express-rate-limit. The public site in `client/` uses React 19, Vite, React Router 7, Bootstrap CSS from jsDelivr, and oxlint. The README covers setup, the API, deployment and the go-live checklist.

## Working rules
- Re-read this file first.
- Make one change at a time.
- After server changes run `npm test` in `server/` (and `npm run test:e2e` for crawl, route or boot changes); after client changes run `npm run lint`, `npm test` and `npm run build` in `client/`. Keep the protected diff above empty.
- When behaviour changes, update this file and the README (API reference, Frontend section, Architecture diagrams).
- Tests never hit the network: inject `scrape`, and use the in-memory MongoDB.
- Never commit secrets, `.env` or participant data. The only committed CSV is `server/data/Accepted Badges.csv`.
- Every bug fix gets a test.
- **Never `require()` `seeds/userSeed.js`**: it runs on load and deletes all users. Check it only with `node --check`.
- Write to the protected models only with `updateOne` / upsert and `$set` / `$setOnInsert`. Never use `save()`, deletes or `syncIndexes`.
- Never call `syncUserBadges` or `scrape` from `scraper/webScraper.js`: the first deletes everything on an empty list, the second is the old crawl loop. Never run that file directly.
- Server style: 4-space indent, double quotes, semicolons, small modules. Client style: 2-space indent, single quotes, no semicolons, imports with extensions. Comments only for a non-obvious why. Logs are structured JSON with ids, never emails.

## Code map (`server/`)
The diagrams are in the README, under Architecture.
- `index.js`: entry point. Validates env, connects, waits for the schema index builds (`waitForIndexes`, so first requests on a fresh DB can't slip past the unique indexes), reconciles orphaned runs, starts the HTTP server and cron, and handles graceful shutdown.
- `app.js`: Express app. Middleware order and route mounting, with health unthrottled and limiters before auth and body parsing.
- `config/`: `env.js` (zod-validated env, `.env` loading), `timezone.js` (forces TZ=UTC, boot self-check), `db.js`, `logger.js` (pino with redaction).
- `models/`:
  - protected: `users`, `badges`, `userBadges`;
  - ours: `crawlerLog` (`crawler_logs`), `leaderboard` (single snapshot doc `_id: "current"`, including the internal `crawlRanks`), `jobLock` (`job_locks`).
- `services/`:
  - `crawl.js`: `crawlAll`, retries and the Retry-After gate, the CSV loader (`ACCEPTED_BADGE_NAMES`, `badgeCredits`, `isWhitelisted`), the valid-badge rule `selectValidBadges`, `competitionWindow`, `DAY_MS`.
  - `crawlRunner.js`: `startCrawl` (lock → log → crawl → rebuild → release), `activeRuns`, `lastSuccessfulRun`, `reconcileOrphanedRuns`.
  - `lock.js`: `tryAcquire`, `getLockState`.
  - `leaderboard.js`: `rebuildLeaderboard` (serialized; ranks, `previousRank`, `crawlRanks`, `totalValidBadges`, `badgeStats`, `dailyCounts`).
  - `ingest.js`: `normalizeProfileUrl` and `ingestParticipants`.
- `routes/`: `admin.js` (crawl, status, logs), `participants.js` (ingestion), `leaderboard.js` (public list and `/:userId` with `position`, `ahead`, `totalParticipants`), `health.js`.
- `middleware/`: `errors.js` (`AppError` + central handler), `validation.js` (zod → 400, `escapeRegex`), `requireAdmin.js`, `security.js` (helmet, CORS, limiters), `requestId.js`.
- `jobs/scheduler.js`: node-cron with `noOverlap`; every tick goes through `startCrawl`.
- `scripts/`: `crawl-once.js` (real crawl via the lock, or `--dry-run`), `check-real.js` (read-only real-DB report, including unique-index health via `listIndexes`).
- `data/Accepted Badges.csv`: the whitelist.
- `tests/unit`, `tests/integration`, `tests/helpers`:
  - `mongo.js` (`startMongo`), `app.js` (`buildTestApp`, `assertErrorShape`), `env.js` (`testConfig`, `TEST_ADMIN_KEY`);
  - `leaderboard.js` (`leaderboardSuite`, `makeUser`, `award`, `rebuild`, `getSnapshot`);
  - `childProcess.js` (`childEnv`, `startServer`, `waitForListening`, `runScript`) for boot, shutdown and CLI tests.
- `tests/e2e`: the real server as a child process against an in-memory replica set, with Google replaced by `helpers/fakeGoogle.js` (nock preload driven by a scenario JSON); `helpers/harness.js` gives per-test servers/DBs, crawl and ingest helpers, and integrity checks.
- `../docs/google-form-apps-script.gs`: Google Form → ingestion endpoint.

## Code map (`client/`)
Setup, variables and scripts are in the README under Frontend.
- `index.html`: the inline theme script (sets `data-bs-theme` before first paint; its storage key must match `STORAGE_KEYS.theme`), Open Graph tags using `%VITE_SITE_URL%`, Bootstrap CSS from jsDelivr with SRI, non-blocking Poppins.
- `vite.config.js`: dev port 5173, the `/api` proxy (`VITE_PROXY_TARGET`), the `VITE_SITE_URL` build warning.
- `src/main.jsx`: mounts the app; registers `public/sw.js` in production builds only.
- `src/App.jsx`: routes `/`, `/p/:userId` (the board with that participant's popup open), `/community`, and a 404 page; scroll on navigation.
- `src/api.js`: the only fetch layer (`fetchLeaderboard`, `fetchParticipant`, `fetchHealth`). Errors are generic (`.status` for HTTP errors); details go to the console. Copies the service worker's `X-SW-Cached-At` header into `servedFromCacheAt`.
- `src/lib/`:
  - `leaderboard.js`: the shared rules, all pure and tested — swag tiers (`SILVER_BADGES`, `GOLD_BADGES`), `UPDATE_INTERVAL_HOURS`, podium selection, `rankChange`, `nextGoals`, `missingBadges`, `peakDay`, `trackFill`, labels and every date, time and credit formatter.
  - `motion.js`: `prefersReducedMotion`, `isCoarsePointer`, `scrollBehavior`.
  - `storage.js`: localStorage that never throws (`STORAGE_KEYS.theme`, `STORAGE_KEYS.pinned`).
- `src/hooks/`: `useLeaderboard` (fetch, retry, refresh on returning to the tab after 5 min), `usePinned` (the "This is me" participant, shared by the popup and the MeBar, synced across tabs).
- `src/content/acceptedBadges.js`: mirrors `server/data/Accepted Badges.csv` (title, URL, credits).
- `src/pages/`: `LeaderboardPage` (URL state `?q=&page=&limit=`, the freshness line, the offline notice, owns the one shared `BadgeModal`), `CommunityPage`.
- `src/components/`: `Navbar` (theme toggle), `Footer` (health status), `LeaderboardTable` (movement, FLIP reorder, three columns on phones), `BadgeModal` (bottom sheet on phones, pin, copy link, not earned yet), `BadgeTrack` (the one 10-segment track), `Podium`, `ScoringInfo`, `ActivityChart`, `MeBar` (pinned participant bar).
- `src/styles/`: one stylesheet per component, plus `variables.css` (every colour, both themes, spacing, radii, `--touch-min`, `--mebar-*`) and `global.css` (reset, shared focus ring, swag pills, the reduced-motion rule); `src/index.css` imports them all.
- `public/`: `sw.js` (service worker), `og-image.png` (link previews), `favicon.svg`, `robots.txt`.

## Frontend rules
- Mobile first: design at 360 px, then 390/412, tablet and desktop. No horizontal scroll at 360 px; tap targets at least `var(--touch-min)` (44 px) with 8 px between them; body text at least 14 px, inputs 16 px; nothing that works only on hover; `env(safe-area-inset-*)` for anything fixed to a screen edge; landscape phones stay usable.
- Colours, spacing, radii and focus come only from `variables.css`. No raw hex or px values that duplicate a variable. `--brand-blue` for fills and focus, `--link-text` for blue text, `--google-*` only for the heading bar and the Community card accents.
- Dark mode works only through `data-bs-theme` on `<html>` and the dark values in `variables.css`. Every new colour needs a dark value at AA contrast.
- Reuse `BadgeTrack` for badge progress; never redraw it.
- Every request goes through `src/api.js`. Every shared rule or formatter goes in `src/lib/leaderboard.js` with a test.
- Any number on screen comes from an API field or a documented constant. When a field is missing (an old snapshot), hide the feature; never show 0 instead.
- No slop: no emoji, sentence case everywhere, one term per concept (badges, credits, participants, Google Skills), no marketing copy, no decorative gradients, glows or icons. Motion only for the FLIP reorder, the scoring chevron and the bottom-sheet opening, and the global reduced-motion rule disables all of it.

## Business rules (with the reason for each)
- **Whitelist: 10 accepted badges, from `data/Accepted Badges.csv`.** The protected scraper filters scraped badges by this file, and `crawl.js` loads it once (names, credits) with the same normalization (trim, collapse spaces, lowercase) for counting, credits and `badgeStats`. Old non-whitelisted rows never count.
- **Date rule: the displayed profile date must be on or after `COMPETITION_START_DATE` (2026-10-26), and on or before `COMPETITION_END_DATE` if set.** Profiles show only a calendar date, which is stored as UTC midnight (hence TZ=UTC).
- **A null date never counts.** The scraper returns `earnedAt: null` when it can't parse a date. Such badges are skipped and logged, never defaulted to "now".
- **Zero-seconds rule: a valid `earnedAt` has zero seconds and milliseconds.** Old code stamped rows with `new Date()`, while real parsed dates are always midnight. Such rows are excluded (never deleted) until a scrape rewrites them.
- **One count per badge name per user**, matched by normalized name with the earliest date winning. Duplicate Badge docs with the same name must not double-count.
- **Nothing is ever deleted**: not users, badges or userbadges. A crawl only upserts `UserBadge` (unique on user + badge) and `$set`s `user.badgeCount`. `credits` are never touched.
- **`badgeCount` means competition-valid badges**, but the site reads `validBadgeCount` from the API, never the DB.
- **Badge identity:** a Badge is found by exact `name` (oldest doc if duplicates exist), or created from the scraped fields. Creation is serialized per name within a run. On E11000, re-find by name; if there is still none (e.g. a renamed badge colliding on `externalId`), the user fails with `badge_conflict`.
- **Empty result.** It writes nothing, because a sign-in wall or markup change looks exactly like "no badges". If the user had no valid badges, it counts as succeeded (with zero); otherwise it is an `empty_result` failure that makes the run `partial`.
- **Thrown scrape after retries.** It writes nothing, and the failure is `http_<status>` or the error code. Retries happen only on network errors, 429 and 5xx, with full-jitter backoff. `Retry-After` pauses all workers.
- **Suspicious empty run.** A run is marked `failed` with `error: "suspicious_empty_run"` when it has ≥ `SUSPICIOUS_EMPTY_MIN_USERS` (5) users AND either every scrape that returned was empty, or `empty_result` ≥ `SUSPICIOUS_EMPTY_RATIO` (0.3) of the users who had valid badges before the run. Then there is no rebuild and no new `lastSuccessfulUpdate`, so a block or CAPTCHA never looks like a successful run.
- **Run status**, checked in this order: `failed` if the run crashed; `aborted` if the lock was lost or the server shut down; `failed` if the run was suspicious, or if `total > 0` and nobody succeeded; `partial` if `failed > 0`; otherwise `success`. `lastSuccessfulUpdate` is the `finishedAt` of the latest `success`/`partial` run.
- **Ranking**: `validBadgeCount` desc, then `validCredits` desc, then `latestValidBadgeAt` asc (earlier finisher ranks higher).
  - `validCredits` is the CSV's `# of credits required` summed over the counted badges (0-credit badges still count as badges). It comes from the CSV because the protected `User.credits` is legacy data; never read or write it.
  - Only an identical (count, credits, date) triple shares a rank (1, 1, 3); display order within a rank is by username. Zero-badge users share the last rank.
  - A snapshot built before `validCredits` existed is served with `validCredits: null` (unknown, not 0) until the next rebuild.
- **Movement**: each crawl rebuild stores `crawlRanks` (who was on the board and where). The next crawl sets `previousRank` from it, so anyone absent at the previous crawl is "New" (`null`), even if registration added them to the snapshot in between. Registration rebuilds carry `previousRank` and `crawlRanks` over unchanged, so registering never fakes movement.
- **Board statistics** (same valid-badge rule as ranking): `totalValidBadges` over all participants; `badgeStats` in CSV order with CSV names, `earnedBy` counted per participant; `dailyCounts` one entry per day from the start date to the last crawl's day (zero days included), capped at the end date and at today's date in Asia/Kolkata, so a profile date ahead of the real date never shows as a future day.
- **Swag tiers** (client only, from `validBadgeCount`): Silver at `SILVER_BADGES` (5), Gold at `GOLD_BADGES` (10).
- **Snapshot**: rebuilt after every `success`/`partial` run (still holding the lock) and after every ingestion with ≥ 1 write. Ingestion keeps the existing `lastSuccessfulUpdate` and never fakes a crawl time. Rebuilds run one at a time in the process, so an older rebuild can't overwrite a newer one. A failed run leaves the old snapshot.
- **Ingestion identity**: `skillsUrl` is canonical `https://www.skills.google/public_profiles/<id>` (the seed's form, id case preserved). http, no-www, the `cloudskillsboost.google` host, a trailing slash and a query/hash are accepted; everything else is rejected (SSRF guard). Dedupe is case-insensitive; an existing user keeps its stored `skillsUrl`, and only username and emails are updated.
- **Concurrency**: one crawl at a time via the `job_locks` lease (DB clock, heartbeat every ttl/3, owner-checked release). Run a single app instance: the rate limiter, ingestion queue and rebuild queue are in-process.
- **Orphaned runs**: a `running` log whose process died is marked `failed` / `error: "orphaned"` at boot (unless its lease is still live) and, at the latest, by the next run that takes the lock.

## How to make common changes
- **Change the competition dates**: set `COMPETITION_START_DATE` (and optionally `COMPETITION_END_DATE`). The next crawl or ingestion rebuild applies it; nothing in the DB changes, because counts are always recomputed.
- **Add, replace or rename an accepted badge** (Google renames show up as `badge_conflict` or a sudden drop in counts in `crawler_logs`):
  1. edit `server/data/Accepted Badges.csv` (columns `Course Name,Course URL,Type of Course,# of credits required`; the protected scraper matches by title);
  2. make the same change in `client/src/content/acceptedBadges.js` (title, URL, credits);
  3. update the expected list in `server/tests/unit/protected.test.js` and the README's Scoring list.
  Old Badge docs stay; counting is by name.
- **Change the swag thresholds**: `SILVER_BADGES` / `GOLD_BADGES` in `client/src/lib/leaderboard.js` (all copy reads them), plus the README's Scoring section.
- **Change the crawl schedule or politeness**: `CRON_SCHEDULE`, `CRON_TIMEZONE`, `CRAWL_CONCURRENCY`, `CRAWL_MIN_GAP_MS` and the retry variables. If the interval changes, also change `UPDATE_INTERVAL_HOURS` in `client/src/lib/leaderboard.js` (the "updates every 6 hours" copy and the next-update estimate). A new variable goes in `config/env.js`, `.env.example` (a test checks it is complete) and the README table.
- **Add an endpoint**:
  1. Put the route in `routes/` and mount it in `app.js`. Admin routes go under `/api/admin` (already rate-limited). A new admin router sets `Cache-Control: no-store` and then uses `requireAdmin`, like `adminRouter` and `participantsRouter`, so even 401s aren't cached.
  2. Validate input with `parse(schema, input)` from `middleware/validation.js`, and throw `AppError` for other errors. Unknown query keys are deliberately ignored (a cache-busting `?_=…` must never break a request), and an ingestion batch where every row is rejected is a 422, not a 400.
  3. Never expose `email`/`skillsEmail` publicly.
  4. Add the client call to `src/api.js`, and update the README API reference and the diagram if the flow changes.
- **Ship a client change that only touches `public/`**: set a new `VITE_BUILD_ID` for the build, so the service worker gets a new cache name and drops the old shell.
- **Server tests**:
  - `npm test` runs `tests/unit` and `tests/integration` (explicit globs keep the protected `scraper/test.js` out).
  - Use `startMongo()`, `buildTestApp(configOverrides, { crawlDeps: { scrape } })`, and inject `scrape` into `crawlAll` (with `settingsFromConfig(testConfig())`) or `startCrawl` (with `lockTtlMs`). Leaderboard tests use `leaderboardSuite()` and `rebuild()` from `tests/helpers/leaderboard.js`.
  - CLI, boot and shutdown tests spawn real processes through `tests/helpers/childProcess.js` (`ENV_FILE=""`).
  - End-to-end scenarios go in `tests/e2e/` (`npm run test:e2e`, kept out of `npm test` because it takes over a minute). Change fake profiles with `setProfiles()`; the fake blocks all other network access.
  - Timing assertions must hold on a loaded machine: compare against what the code guarantees, not against how fast requests usually start.
- **Client tests**: `npm test` in `client/` runs `src/lib/*.test.js` with Node's test runner; anything worth testing belongs in `src/lib/`.

## Known edges and accepted risks
- **xlsx 0.18.5** has unpatched advisories (prototype pollution, ReDoS on crafted files). It only reads the committed CSV and the organisers' local seed spreadsheet, never uploads.
- **A scrape can't be cancelled mid-request**, because the protected `scrapeProfile` takes no signal. An abort stops new users and all writes after it.
- **Windows can't deliver a catchable SIGTERM to a child process.** `index.js` also accepts an IPC `"shutdown"` message, only when `NODE_ENV=test`, and the shutdown test uses it on win32.
- **A blocked page and "no accepted badges" both come back as `[]`.** Hence the empty-result and suspicious-empty-run rules.
- **`seeds/userSeed.js` deletes all users** before importing. Never run it against the live DB. It is only a one-time initial import.
- **Index builds at boot**: if a unique index can't be built (e.g. duplicates already in the data), the error is logged and the server still starts, without that guarantee. Check the boot logs for `index build failed`; `npm run check:real` reports any missing unique index.
- **`skillsUrl` is indexed twice** in the protected User schema. Mongoose warns about it, and it is harmless.
- **Profile dates and time zones**: if profiles display US time, badges earned 00:00–09:29 IST on Oct 26 show as Oct 25 and don't count; the profile date is the source of truth. `dailyCounts` uses the same calendar dates, capped at today in IST.
- **The first crawl after deploying movement tracking** compares against the old snapshot's row ranks, because no `crawlRanks` exist yet. Anyone registered since the last old crawl shows a movement arrow instead of "New", once.
- **Lighthouse Performance is about 85 on mobile**: the full Bootstrap CSS from the CDN blocks the first paint. Accessibility, Best Practices and SEO score 100.
- **Content-Security-Policy**: a CSP on the site's host must allow the inline theme script by hash (and the fonts preload `onload`); see the README's operating notes.

## Commands
From `server/`:
```bash
npm ci
npm start                          # node index.js (TZ forced to UTC in code)
npm run dev                        # node --watch index.js
npm test                           # unit + integration (tests/unit, tests/integration)
npm run test:e2e                   # end-to-end: real server, fake Google (tests/e2e)
npm run crawl:once                 # one real crawl through the lock (exit 2 if one is running)
npm run crawl:once -- --dry-run    # report only; no writes, no lock, no collections
npm run check:real                 # read-only real-DB report (README)
mongodump --uri "$MONGO_URI" --out backup-YYYYMMDD   # before any risky operation
```

From `client/`:
```bash
npm ci
npm run dev                        # port 5173, proxies /api to http://localhost:3000
npm run build                      # production build into dist/ (set VITE_API_BASE_URL, VITE_SITE_URL)
npm run preview                    # serve the production build (the service worker runs only here)
npm run lint                       # oxlint, 0 warnings expected
npm test                           # src/lib/*.test.js
```

Before enabling cron in production, follow the go-live checklist in the README.
