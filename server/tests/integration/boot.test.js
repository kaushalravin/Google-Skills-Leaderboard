const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const { TEST_ADMIN_KEY } = require("../helpers/env");
const { startServer, logLines, waitForListening } = require("../helpers/childProcess");

let replSet;

before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
});

after(async () => {
    await replSet?.stop();
});

test("boot without MONGO_URI exits 1 with a clear message", async () => {
    const child = startServer({ ADMIN_API_KEY: TEST_ADMIN_KEY });
    assert.equal((await child.exited).code, 1);
    assert.match(child.stderrText, /Invalid environment configuration/);
    assert.match(child.stderrText, /MONGO_URI is required/);
});

test("boot with an invalid env lists every problem and exits 1", async () => {
    const child = startServer({ MONGO_URI: "nope", ADMIN_API_KEY: "short", PORT: "x" });
    assert.equal((await child.exited).code, 1);
    assert.match(child.stderrText, /MONGO_URI must start with mongodb/);
    assert.match(child.stderrText, /ADMIN_API_KEY must be at least 32 characters/);
    assert.match(child.stderrText, /PORT /);
});

test("boot with an unreachable MongoDB exits 1 instead of listening", async () => {
    const child = startServer({
        MONGO_URI: "mongodb://127.0.0.1:1/leaderboard",
        MONGO_SERVER_SELECTION_TIMEOUT_MS: "500",
        ADMIN_API_KEY: TEST_ADMIN_KEY
    });
    assert.equal((await child.exited).code, 1);
    const lines = logLines(child.stdoutText);
    assert.ok(lines.some((l) => l.msg === "MongoDB connection failed" && l.level === 60));
    assert.ok(!lines.some((l) => l.msg === "server listening"));
});

test("boot against the memory server listens and serves the 404 error shape", async (t) => {
    const child = startServer({
        MONGO_URI: replSet.getUri("leaderboard-boot"),
        ADMIN_API_KEY: TEST_ADMIN_KEY,
        PORT: "0"
    });
    t.after(() => child.kill());

    const { port } = await waitForListening(child, 30000);

    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, "NOT_FOUND");
    assert.equal(body.error.requestId, res.headers.get("x-request-id"));

    const lines = logLines(child.stdoutText);
    assert.ok(lines.some((l) => l.msg === "MongoDB connected"));
    assert.ok(!child.stdoutText.includes(TEST_ADMIN_KEY), "admin key must never be logged");
});

test("the server listens only once the unique indexes exist, so first requests can't create duplicates", async (t) => {
    // A fresh database with enough rows that building the indexes takes a noticeable time.
    const dbName = "leaderboard-indexes";
    const { MongoClient } = require("mongodb");
    const client = await MongoClient.connect(replSet.getUri());
    t.after(() => client.close());
    const users = Array.from({ length: 100000 }, (_, i) => ({
        username: `u${i}`,
        email: `u${i}@example.com`,
        skillsEmail: `u${i}.skills@example.com`,
        skillsUrl: `https://www.skills.google/public_profiles/u${i}`,
        badgeCount: 0,
        credits: 0
    }));
    await client.db(dbName).collection("users").insertMany(users, { ordered: false });

    const child = startServer({ MONGO_URI: replSet.getUri(dbName), ADMIN_API_KEY: TEST_ADMIN_KEY, PORT: "0", CRON_ENABLED: "false" });
    t.after(() => child.kill());
    await waitForListening(child, 60000);

    const unique = (await client.db(dbName).collection("users").indexes()).filter((i) => i.unique).map((i) => Object.keys(i.key)[0]);
    assert.deepEqual(unique.sort(), ["email", "skillsEmail", "skillsUrl"]);
    const userBadgeIndexes = await client.db(dbName).collection("userbadges").indexes();
    assert.ok(userBadgeIndexes.some((i) => i.unique && i.key.user === 1 && i.key.badge === 1));
});
