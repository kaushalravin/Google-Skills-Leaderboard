const express = require("express");
const mongoose = require("mongoose");

const { lastSuccessfulRun, LOCK_NAME } = require("../services/crawlRunner");
const { getLockState } = require("../services/lock");
const { CrawlerLog } = require("../models/crawlerLog");

const DB_TIMEOUT_MS = 2000;

/** Rejects if `promise` doesn't settle within `ms`, so a dead DB can't hang the probe. */
function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function pingDb() {
    const started = Date.now();
    try {
        if (mongoose.connection.readyState !== 1) throw new Error("not connected");
        await withTimeout(mongoose.connection.db.admin().ping(), DB_TIMEOUT_MS);
        return { ok: true, latencyMs: Date.now() - started };
    } catch {
        return { ok: false, latencyMs: Date.now() - started };
    }
}

const healthRouter = express.Router();

healthRouter.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});

/** Liveness: the process answers; no DB access. */
healthRouter.get("/live", (req, res) => {
    res.json({ status: "ok" });
});

healthRouter.get("/", async (req, res) => {
    const { config } = req.app.locals;
    const cron = { enabled: config.CRON_ENABLED, schedule: config.CRON_SCHEDULE, timezone: config.CRON_TIMEZONE };
    const down = (db) =>
        res.status(503).json({ status: "down", db, lastSuccessfulUpdate: null, crawl: null, latestRun: null, cron });

    const db = await pingDb();
    if (!db.ok) return down(db);

    let lock, latestRun, lastRun;
    try {
        [lock, latestRun, lastRun] = await withTimeout(
            Promise.all([
                getLockState(LOCK_NAME),
                CrawlerLog.findOne({}, { _id: 0, runId: 1, status: 1, startedAt: 1, finishedAt: 1 })
                    .sort({ startedAt: -1 })
                    .lean(),
                lastSuccessfulRun()
            ]),
            DB_TIMEOUT_MS
        );
    } catch {
        return down({ ok: false, latencyMs: db.latencyMs });
    }

    const lastSuccessfulUpdate = lastRun?.finishedAt ?? null;
    const fresh =
        lastSuccessfulUpdate !== null &&
        Date.now() - lastSuccessfulUpdate.getTime() <= config.STALE_AFTER_HOURS * 3600 * 1000;

    res.json({
        status: fresh ? "ok" : "degraded",
        db,
        lastSuccessfulUpdate,
        crawl: { inProgress: lock.held, lock },
        latestRun: latestRun ?? null,
        cron
    });
});

module.exports = { healthRouter };
