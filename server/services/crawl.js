const path = require("node:path");
const { setTimeout: sleep } = require("node:timers/promises");
const pLimit = require("p-limit");
const XLSX = require("xlsx");

const { scrapeProfile } = require("../scraper/webScraper");
const { User } = require("../models/users");
const { Badge } = require("../models/badges");
const { UserBadge } = require("../models/userBadges");
const { createLogger } = require("../config/logger");

const ACCEPTED_BADGES_PATH = path.resolve(__dirname, "../data/Accepted Badges.csv");
const MAX_FAILURES = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const NETWORK_CODES = new Set([
    "ECONNABORTED", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED",
    "ENOTFOUND", "EAI_AGAIN", "EPIPE", "ERR_NETWORK"
]);

// --- Whitelist and validity ------------------------------------------------

// Same normalization and row filter as scraper/webScraper.js, which doesn't export them.
function normalizeBadgeName(name) {
    return String(name).trim().replace(/\s+/g, " ").toLowerCase();
}

/** Map<normalizedName, { name, credits }> from the CSV, in CSV order, with the name as written there. */
function loadAcceptedBadges() {
    const workbook = XLSX.readFile(ACCEPTED_BADGES_PATH);
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
    return new Map(
        rows
            .map((row) => ({ name: String(row["Course Name"]).trim(), credits: Number(row["# of credits required"]) }))
            .filter(({ name, credits }) => name && Number.isFinite(credits))
            .map((badge) => [normalizeBadgeName(badge.name), badge])
    );
}

const acceptedBadges = loadAcceptedBadges();
const ACCEPTED_BADGE_NAMES = [...acceptedBadges.values()].map((badge) => badge.name);
const isWhitelisted = (name) => acceptedBadges.has(normalizeBadgeName(name));
const badgeCredits = (name) => acceptedBadges.get(normalizeBadgeName(name))?.credits ?? 0;

/** Inclusive start; end (if set) is exclusive at the following UTC midnight. */
function competitionWindow({ startDate, endDate }) {
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = endDate ? new Date(Date.parse(`${endDate}T00:00:00.000Z`) + DAY_MS) : null;
    return { start, end };
}

/**
 * Parsed dates are always midnight. A timestamp with seconds or milliseconds came
 * from the old `new Date()` fallback, so it doesn't count until a scrape corrects it.
 */
function isValidEarnedAt(date, window) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
    if (date.getUTCSeconds() !== 0 || date.getUTCMilliseconds() !== 0) return false;
    return date >= window.start && (!window.end || date < window.end);
}

/**
 * The valid-badge rule, shared by the crawl and the leaderboard: from UserBadge rows
 * with `badge` populated, keep whitelisted rows with a valid earnedAt, one per distinct
 * normalized name (earliest earnedAt wins), so legacy duplicate Badge docs count once.
 * Returns Map<normalizedName, row>.
 */
function selectValidBadges(rows, window) {
    const byName = new Map();
    for (const row of rows) {
        if (!row.badge || !isWhitelisted(row.badge.name) || !isValidEarnedAt(row.earnedAt, window)) continue;
        const key = normalizeBadgeName(row.badge.name);
        const seen = byName.get(key);
        if (!seen || row.earnedAt < seen.earnedAt) byName.set(key, row);
    }
    return byName;
}

async function countValidBadges(userId, window) {
    const rows = await UserBadge.find({ user: userId }, { badge: 1, earnedAt: 1 })
        .populate("badge", "name")
        .lean();
    return selectValidBadges(rows, window).size;
}

/** Users with at least one valid badge right now (one read of all UserBadges). */
async function countUsersWithValidBadges(window) {
    const rows = await UserBadge.find({}, { user: 1, badge: 1, earnedAt: 1 }).populate("badge", "name").lean();
    const byUser = new Map();
    for (const row of rows) {
        const key = String(row.user);
        if (!byUser.has(key)) byUser.set(key, []);
        byUser.get(key).push(row);
    }
    let count = 0;
    for (const userRows of byUser.values()) if (selectValidBadges(userRows, window).size > 0) count++;
    return count;
}

// --- Retries and politeness --------------------------------------------------

function isRetryable(err) {
    const status = err?.response?.status;
    if (status !== undefined) return status === 429 || status >= 500;
    return err?.isAxiosError === true || NETWORK_CODES.has(err?.code);
}

/** Retry-After as milliseconds (delta-seconds or HTTP-date), or null if absent/invalid. */
function parseRetryAfter(value, now = Date.now()) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (/^\d+$/.test(text)) return Number(text) * 1000;
    const at = Date.parse(text);
    return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** Full jitter: uniform in [0, min(max, base * 2^attempt)). */
