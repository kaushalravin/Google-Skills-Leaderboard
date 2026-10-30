require("../../config/timezone");

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout: sleep } = require("node:timers/promises");
const request = require("supertest");

const { buildTestApp } = require("../helpers/app");
const { startMongo } = require("../helpers/mongo");
const { TEST_ADMIN_KEY } = require("../helpers/env");
const { User } = require("../../models/users");
const { CrawlerLog } = require("../../models/crawlerLog");
const { getLockState } = require("../../services/lock");
const { JobLock } = require("../../models/jobLock");
const { startCrawl } = require("../../services/crawlRunner");

const CRAWL_OPTIONS = { minGapMs: 0, maxRetries: 0, startDate: "2026-10-26" };

let mongo;
let app;
const rebuildCalls = [];

before(async () => {
    mongo = await startMongo();
    await CrawlerLog.init();
    ({ app } = buildTestApp(
        { CRAWL_MIN_GAP_MS: "0" },
        {
            crawlDeps: {
                scrape: async () => [],
                rebuildLeaderboard: async (args) => {
                    rebuildCalls.push(args);
                }
            }
        }
    ));
});

after(async () => {
    await mongo?.stop();
});

beforeEach(async () => {
    await Promise.all([User.deleteMany({}), CrawlerLog.deleteMany({}), JobLock.collection.deleteMany({})]);
    rebuildCalls.length = 0;
});

function assertErrorShape(res, status, code) {
    assert.equal(res.status, status);
    assert.equal(res.body.error.code, code);
    assert.equal(typeof res.body.error.message, "string");
    assert.equal(res.body.error.requestId, res.headers["x-request-id"]);
}

async function waitForRun(runId) {
    for (let i = 0; i < 100; i++) {
        const log = await CrawlerLog.findOne({ runId }).lean();
        if (log && log.status !== "running" && !(await getLockState("crawl")).held) return log;
        await sleep(20);
    }
    throw new Error(`run ${runId} did not finish`);
}

test("missing, wrong and almost-right admin keys get 401 with the standard error shape", async () => {
    const almost = TEST_ADMIN_KEY.slice(0, -1) + (TEST_ADMIN_KEY.endsWith("a") ? "b" : "a");
    const cases = [
        ["GET", "/api/admin/crawl/status", undefined],
        ["GET", "/api/admin/crawl/status", "wrong"],
        ["GET", "/api/admin/crawl/status", almost],
        ["GET", "/api/admin/crawl/status", TEST_ADMIN_KEY + "x"],
        ["GET", "/api/admin/crawl/status", ""],
        ["POST", "/api/admin/crawl", undefined],
        ["POST", "/api/admin/crawl", almost],
        ["GET", "/api/admin/crawl/logs", almost]
    ];
    for (const [method, path, key] of cases) {
        let req = method === "GET" ? request(app).get(path) : request(app).post(path);
        if (key !== undefined) req = req.set("x-admin-key", key);
        const res = await req;
        assertErrorShape(res, 401, "UNAUTHORIZED");
        assert.equal(res.headers["cache-control"], "no-store");
    }
    assert.equal(await CrawlerLog.countDocuments(), 0, "no crawl was started");
});

test("POST /crawl starts a manual run: 202 {runId}, no-store, log written, rebuild called", async () => {
    await User.create({ username: "A", email: "a@x.io", skillsEmail: "a@s.io", skillsUrl: "https://www.skills.google/public_profiles/a" });
    const res = await request(app).post("/api/admin/crawl").set("x-admin-key", TEST_ADMIN_KEY);
    assert.equal(res.status, 202);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.deepEqual(Object.keys(res.body), ["runId"]);

    const log = await waitForRun(res.body.runId);
    assert.equal(log.trigger, "manual");
    assert.equal(log.triggeredBy, "admin");
    assert.equal(log.status, "success");
    assert.equal(rebuildCalls.length, 1);
});

