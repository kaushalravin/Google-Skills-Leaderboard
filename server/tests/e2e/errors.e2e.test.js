const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { setTimeout: sleep } = require("node:timers/promises");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const {
    startHarness,
    spawnServer,
    badge,
    participant,
    assertPublicResponsesClean,
    assertNoInternals,
    assertErrorShape,
    ADMIN_KEY
} = require("./helpers/harness");

let h;
before(async () => {
    h = await startHarness();
});
after(async () => {
    await h?.stop();
});

test("malformed JSON → 400, oversized body → 413, unknown route → 404, all in the standard error shape", async () => {
    const s = await h.newServer();
    assertErrorShape(await s.post("/api/admin/participants", { rawBody: '{"username": "x",', admin: true }), 400, "INVALID_JSON");
    assertErrorShape(await s.post("/api/leaderboard", { rawBody: "{not json" }), 400, "INVALID_JSON");

    const big = JSON.stringify({ pad: "x".repeat(200 * 1024) });
    assertErrorShape(await s.post("/api/leaderboard", { rawBody: big }), 413, "PAYLOAD_TOO_LARGE");
    const huge = JSON.stringify({ participants: [], pad: "x".repeat(1100 * 1024) });
    assertErrorShape(await s.post("/api/admin/participants", { rawBody: huge, admin: true }), 413, "PAYLOAD_TOO_LARGE");

    assertErrorShape(await s.get("/api/nope"), 404, "NOT_FOUND");
    assertErrorShape(await s.get("/"), 404, "NOT_FOUND");
    assertErrorShape(await s.request("DELETE", "/api/leaderboard"), 404, "NOT_FOUND");
});

test("error responses never expose stack traces, paths, Mongo errors or internal messages", async () => {
    const s = await h.newServer();
    s.setProfiles({});
    await s.ingest(participant("first", "First"));
    const responses = [
        await s.get("/api/leaderboard/not-an-id"),
        await s.get("/api/leaderboard/0123456789abcdef01234567"),
        await s.get("/api/leaderboard?page=0&limit=1000"),
        await s.get("/api/leaderboard/%E0%A4%A"),
        await s.get("/api/admin/crawl/logs?limit=abc", { admin: true }),
        await s.post("/api/admin/participants", { body: { username: "Dup", email: "first@example.com", skillsEmail: "x@example.com", profileUrl: "https://www.skills.google/public_profiles/dup" }, admin: true }),
        await s.post("/api/admin/participants", { body: "just a string", admin: true }),
        await s.post("/api/admin/participants", { rawBody: "[1,", admin: true }),
        await s.post("/api/admin/crawl", { headers: { "x-admin-key": "x".repeat(10000) } })
    ];
    for (const res of responses) {
        assert.ok(res.status >= 400, `${res.status} ${res.text}`);
        assert.ok(res.body?.error?.code, res.text);
        assertNoInternals(res.text, res.text.slice(0, 80));
    }
    assert.equal(responses[3].status, 400, "a malformed URL is a client error");
    // The email conflict is reported by reason only.
    assert.equal(responses[5].body.error.details.rejected[0].reason, "email_in_use_by_other_profile");
});

async function freePort() {
    return new Promise((resolve) => {
        const srv = net.createServer().listen(0, () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

test("with MongoDB stopped, health is 503 'down' and /live stays 200; requests fail opaquely; health recovers after restore", async () => {
    const port = await freePort();
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ port }] });
    const server = await spawnServer({
        ENV_FILE: "",
        NODE_ENV: "test",
        PORT: "0",
        LOG_LEVEL: "info",
        MONGO_URI: replSet.getUri("outage"),
        MONGO_SERVER_SELECTION_TIMEOUT_MS: "2000",
        ADMIN_API_KEY: ADMIN_KEY,
        CRON_ENABLED: "false"
    });
    const get = async (p) => {
        const res = await fetch(server.baseUrl + p);
        const text = await res.text();
        return { status: res.status, text, body: JSON.parse(text) };
    };
    try {
        assert.equal((await get("/api/health")).status, 200);

        // Stop and restart only the member process on the same port and data directory, so the
        // replica set comes back with its stored config (no re-initiation).
        const [member] = replSet.servers;
        await member.stop({ doCleanup: false, force: false });
        let health;
        for (let i = 0; i < 40; i++) {
            health = await get("/api/health");
            if (health.status === 503) break;
            await sleep(250);
        }
        assert.equal(health.status, 503, health.text);
        assert.equal(health.body.status, "down");
        assert.equal(health.body.db.ok, false);
        assertNoInternals(health.text, "health while down");

        const live = await get("/api/health/live");
        assert.deepEqual([live.status, live.body], [200, { status: "ok" }]);

        const board = await get("/api/leaderboard");
        assert.equal(board.status, 500, board.text);
        assert.deepEqual(board.body.error.code, "INTERNAL_ERROR");
        assert.equal(board.body.error.message, "Internal server error");
        assertNoInternals(board.text, "leaderboard while down");

        // Re-election plus driver rediscovery can take a while when the machine is busy.
        await member.start(true);
        for (let i = 0; i < 240; i++) {
            health = await get("/api/health");
            if (health.status === 200) break;
            await sleep(250);
        }
        assert.equal(health.status, 200, health.text);
        assert.equal(health.body.db.ok, true);
        assert.equal((await get("/api/leaderboard")).status, 200);
    } finally {
        await server.kill();
        await replSet.stop();
    }
});

test("health is 'degraded' before any successful crawl and 'ok' after one, with lastSuccessfulUpdate", async () => {
    const s = await h.newServer();
    s.setProfiles({ one: { badges: [badge("Build a Website on Google Cloud", "Oct 27, 2026")] } });
    await s.ingest(participant("one", "One"));

    const before = await s.get("/api/health");
    assert.equal(before.status, 200);
    assert.equal(before.body.status, "degraded");
    assert.equal(before.body.lastSuccessfulUpdate, null);
    assert.equal(before.headers.get("cache-control"), "no-store");

    const run = await s.crawl();
    const afterCrawl = await s.get("/api/health");
    assert.equal(afterCrawl.body.status, "ok");
    assert.equal(afterCrawl.body.lastSuccessfulUpdate, run.finishedAt);
    assert.equal(afterCrawl.body.latestRun.status, "success");
    assert.equal(afterCrawl.body.crawl.inProgress, false);
    assert.equal(afterCrawl.body.db.ok, true);
});

test("no public response in this file contained an email, '@' or internal details", () => {
    assertPublicResponsesClean();
});