function backoffDelay(attempt, { backoffBaseMs, backoffMaxMs }, random = Math.random) {
    return Math.floor(random() * Math.min(backoffMaxMs, backoffBaseMs * 2 ** attempt));
}

/** Shared by all workers: spaces request starts and holds everyone during a Retry-After. */
function createGate(minGapMs) {
    let nextStartAt = 0;
    let pausedUntil = 0;
    return {
        pause(ms) {
            pausedUntil = Math.max(pausedUntil, Date.now() + ms);
        },
        async waitTurn(signal) {
            for (;;) {
                const wait = Math.max(nextStartAt, pausedUntil) - Date.now();
                if (wait <= 0) {
                    nextStartAt = Date.now() + minGapMs;
                    return;
                }
                await sleep(wait, undefined, { signal });
            }
        }
    };
}

async function scrapeWithRetry(url, { scrape, gate, settings, signal }) {
    for (let attempt = 0; ; attempt++) {
        await gate.waitTurn(signal);
        try {
            return await scrape(url);
        } catch (err) {
            if (attempt >= settings.maxRetries || !isRetryable(err) || signal?.aborted) throw err;
            const retryAfter = parseRetryAfter(err.response?.headers?.["retry-after"]);
            if (retryAfter !== null) {
                gate.pause(Math.min(retryAfter, settings.retryAfterMaxMs));
            } else {
                await sleep(backoffDelay(attempt, settings), undefined, { signal });
            }
        }
    }
}

// --- Persistence -------------------------------------------------------------

class CrawlAborted extends Error {}

function assertNotAborted(signal) {
    if (signal?.aborted) throw new CrawlAborted();
}

async function findOrCreateBadge({ name, externalId, badgeUrl, imageUrl }) {
    // Oldest doc wins if legacy duplicates of a name exist.
    const existing = await Badge.findOne({ name }).sort({ _id: 1 }).lean();
    if (existing) return existing;
    try {
        return (await Badge.create({ externalId, name, badgeUrl, imageUrl: imageUrl ?? null })).toObject();
    } catch (err) {
        if (err.code !== 11000) throw err;
        const raced = await Badge.findOne({ name }).sort({ _id: 1 }).lean();
        if (raced) return raced;
        throw Object.assign(
            new Error(`Badge "${name}" collides with an existing badge's externalId/badgeUrl`),
            { code: "badge_conflict" }
        );
    }
}

/** Per-run cache that also serializes creation per name (Badge.name has no unique index). */
function badgeResolver() {
    const byName = new Map();
    return (scraped) => {
        if (!byName.has(scraped.name)) {
            byName.set(
                scraped.name,
                findOrCreateBadge(scraped).catch((err) => {
                    byName.delete(scraped.name);
                    throw err;
                })
            );
        }
        return byName.get(scraped.name);
    };
}

function recordFailure({ result, logger }, user, err, reason) {
    const httpStatus = err?.response?.status ?? null;
    const failure = {
        userId: String(user._id),
        reason: reason ?? (httpStatus ? `http_${httpStatus}` : String(err?.code || err?.message || "error").slice(0, 200)),
        httpStatus
    };
    result.failed++;
    if (reason === "empty_result") result.empty++;
    if (result.failures.length < MAX_FAILURES) result.failures.push(failure);
    logger.warn(failure, "crawl failed for user");
}

async function processUser(user, ctx) {
    const { signal, window, result, logger } = ctx;
    if (signal?.aborted) return;

    let scraped;
    try {
        scraped = await scrapeWithRetry(user.skillsUrl, ctx);
    } catch (err) {
        if (!signal?.aborted) recordFailure(ctx, user, err);
        return;
    }
    if (signal?.aborted) return;
    if (scraped.length === 0) result.emptyScrapes++;
    else result.nonEmptyScrapes++;

    try {
        // Keep one entry per name (earliest date); badges without a parsed date are never stored.
        const byName = new Map();
        for (const badge of scraped) {
            if (!(badge.earnedAt instanceof Date) || Number.isNaN(badge.earnedAt.getTime())) {
                result.badgesSkippedNoDate++;
                logger.info({ userId: String(user._id), badge: badge.name }, "badge skipped: no parseable earned date");
                continue;
            }
            const seen = byName.get(badge.name);
            if (!seen || badge.earnedAt < seen.earnedAt) byName.set(badge.name, badge);
        }

        if (scraped.length === 0) {
            // Indistinguishable from a sign-in wall or markup change: only OK if nothing is at stake.
            if ((await countValidBadges(user._id, window)) > 0) {
                return recordFailure(ctx, user, null, "empty_result");
            }
            result.succeeded++;
            result.report?.push({ userId: String(user._id), scraped: 0, valid: 0 });
            return;
        }

        if (ctx.dryRun) {
            const valid = [...byName.values()].filter((b) => isValidEarnedAt(b.earnedAt, window)).length;
            result.succeeded++;
            result.report.push({ userId: String(user._id), scraped: scraped.length, valid });
            return;
        }

        for (const scrapedBadge of byName.values()) {
            assertNotAborted(signal);
            const badge = await ctx.resolveBadge(scrapedBadge);
            assertNotAborted(signal);
            await UserBadge.updateOne(
                { user: user._id, badge: badge._id },
                { $set: { earnedAt: scrapedBadge.earnedAt } },
                { upsert: true }
            );
            result.badgesUpserted++;
        }

        const badgeCount = await countValidBadges(user._id, window);
        assertNotAborted(signal);
        await User.updateOne({ _id: user._id }, { $set: { badgeCount } });
        result.succeeded++;
    } catch (err) {
        if (err instanceof CrawlAborted) return;
        recordFailure(ctx, user, err);
    }
}

