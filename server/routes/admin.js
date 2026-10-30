const express = require("express");
const { z } = require("zod");

const { requireAdmin } = require("../middleware/requireAdmin");
const { AppError } = require("../middleware/errors");
const { parse } = require("../middleware/validation");
const { settingsFromConfig } = require("../services/crawl");
const { startCrawl, lastSuccessfulRun, LOCK_NAME } = require("../services/crawlRunner");
const { getLockState } = require("../services/lock");
const { CrawlerLog } = require("../models/crawlerLog");

const logsQuery = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20)
});

const adminRouter = express.Router();

adminRouter.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});
adminRouter.use(requireAdmin);

adminRouter.post("/crawl", async (req, res) => {
    const { config, logger, crawlDeps } = req.app.locals;
    const run = await startCrawl(
        { trigger: "manual", triggeredBy: "admin" },
        { crawlOptions: settingsFromConfig(config), lockTtlMs: config.LOCK_TTL_MS, logger, ...crawlDeps }
    );
    if (!run.started) {
        throw new AppError(409, "CRAWL_IN_PROGRESS", "A crawl is already running", {
            trigger: run.lock.meta?.trigger ?? null,
            since: run.lock.acquiredAt
        });
    }
    // `done` never rejects; the run finishes in the background.
    res.status(202).json({ runId: run.runId });
});

adminRouter.get("/crawl/status", async (req, res) => {
    const [lock, latestRun, lastRun] = await Promise.all([
        getLockState(LOCK_NAME),
        CrawlerLog.findOne({}, { _id: 0 }).sort({ startedAt: -1 }).lean(),
        lastSuccessfulRun()
    ]);
    res.json({ lock, latestRun, lastSuccessfulUpdate: lastRun?.finishedAt ?? null });
});

adminRouter.get("/crawl/logs", async (req, res) => {
    const { limit } = parse(logsQuery, req.query);
    const runs = await CrawlerLog.find({}, { _id: 0, failures: 0 })
        .sort({ startedAt: -1 })
        .limit(limit)
        .lean();
    res.json({ runs });
});

module.exports = { adminRouter };
