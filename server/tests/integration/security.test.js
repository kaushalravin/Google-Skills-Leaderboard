require("../../config/timezone");

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { startMongo } = require("../helpers/mongo");
const { buildTestApp } = require("../helpers/app");
const { TEST_ADMIN_KEY } = require("../helpers/env");

let mongo;

before(async () => {
    mongo = await startMongo();
});

after(async () => {
    await mongo?.stop();
});

function assertRateLimited(res) {
    assert.equal(res.status, 429);
    assert.equal(res.body.error.code, "RATE_LIMITED");
    assert.equal(typeof res.body.error.message, "string");
    assert.equal(res.body.error.requestId, res.headers["x-request-id"]);
    assert.ok(res.headers["retry-after"], "Retry-After header is set");
}

test("public rate limit: requests over RATE_LIMIT_PUBLIC_PER_MIN get 429 in the standard error shape", async () => {
    const { app } = buildTestApp({ RATE_LIMIT_PUBLIC_PER_MIN: "3" });
    for (let i = 0; i < 3; i++) {
        const res = await request(app).get("/api/leaderboard");
        assert.equal(res.status, 200);
        assert.ok(res.headers["ratelimit-policy"], "standard RateLimit headers are sent");
    }
    assertRateLimited(await request(app).get("/api/leaderboard"));
    assertRateLimited(await request(app).get("/api/leaderboard/000000000000000000000000"));

    // Each app gets its own store: a fresh app starts with a fresh budget.
    const fresh = buildTestApp({ RATE_LIMIT_PUBLIC_PER_MIN: "3" }).app;
    assert.equal((await request(fresh).get("/api/leaderboard")).status, 200);
});

test("admin brute force is throttled before auth: after N wrong keys even the right key gets 429", async () => {
    const { app } = buildTestApp({ RATE_LIMIT_ADMIN_PER_MIN: "3" });
    for (let i = 0; i < 3; i++) {
        const res = await request(app).get("/api/admin/crawl/status").set("x-admin-key", `wrong-${i}`);
        assert.equal(res.status, 401);
    }
    const res = await request(app).get("/api/admin/crawl/status").set("x-admin-key", TEST_ADMIN_KEY);
    assertRateLimited(res);

    // The public limiter is separate: admin throttling doesn't block the leaderboard.
    assert.equal((await request(app).get("/api/leaderboard")).status, 200);

    // Sanity: with budget left, the right key is accepted.
    const ok = await request(buildTestApp({ RATE_LIMIT_ADMIN_PER_MIN: "3" }).app)
        .get("/api/admin/crawl/status")
        .set("x-admin-key", TEST_ADMIN_KEY);
    assert.equal(ok.status, 200);
});

test("helmet headers are set and x-powered-by is absent", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/leaderboard");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.ok(res.headers["content-security-policy"]);
    assert.ok(res.headers["strict-transport-security"]);
    assert.equal(res.headers["x-frame-options"], "SAMEORIGIN");
    assert.equal(res.headers["x-powered-by"], undefined);
});

test("CORS: allowlisted origin is reflected, others are not allowed", async () => {
    const { app } = buildTestApp({ CORS_ORIGINS: "https://leaderboard.example.com, https://admin.example.com" });

    const allowed = await request(app).get("/api/leaderboard").set("Origin", "https://admin.example.com");
    assert.equal(allowed.headers["access-control-allow-origin"], "https://admin.example.com");

    const denied = await request(app).get("/api/leaderboard").set("Origin", "https://evil.example.com");
    assert.equal(denied.headers["access-control-allow-origin"], undefined);

    const preflight = await request(app)
        .options("/api/admin/crawl")
        .set("Origin", "https://evil.example.com")
        .set("Access-Control-Request-Method", "POST")
        .set("Access-Control-Request-Headers", "x-admin-key");
    assert.equal(preflight.headers["access-control-allow-origin"], undefined);
});

test("CORS: an empty CORS_ORIGINS allows any origin", async () => {
    const { app } = buildTestApp({ CORS_ORIGINS: "" });
    const res = await request(app).get("/api/leaderboard").set("Origin", "https://anything.example.org");
    assert.equal(res.status, 200);
    assert.equal(res.headers["access-control-allow-origin"], "*");
});