/**
 * Crawls every user with a skillsUrl through the protected scrapeProfile and
 * persists whitelisted badges via upserts. Never deletes anything and never
 * calls syncUserBadges. A failure for one user leaves that user's data untouched.
 * options: settingsFromConfig(config), plus optional scrape, signal, dryRun and logger.
 */
async function crawlAll(options) {
    const { scrape = scrapeProfile, signal, dryRun = false, ...settings } = options;
    const logger = options.logger ?? createLogger({ level: "silent" });

    const users = await User.find({ skillsUrl: { $exists: true, $nin: [null, ""] } }, { skillsUrl: 1 })
        .sort({ _id: 1 })
        .lean();

    const result = {
        total: users.length,
        succeeded: 0,
        failed: 0,
        empty: 0, // empty_result failures, also counted in `failed`
        emptyScrapes: 0, // scrapes that returned [], whether or not that was a failure
        nonEmptyScrapes: 0,
        suspiciousEmpty: false,
        failures: [],
        aborted: false,
        badgesUpserted: 0,
        badgesSkippedNoDate: 0
    };
    if (dryRun) result.report = [];

    const ctx = {
        scrape,
        signal,
        dryRun,
        logger,
        settings,
        result,
        window: competitionWindow(settings),
        gate: createGate(settings.minGapMs),
        resolveBadge: badgeResolver()
    };

    // Read before any write: the baseline for the suspicious-empty check.
    const flaggable = users.length >= settings.suspiciousEmptyMinUsers;
    const usersWithValidBefore = flaggable ? await countUsersWithValidBadges(ctx.window) : 0;

    const limit = pLimit(settings.concurrency);
    await Promise.all(users.map((user) => limit(() => processUser(user, ctx))));

    result.aborted = Boolean(signal?.aborted);
    // scrapeProfile returns [] for a block, CAPTCHA or markup change, so a mass-empty run is
    // treated as a failure of the whole run rather than as everyone having no badges.
    result.suspiciousEmpty =
        flaggable &&
        ((result.emptyScrapes > 0 && result.nonEmptyScrapes === 0) ||
            (usersWithValidBefore > 0 && result.empty / usersWithValidBefore >= settings.suspiciousEmptyRatio));
    return result;
}

/** Maps validated env config onto crawlAll options. */
function settingsFromConfig(config) {
    return {
        concurrency: config.CRAWL_CONCURRENCY,
        minGapMs: config.CRAWL_MIN_GAP_MS,
        maxRetries: config.CRAWL_MAX_RETRIES,
        backoffBaseMs: config.CRAWL_BACKOFF_BASE_MS,
        backoffMaxMs: config.CRAWL_BACKOFF_MAX_MS,
        retryAfterMaxMs: config.CRAWL_RETRY_AFTER_MAX_MS,
        startDate: config.COMPETITION_START_DATE,
        endDate: config.COMPETITION_END_DATE,
        suspiciousEmptyMinUsers: config.SUSPICIOUS_EMPTY_MIN_USERS,
        suspiciousEmptyRatio: config.SUSPICIOUS_EMPTY_RATIO
    };
}

module.exports = {
    crawlAll,
    settingsFromConfig,
    selectValidBadges,
    normalizeBadgeName,
    isWhitelisted,
    badgeCredits,
    isValidEarnedAt,
    competitionWindow,
    isRetryable,
    parseRetryAfter,
    backoffDelay,
    ACCEPTED_BADGE_NAMES,
    DAY_MS
};
