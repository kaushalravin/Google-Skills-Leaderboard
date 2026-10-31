const { randomUUID } = require("node:crypto");

const { crawlAll } = require("./crawl");
const { tryAcquire, getLockState } = require("./lock");
const { rebuildLeaderboard: defaultRebuild } = require("./leaderboard");
const { CrawlerLog } = require("../models/crawlerLog");
const { createLogger } = require("../config/logger");

const LOCK_NAME = "crawl";
const EMPTY_COUNTS = { total: 0, succeeded: 0, failed: 0, empty: 0, badgesUpserted: 0, badgesSkippedNoDate: 0 };

const SUSPICIOUS_EMPTY = "suspicious_empty_run";
const active = new Set();

const errorText = (err) => String(err?.message ?? err).slice(0, 500);

function statusOf(result, crashed) {
    if (crashed) return "failed";
    if (result.aborted) return "aborted";
    if (result.suspiciousEmpty) return "failed";
    if (result.total > 0 && result.succeeded === 0) return "failed";
    // Includes empty_result: a user who had valid badges came back empty. (A user without valid
    // badges who comes back empty counts as succeeded; a mass-empty run is suspiciousEmpty above.)
    if (result.failed > 0) return "partial";
    return "success";
}

async function runCrawl({ runId, trigger, triggeredBy, lease, deps }) {
    const { scrape, crawlOptions = {}, logger } = deps;
    const rebuildLeaderboard = deps.rebuildLeaderboard ?? defaultRebuild;
    const signal = deps.signal ? AbortSignal.any([lease.signal, deps.signal]) : lease.signal;
    const startedAt = new Date();
    let status = "failed";
    let counts = EMPTY_COUNTS;

    try {
        // Holding the lock means no other run is alive, so any log still "running" belongs to a
        // process that died (e.g. a crash followed by a restart before its lease expired).
        await markOrphaned({ status: "running" });
        await CrawlerLog.create({ runId, trigger, triggeredBy, status: "running", startedAt });
        logger.info({ runId, trigger }, "crawl started");

        let result;
        let crashError;
        try {
            result = await crawlAll({ ...crawlOptions, scrape, logger, signal });
        } catch (err) {
            crashError = err;
            logger.error({ err, runId }, "crawl crashed");
        }

        status = statusOf(result, crashError);
        if (result) {
            const { total, succeeded, failed, empty, badgesUpserted, badgesSkippedNoDate } = result;
            counts = { total, succeeded, failed, empty, badgesUpserted, badgesSkippedNoDate };
        }
        const finishedAt = new Date();
        await CrawlerLog.updateOne(
            { runId },
            {
                $set: {
                    status,
                    finishedAt,
                    durationMs: finishedAt - startedAt,
                    counts,
                    failures: result?.failures ?? [],
                    ...(crashError && { error: errorText(crashError) }),
                    ...(!crashError && !result.aborted && result.suspiciousEmpty && { error: SUSPICIOUS_EMPTY })
                }
            }
        );
        logger.info({ runId, status, counts }, "crawl finished");

        if (status === "success" || status === "partial") {
            // Still holding the lock, so no other run can interleave with the rebuild.
            try {
                await rebuildLeaderboard({
                    lastSuccessfulUpdate: finishedAt,
                    startDate: crawlOptions.startDate,
                    endDate: crawlOptions.endDate
                });
            } catch (err) {
                logger.error({ err, runId }, "leaderboard rebuild failed");
                await CrawlerLog.updateOne({ runId }, { $set: { error: `leaderboard rebuild failed: ${errorText(err)}` } });
            }
        }
    } catch (err) {
        // Only bookkeeping failed here (e.g. the DB went away); never reject `done`.
        status = "failed";
        logger.error({ err, runId }, "crawl run failed");
        await CrawlerLog.updateOne(
            { runId, status: "running" },
            { $set: { status, finishedAt: new Date(), error: errorText(err) } }
        ).catch((logErr) => logger.error({ err: logErr, runId }, "crawl log update failed"));
    } finally {
        await lease.release().catch((err) => logger.error({ err, runId }, "lock release failed"));
    }
    return { runId, status, counts };
}

/**
 * Starts a crawl under the "crawl" lock. Resolves immediately with
 * { started: false, lock } if another run holds it, else { started: true, runId, done },
 * where `done` always resolves (never rejects) with { runId, status, counts }.
 * deps: { scrape, crawlOptions, rebuildLeaderboard, logger, lockTtlMs, signal }.
 */
async function startCrawl({ trigger, triggeredBy }, deps = {}) {
    const fullDeps = { ...deps, logger: deps.logger ?? createLogger({ level: "silent" }) };
    const runId = randomUUID();
    const lease = await tryAcquire(LOCK_NAME, {
        ttlMs: deps.lockTtlMs,
        meta: { runId, trigger, triggeredBy }
    });
    if (!lease) return { started: false, lock: await getLockState(LOCK_NAME) };

    const done = runCrawl({ runId, trigger, triggeredBy, lease, deps: fullDeps });
    active.add(done);
    done.finally(() => active.delete(done));
    return { started: true, runId, done };
}

/** `done` promises of runs started by this process that haven't finished (for graceful shutdown). */
function activeRuns() {
    return [...active];
}

/** The latest success/partial run, or null. */
function lastSuccessfulRun() {
    return CrawlerLog.findOne({ status: { $in: ["success", "partial"] } }, { _id: 0 })
        .sort({ finishedAt: -1 })
        .lean();
}

async function markOrphaned(filter) {
    const res = await CrawlerLog.updateMany(filter, {
        $set: { status: "failed", error: "orphaned", finishedAt: new Date() }
    });
    return res.modifiedCount;
}

/** Boot-time: marks `running` logs failed unless their run still holds the crawl lock. */
async function reconcileOrphanedRuns() {
    const lock = await getLockState(LOCK_NAME);
    const filter = { status: "running" };
    if (lock.held && lock.meta?.runId) filter.runId = { $ne: lock.meta.runId };
    return markOrphaned(filter);
}

module.exports = { startCrawl, activeRuns, lastSuccessfulRun, reconcileOrphanedRuns, LOCK_NAME };
