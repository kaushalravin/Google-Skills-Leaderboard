const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const { TEST_ADMIN_KEY } = require("../helpers/env");

const SERVER_ENTRY = path.resolve(__dirname, "../../index.js");

const APP_ENV_KEYS = /^(NODE_ENV|PORT|MONGO_|LOG_LEVEL|ADMIN_API_KEY|CORS_|TRUST_PROXY|COMPETITION_|CRAWL_|CRON_|LOCK_|RATE_LIMIT_|SUSPICIOUS_|STALE_|TZ$)/;

/** Spawns the real entry point with a clean app env and no .env file. */
function startServer(env) {
    const base = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !APP_ENV_KEYS.test(key))
    );
    const child = spawn(process.execPath, [SERVER_ENTRY], {
        env: { ...base, ENV_FILE: "", ...env },
        stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdoutText = "";
    child.stderrText = "";
    child.stdout.on("data", (d) => (child.stdoutText += d));
    child.stderr.on("data", (d) => (child.stderrText += d));
    child.exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
    return child;
}

function logLines(text) {
    return text
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line));
}

let replSet;

before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
});

after(async () => {
    await replSet?.stop();
});

test("boot without MONGO_URI exits 1 with a clear message", async () => {
    const child = startServer({ ADMIN_API_KEY: TEST_ADMIN_KEY });
    assert.equal(await child.exited, 1);
    assert.match(child.stderrText, /Invalid environment configuration/);
    assert.match(child.stderrText, /MONGO_URI is required/);
});

test("boot with an invalid env lists every problem and exits 1", async () => {
    const child = startServer({ MONGO_URI: "nope", ADMIN_API_KEY: "short", PORT: "x" });
    assert.equal(await child.exited, 1);
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
    assert.equal(await child.exited, 1);
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

    const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no listen log:\n${child.stdoutText}${child.stderrText}`)), 30000);
        child.stdout.on("data", () => {
            const listening = logLines(child.stdoutText).find((l) => l.msg === "server listening");
            if (listening) {
                clearTimeout(timer);
                resolve(listening.port);
            }
        });
        child.exited.then((code) => reject(new Error(`server exited ${code}:\n${child.stderrText}`)));
    });

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
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no listen log:\n${child.stdoutText}${child.stderrText}`)), 60000);
        child.stdout.on("data", () => {
            if (logLines(child.stdoutText).some((l) => l.msg === "server listening")) {
                clearTimeout(timer);
                resolve();
            }
        });
        child.exited.then((code) => reject(new Error(`server exited ${code}:\n${child.stderrText}`)));
    });

    const unique = (await client.db(dbName).collection("users").indexes()).filter((i) => i.unique).map((i) => Object.keys(i.key)[0]);
    assert.deepEqual(unique.sort(), ["email", "skillsEmail", "skillsUrl"]);
    const userBadgeIndexes = await client.db(dbName).collection("userbadges").indexes();
    assert.ok(userBadgeIndexes.some((i) => i.unique && i.key.user === 1 && i.key.badge === 1));
});
