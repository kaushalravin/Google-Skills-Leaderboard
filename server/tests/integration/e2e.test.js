require("../../config/timezone");

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout: sleep } = require("node:timers/promises");
const request = require("supertest");

const { startMongo } = require("../helpers/mongo");
const { buildTestApp } = require("../helpers/app");
const { TEST_ADMIN_KEY, testConfig } = require("../helpers/env");
const { User } = require("../../models/users");
const { Badge } = require("../../models/badges");
const { UserBadge } = require("../../models/userBadges");
const { settingsFromConfig } = require("../../services/crawl");

const COMPUTE = "The Basics of Google Cloud Compute";
const WEBSITE = "Build a Website on Google Cloud";
const VISION = "Analyze Images with the Cloud Vision API";

let mongo;

before(async () => {
    mongo = await startMongo();
    await Promise.all([User.init(), Badge.init(), UserBadge.init()]);
});

after(async () => {
    await mongo?.stop();
});

const scraped = (name, date) => ({
    externalId: String(name.length),
    name,
    badgeUrl: `https://www.skills.google/public_profiles/x/badges/${name.length}`,
    imageUrl: `https://cdn.example/${name.length}.png`,
    earnedAt: new Date(date)
});

test("ingest → POST /api/admin/crawl → status done → GET /api/leaderboard ranks → health ok", async () => {
    const people = {
        asha: [scraped(COMPUTE, "2026-10-27"), scraped(WEBSITE, "2026-10-28")],
        ezra: [scraped(COMPUTE, "2026-10-26"), scraped(WEBSITE, "2026-10-28")], // same count, credits, latest date as asha → tie
        ben: [scraped(COMPUTE, "2026-10-27"), scraped(WEBSITE, "2026-10-30")], // same count, later → below
        chen: [scraped(VISION, "2026-10-29"), scraped(COMPUTE, "2026-10-20")], // one valid (pre-start excluded)
        dana: []
    };
    // The crawler only ever sees canonical URLs, whatever form the Google Form submitted.
    const scrape = async (url) => people[url.match(/public_profiles\/(\w+)-0000$/)[1]];
    const crawlOptions = { ...settingsFromConfig(testConfig()), minGapMs: 0 };

    const { app } = buildTestApp({}, {
        crawlDeps: { scrape, crawlOptions }
    });
    const admin = (req) => req.set("x-admin-key", TEST_ADMIN_KEY);

    const variants = [
        (id) => `https://www.skills.google/public_profiles/${id}`,
        (id) => `http://cloudskillsboost.google/public_profiles/${id}/`,
        (id) => `https://skills.google/public_profiles/${id}?utm_source=form`
    ];
    const ingested = await admin(request(app).post("/api/admin/participants")).send({
        participants: Object.keys(people).map((name, i) => ({
            username: name,
            email: `${name}@example.com`,
            skillsEmail: `${name}@skills.example.com`,
            profileUrl: variants[i % variants.length](`${name}-0000`)
        }))
    });
    assert.equal(ingested.status, 200);
    assert.deepEqual(
        { inserted: ingested.body.inserted, updated: ingested.body.updated, rejected: ingested.body.rejected },
        { inserted: 5, updated: 0, rejected: [] }
    );

    const before = await request(app).get("/api/health");
    assert.equal(before.body.status, "degraded", "no successful crawl yet");

    // Ingestion rebuilt the snapshot: everyone listed with 0 badges, no crawl time faked.
    const fresh = await request(app).get("/api/leaderboard");
    assert.equal(fresh.status, 200);
    assert.equal(fresh.body.lastSuccessfulUpdate, null);
    assert.deepEqual(fresh.body.rows.map((r) => [r.rank, r.validBadgeCount]), Array(5).fill([1, 0]));

    const started = await admin(request(app).post("/api/admin/crawl"));
    assert.equal(started.status, 202);
    assert.ok(started.body.runId);

    let status;
    for (let i = 0; i < 100; i++) {
        status = (await admin(request(app).get("/api/admin/crawl/status"))).body;
        if (status.latestRun?.runId === started.body.runId && status.latestRun.status !== "running" && !status.lock.held) break;
        await sleep(50);
    }
    assert.equal(status.latestRun.status, "success");
    assert.equal(status.lock.held, false);
    assert.ok(status.lastSuccessfulUpdate);

    const board = await request(app).get("/api/leaderboard");
    assert.equal(board.status, 200);
    assert.equal(board.body.lastSuccessfulUpdate, status.lastSuccessfulUpdate);
    assert.deepEqual(
        board.body.rows.map((r) => [r.rank, r.username, r.validBadgeCount, r.validCredits]),
        [
            [1, "asha", 2, 17],
            [1, "ezra", 2, 17],
            [3, "ben", 2, 17],
            [4, "chen", 1, 12],
            [5, "dana", 0, 0]
        ]
    );
    assert.doesNotMatch(JSON.stringify(board.body), /@/, "no emails on the public API");

    // The crawl also persisted badges and the competition-valid badgeCount.
    assert.equal((await User.findOne({ username: "chen" }).lean()).badgeCount, 1);
    assert.equal(await UserBadge.countDocuments(), 8);

    const health = await request(app).get("/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.status, "ok");
    assert.equal(health.body.lastSuccessfulUpdate, status.lastSuccessfulUpdate);
    assert.equal(health.body.crawl.inProgress, false);
    assert.equal(health.body.latestRun.status, "success");
});