test("while a cron run holds the lock, a manual POST /crawl gets 409 with the holder", async () => {
    await User.create({ username: "A", email: "a@x.io", skillsEmail: "a@s.io", skillsUrl: "https://www.skills.google/public_profiles/a" });
    let releaseScrape;
    const gate = new Promise((resolve) => (releaseScrape = resolve));
    const cronRun = await startCrawl(
        { trigger: "cron", triggeredBy: "cron" },
        { crawlOptions: CRAWL_OPTIONS, scrape: async () => { await gate; return []; }, rebuildLeaderboard: async () => {} }
    );
    assert.equal(cronRun.started, true);
    const holder = await getLockState("crawl");

    const res = await request(app).post("/api/admin/crawl").set("x-admin-key", TEST_ADMIN_KEY);
    assertErrorShape(res, 409, "CRAWL_IN_PROGRESS");
    assert.deepEqual(res.body.error.details, { trigger: "cron", since: holder.acquiredAt.toISOString() });

    const status = await request(app).get("/api/admin/crawl/status").set("x-admin-key", TEST_ADMIN_KEY);
    assert.equal(status.status, 200);
    assert.equal(status.body.lock.held, true);
    assert.equal(status.body.lock.meta.runId, cronRun.runId);
    assert.equal(status.body.latestRun.runId, cronRun.runId);
    assert.equal(status.body.latestRun.status, "running");
    assert.equal(status.body.lastSuccessfulUpdate, null);

    releaseScrape();
    await cronRun.done;
    assert.equal(await CrawlerLog.countDocuments(), 1, "the refused request started no run");

    const after = await request(app).post("/api/admin/crawl").set("x-admin-key", TEST_ADMIN_KEY);
    assert.equal(after.status, 202);
    await waitForRun(after.body.runId);
});

test("GET /crawl/status reports the free lock, latest run and lastSuccessfulUpdate", async () => {
    const t = (iso) => new Date(iso);
    await CrawlerLog.create([
        { runId: "a", trigger: "cron", status: "success", startedAt: t("2026-10-28T00:00Z"), finishedAt: t("2026-10-28T00:05Z") },
        { runId: "b", trigger: "cron", status: "failed", startedAt: t("2026-10-28T06:00Z"), finishedAt: t("2026-10-28T06:01Z") }
    ]);
    const res = await request(app).get("/api/admin/crawl/status").set("x-admin-key", TEST_ADMIN_KEY);
    assert.equal(res.status, 200);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.deepEqual(res.body.lock, { held: false, acquiredAt: null, expiresAt: null, meta: null });
    assert.equal(res.body.latestRun.runId, "b");
    assert.equal(res.body.lastSuccessfulUpdate, "2026-10-28T00:05:00.000Z");
});

test("GET /crawl/logs: newest first, limit validated, no failures arrays", async () => {
    const docs = Array.from({ length: 25 }, (_, i) => ({
        runId: `r${i}`,
        trigger: "cron",
        status: "partial",
        startedAt: new Date(Date.UTC(2026, 9, 27, i)),
        failures: [{ userId: "u", reason: "http_404", httpStatus: 404 }]
    }));
    await CrawlerLog.create(docs);

    const def = await request(app).get("/api/admin/crawl/logs").set("x-admin-key", TEST_ADMIN_KEY);
    assert.equal(def.status, 200);
    assert.equal(def.headers["cache-control"], "no-store");
    assert.equal(def.body.runs.length, 20);
    assert.equal(def.body.runs[0].runId, "r24");
    assert.ok(def.body.runs.every((r) => r.failures === undefined && r._id === undefined));

    const three = await request(app).get("/api/admin/crawl/logs?limit=3").set("x-admin-key", TEST_ADMIN_KEY);
    assert.deepEqual(three.body.runs.map((r) => r.runId), ["r24", "r23", "r22"]);

    for (const bad of ["0", "101", "abc", "2.5"]) {
        const res = await request(app).get(`/api/admin/crawl/logs?limit=${bad}`).set("x-admin-key", TEST_ADMIN_KEY);
        assertErrorShape(res, 400, "VALIDATION_ERROR");
    }
});
