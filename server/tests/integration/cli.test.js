const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { MongoClient } = require("mongodb");

const { TEST_ADMIN_KEY } = require("../helpers/env");

const CRAWL_ONCE = path.resolve(__dirname, "../../scripts/crawl-once.js");
const CHECK_REAL = path.resolve(__dirname, "../../scripts/check-real.js");
let replSet;

before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
});

after(async () => {
    await replSet?.stop();
});

/** Runs a script with an isolated env; resolves { code, stdout, stderr } even on a non-zero exit. */
async function runScript(script, args, uri) {
    try {
        const { stdout, stderr } = await promisify(execFile)(process.execPath, [script, ...args], {
            env: { ...process.env, ENV_FILE: "", MONGO_URI: uri, ADMIN_API_KEY: TEST_ADMIN_KEY, LOG_LEVEL: "silent" }
        });
        return { code: 0, stdout, stderr };
    } catch (err) {
        if (typeof err.code !== "number") throw err;
        return { code: err.code, stdout: err.stdout, stderr: err.stderr };
    }
}

/** A DB whose crawl lock is held by a running cron crawl (no users, so nothing would scrape). */
async function dbWithHeldLock(t, dbName) {
    const uri = replSet.getUri(dbName);
    const client = await MongoClient.connect(uri);
    t.after(() => client.close());
    const db = client.db(dbName);
    const lock = {
        _id: "crawl",
        owner: "someone-else",
        meta: { runId: "held-run", trigger: "cron", triggeredBy: "cron" },
        acquiredAt: new Date(),
        heartbeatAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    };
    await db.collection("job_locks").insertOne(lock);
    return { uri, db, lock };
}

test("crawl:once --dry-run runs while the lock is held, takes no lock and writes no crawler_logs", async (t) => {
    const { uri, db, lock } = await dbWithHeldLock(t, "dry-held");
    const res = await runScript(CRAWL_ONCE, ["--dry-run"], uri);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stderr, /DRY RUN/);
    assert.match(res.stdout, /"total": 0/);
    assert.deepEqual(await db.collection("job_locks").findOne({ _id: "crawl" }), lock);
    assert.deepEqual((await db.listCollections().toArray()).map((c) => c.name), ["job_locks"]);
});

test("check:real runs while the lock is held, takes no lock and writes no crawler_logs", async (t) => {
    const { uri, db, lock } = await dbWithHeldLock(t, "check-held");
    const res = await runScript(CHECK_REAL, [], uri);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /No data was written\./);
    assert.deepEqual(await db.collection("job_locks").findOne({ _id: "crawl" }), lock);
    assert.deepEqual((await db.listCollections().toArray()).map((c) => c.name), ["job_locks"]);
});

test("crawl:once (real) exits 2 and prints the holder when the lock is held, writing nothing", async (t) => {
    const { uri, db, lock } = await dbWithHeldLock(t, "real-held");
    const res = await runScript(CRAWL_ONCE, [], uri);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /Another crawl holds the lock/);
    assert.match(res.stderr, /held-run/);
    assert.deepEqual(await db.collection("job_locks").findOne({ _id: "crawl" }), lock);
    assert.equal(await db.collection("crawler_logs").countDocuments(), 0);
});

test("crawl:once (real) goes through the lock: a cli crawler_log is written and the lock released", async (t) => {
    const uri = replSet.getUri("real-free");
    const res = await runScript(CRAWL_ONCE, [], uri);
    assert.equal(res.code, 0, res.stderr);

    const client = await MongoClient.connect(uri);
    t.after(() => client.close());
    const db = client.db("real-free");
    const logs = await db.collection("crawler_logs").find().toArray();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].trigger, "cli");
    assert.equal(logs[0].status, "success");
    const lockDoc = await db.collection("job_locks").findOne({ _id: "crawl" });
    assert.equal(lockDoc.owner, null);
    assert.ok(lockDoc.expiresAt <= new Date());
});

test("crawl:once --dry-run is read-only: no collections or indexes are created", async () => {
    const uri = replSet.getUri("dryrun");
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [CRAWL_ONCE, "--dry-run"], {
        env: { ...process.env, ENV_FILE: "", MONGO_URI: uri, ADMIN_API_KEY: TEST_ADMIN_KEY, LOG_LEVEL: "silent" }
    });
    assert.match(stderr, /DRY RUN/);
    assert.match(stdout, /"total": 0/);

    const client = await MongoClient.connect(uri);
    try {
        assert.deepEqual(await client.db("dryrun").listCollections().toArray(), []);
    } finally {
        await client.close();
    }
});
