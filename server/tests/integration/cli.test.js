const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { MongoClient } = require("mongodb");

const { runScript } = require("../helpers/childProcess");

const CRAWL_ONCE = path.resolve(__dirname, "../../scripts/crawl-once.js");
const CHECK_REAL = path.resolve(__dirname, "../../scripts/check-real.js");
let replSet;

before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
});

after(async () => {
    await replSet?.stop();
});

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
