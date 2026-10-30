require("../../config/timezone");

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const { connectDb, disconnectDb } = require("../../config/db");
const { TEST_ADMIN_KEY } = require("../helpers/env");
const { User } = require("../../models/users");
const { CrawlerLog } = require("../../models/crawlerLog");
const { getLockState } = require("../../services/lock");

const SERVER_ENTRY = path.resolve(__dirname, "../../index.js");
const APP_ENV_KEYS = /^(NODE_ENV|PORT|MONGO_|LOG_LEVEL|ADMIN_API_KEY|CORS_|TRUST_PROXY|COMPETITION_|CRAWL_|CRON_|LOCK_|RATE_LIMIT_|SUSPICIOUS_|STALE_|TZ$)/;
const PROFILE_DELAY_MS = 1500;
const USERS = 5;

let replSet;
let profiles; // local stand-in for the profile site: slow, harmless, no badges
const profileHits = [];

before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await connectDb(replSet.getUri("leaderboard-shutdown"));

    profiles = http.createServer((req, res) => {
        profileHits.push(req.url);
        setTimeout(() => res.end("<html><body>no badges</body></html>"), PROFILE_DELAY_MS);
    });
    await new Promise((resolve) => profiles.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${profiles.address().port}/public_profiles`;

    // The protected scraper just axios.get()s skillsUrl, so a local URL works as-is.
    await User.insertMany(
        Array.from({ length: USERS }, (_, i) => ({
            username: `user${i}`,
            email: `u${i}@example.com`,
            skillsEmail: `u${i}@skills.example.com`,
            skillsUrl: `${base}/u${i}`
        }))
    );
});

after(async () => {
    profiles?.closeAllConnections();
    profiles?.close();
    await disconnectDb();
    await replSet?.stop();
});

function startServer() {
    const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => !APP_ENV_KEYS.test(key)));
    const child = spawn(process.execPath, [SERVER_ENTRY], {
        env: {
            ...base,
            ENV_FILE: "",
            NO_PROXY: "127.0.0.1,localhost",
            NODE_ENV: "test",
            PORT: "0",
            MONGO_URI: replSet.getUri("leaderboard-shutdown"),
            ADMIN_API_KEY: TEST_ADMIN_KEY,
            CRON_ENABLED: "false",
            CRAWL_CONCURRENCY: "1",
            CRAWL_MIN_GAP_MS: "0",
            CRAWL_MAX_RETRIES: "0"
        },
        // The IPC channel is only used on Windows (see sendShutdown).
        stdio: ["ignore", "pipe", "pipe", "ipc"]
    });
    child.stdoutText = "";
    child.stderrText = "";
    child.stdout.on("data", (d) => (child.stdoutText += d));
    child.stderr.on("data", (d) => (child.stderrText += d));
    child.exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
    return child;
}

const logLines = (text) =>
    text.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));

function waitFor(check, what, ms = 30000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            clearInterval(poll);
            reject(new Error(`timed out waiting for ${what}`));
        }, ms);
        const poll = setInterval(() => {
            const value = check();
            if (value) {
                clearInterval(poll);
                clearTimeout(timer);
                resolve(value);
            }
        }, 20);
    });
}

/**
 * A real SIGTERM where the platform can deliver one. On Windows child.kill("SIGTERM")
 * is TerminateProcess (uncatchable), so the test sends the "shutdown" IPC message that
 * server.js only listens for when NODE_ENV=test; it runs the same shutdown path.
 */
function sendShutdown(child) {
    if (process.platform === "win32") child.send("shutdown");
    else child.kill("SIGTERM");
}

test("graceful shutdown aborts the in-flight crawl, logs it 'aborted', releases the lock and exits 0", async (t) => {
    const child = startServer();
    t.after(() => child.exitCode === null && child.kill("SIGKILL"));

    const listening = await Promise.race([
        waitFor(() => logLines(child.stdoutText).find((l) => l.msg === "server listening"), "listen"),
        child.exited.then((e) => {
            throw new Error(`server exited ${e.code}:\n${child.stderrText}`);
        })
    ]);
    const baseUrl = `http://127.0.0.1:${listening.port}`;

    const res = await fetch(`${baseUrl}/api/admin/crawl`, { method: "POST", headers: { "x-admin-key": TEST_ADMIN_KEY } });
    assert.equal(res.status, 202);
    const { runId } = await res.json();

    // A profile request is in flight: the crawl is running and holds the lock.
    await waitFor(() => profileHits.length >= 1, "the first profile request");
    assert.equal((await getLockState("crawl")).held, true);
    assert.equal((await CrawlerLog.findOne({ runId }).lean()).status, "running");

    sendShutdown(child);
    const exit = await child.exited;
    assert.deepEqual(exit, { code: 0, signal: null }, child.stderrText);

    const log = await CrawlerLog.findOne({ runId }).lean();
    assert.equal(log.status, "aborted");
    assert.ok(log.finishedAt);
    assert.equal((await getLockState("crawl")).held, false);
    assert.ok(profileHits.length < USERS, `no new users after the abort (hits: ${profileHits.length})`);

    const msgs = logLines(child.stdoutText).map((l) => l.msg);
    assert.ok(msgs.includes("shutting down"));
    assert.ok(msgs.includes("shutdown complete"));
    assert.ok(!msgs.includes("graceful shutdown timed out; forcing exit"));
});
