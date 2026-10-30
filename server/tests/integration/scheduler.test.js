require("../../config/timezone");

const { test, before, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const cron = require("node-cron");

const { testConfig } = require("../helpers/env");
const { startScheduler, stopScheduler } = require("../../jobs/scheduler");
const { startMongo } = require("../helpers/mongo");
const { CrawlerLog } = require("../../models/crawlerLog");
const { tryAcquire } = require("../../services/lock");

let mongo;

before(async () => {
    mongo = await startMongo();
});

after(async () => {
    await mongo?.stop();
});

function recordingLogger() {
    const lines = [];
    const log = (level) => (...args) => lines.push({ level, args });
    return { lines, info: log("info"), warn: log("warn"), error: log("error") };
}

afterEach(async () => {
    await stopScheduler();
});

test("CRON_ENABLED=false schedules nothing and says so", () => {
    const logger = recordingLogger();
    const before = cron.getTasks().size;
    assert.equal(startScheduler({ config: testConfig({ CRON_ENABLED: "false" }), logger }), null);
    assert.equal(cron.getTasks().size, before);
    assert.match(logger.lines[0].args.join(" "), /cron disabled/);
});

test("CRON_ENABLED=true schedules one non-overlapping task in CRON_TIMEZONE; stop removes it", async () => {
    const logger = recordingLogger();
    const before = cron.getTasks().size;
    const task = startScheduler({
        config: testConfig({ CRON_ENABLED: "true", CRON_SCHEDULE: "0 */6 * * *", CRON_TIMEZONE: "Asia/Kolkata" }),
        logger
    });
    assert.ok(task);
    assert.equal(task.getPattern(), "0 */6 * * *");
    assert.equal(cron.getTasks().size, before + 1);
    // Every 6 h in IST: the next run is at 00/06/12/18 h IST, i.e. HH:30 UTC.
    assert.equal(task.getNextRun().getUTCMinutes(), 30);
    await stopScheduler();
    assert.equal(cron.getTasks().size, before);
});

test("a cron tick runs through the lock as trigger cron, and is skipped while the lock is held", async () => {
    const logger = recordingLogger();
    const rebuilds = [];
    const task = startScheduler({
        config: testConfig({ CRON_ENABLED: "true" }),
        logger,
        deps: { scrape: async () => [], rebuildLeaderboard: async (args) => rebuilds.push(args) }
    });
    await task.execute();
    const logs = await CrawlerLog.find().lean();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].trigger, "cron");
    assert.equal(logs[0].triggeredBy, "cron");
    assert.equal(logs[0].status, "success");
    assert.equal(rebuilds.length, 1);

    const lease = await tryAcquire("crawl", { ttlMs: 60000, meta: { trigger: "manual" } });
    await task.execute();
    await lease.release();
    assert.equal(await CrawlerLog.countDocuments(), 1, "no run while the lock is held");
    assert.ok(logger.lines.some((l) => /skipped/.test(l.args.join(" "))));
});
