require("../../config/timezone");

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const { connectDb, disconnectDb } = require("../../config/db");
const { buildTestApp } = require("../helpers/app");
const { CrawlerLog } = require("../../models/crawlerLog");
const { JobLock } = require("../../models/jobLock");

const HOUR = 3600 * 1000;

// Own replica set (not tests/helpers/mongo.js) so the "down" test can stop the server
// while Mongoose still believes it is connected.
let replSet;
let app;

before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await connectDb(replSet.getUri("leaderboard-health"), { serverSelectionTimeoutMS: 10000 });
    await CrawlerLog.init();
    ({ app } = buildTestApp({ STALE_AFTER_HOURS: "13", RATE_LIMIT_PUBLIC_PER_MIN: "2", RATE_LIMIT_ADMIN_PER_MIN: "2" }));
});

after(async () => {
    await disconnectDb().catch(() => {});
    if (replSet?.state === "running") await replSet.stop();
});

beforeEach(async () => {
    if (replSet.state !== "running") return;
    await Promise.all([CrawlerLog.deleteMany({}), JobLock.collection.deleteMany({})]);
});

let seq = 0;
function log(status, finishedAgoMs) {
    const finishedAt = new Date(Date.now() - finishedAgoMs);
    return CrawlerLog.create({
        runId: `run-${++seq}`,
        trigger: "cron",
        triggeredBy: "cron",
        status,
        startedAt: new Date(finishedAt.getTime() - 60000),
        finishedAt
    });
}

test("health is degraded before the first successful run", async () => {
    await log("failed", 1000);
    const res = await request(app).get("/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.body.status, "degraded");
    assert.equal(res.body.lastSuccessfulUpdate, null);
    assert.equal(res.body.db.ok, true);
    assert.equal(typeof res.body.db.latencyMs, "number");
    assert.equal(res.body.latestRun.status, "failed");
    assert.deepEqual(res.body.crawl, {
        inProgress: false,
        lock: { held: false, acquiredAt: null, expiresAt: null, meta: null }
    });
    assert.deepEqual(res.body.cron, { enabled: false, schedule: "0 */6 * * *", timezone: "Asia/Kolkata" });

    await CrawlerLog.deleteMany({});
    const none = await request(app).get("/api/health");
    assert.equal(none.body.status, "degraded");
    assert.equal(none.body.latestRun, null);
});

test("health is ok after a recent success and shows lastSuccessfulUpdate and the latest run", async () => {
    const success = await log("success", 2 * HOUR);
    await log("failed", 1 * HOUR);
    const res = await request(app).get("/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
    assert.equal(res.body.lastSuccessfulUpdate, success.finishedAt.toISOString());
    assert.equal(res.body.latestRun.status, "failed");
    assert.deepEqual(Object.keys(res.body.latestRun).sort(), ["finishedAt", "runId", "startedAt", "status"]);
});

test("a partial run also counts as successful for health", async () => {
    await log("partial", 1 * HOUR);
    assert.equal((await request(app).get("/api/health")).body.status, "ok");
});

test("health is degraded when the last success is older than STALE_AFTER_HOURS", async () => {
    await log("success", 14 * HOUR);
    const res = await request(app).get("/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "degraded");
    assert.ok(res.body.lastSuccessfulUpdate);
});

test("health shows a crawl in progress from the lock", async () => {
    await JobLock.collection.insertOne({
        _id: "crawl",
        owner: "someone",
        meta: { runId: "r1", trigger: "manual", triggeredBy: "admin" },
        acquiredAt: new Date(),
        heartbeatAt: new Date(),
        expiresAt: new Date(Date.now() + 60000)
    });
    const res = await request(app).get("/api/health");
    assert.equal(res.body.crawl.inProgress, true);
    assert.equal(res.body.crawl.lock.meta.trigger, "manual");
    assert.equal(res.body.crawl.lock.owner, undefined);
});

test("health is never rate-limited and has no PII", async () => {
    await log("success", 1000);
    for (let i = 0; i < 6; i++) {
        const res = await request(app).get("/api/health");
        assert.equal(res.status, 200);
        assert.doesNotMatch(JSON.stringify(res.body), /email/i);
    }
    // The public limit (2/min) does apply to the leaderboard on the same app.
    await request(app).get("/api/leaderboard");
    await request(app).get("/api/leaderboard");
    assert.equal((await request(app).get("/api/leaderboard")).status, 429);
    assert.equal((await request(app).get("/api/health")).status, 200);
});

// Destructive: stops the DB. Keep these last.
test("health is down (503) promptly when the DB is gone, while /live still answers", async () => {
    await replSet.stop();

    const started = Date.now();
    const res = await request(app).get("/api/health");
    assert.ok(Date.now() - started < 5000, "down is reported promptly");
    assert.equal(res.status, 503);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.body.status, "down");
    assert.equal(res.body.db.ok, false);
    assert.equal(res.body.lastSuccessfulUpdate, null);

    const live = await request(app).get("/api/health/live");
    assert.equal(live.status, 200);
    assert.deepEqual(live.body, { status: "ok" });
});

test("/api/health/live answers with Mongoose disconnected; /api/health is down", async () => {
    await disconnectDb();
    const live = await request(app).get("/api/health/live");
    assert.equal(live.status, 200);
    assert.deepEqual(live.body, { status: "ok" });
    assert.equal(live.headers["cache-control"], "no-store");

    const res = await request(app).get("/api/health");
    assert.equal(res.status, 503);
    assert.equal(res.body.status, "down");
});
