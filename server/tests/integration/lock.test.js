require("../../config/timezone");

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout: sleep } = require("node:timers/promises");

const { startMongo } = require("../helpers/mongo");
const { tryAcquire, getLockState } = require("../../services/lock");
const { JobLock } = require("../../models/jobLock");

let mongo;

before(async () => {
    mongo = await startMongo();
});

after(async () => {
    await mongo?.stop();
});

beforeEach(async () => {
    await JobLock.collection.deleteMany({});
});

test("exactly one of 25 concurrent contenders gets the lock", async () => {
    const leases = await Promise.all(
        Array.from({ length: 25 }, (_, i) => tryAcquire("crawl", { ttlMs: 60000, meta: { runId: `r${i}` } }))
    );
    const winners = leases.filter(Boolean);
    assert.equal(winners.length, 1);
    assert.equal(await JobLock.collection.countDocuments(), 1);

    const state = await getLockState("crawl");
    assert.equal(state.held, true);
    assert.deepEqual(state.meta, winners[0].meta);
    assert.ok(state.expiresAt > state.acquiredAt);
    await winners[0].release();
});

test("release frees the lock, is idempotent, and getLockState reports free", async () => {
    assert.deepEqual(await getLockState("crawl"), { held: false, acquiredAt: null, expiresAt: null, meta: null });
    const lease = await tryAcquire("crawl", { ttlMs: 60000, meta: { trigger: "cron" } });
    assert.equal(await tryAcquire("crawl", { ttlMs: 60000 }), null);
    await lease.release();
    await lease.release();
    assert.equal((await getLockState("crawl")).held, false);
    const next = await tryAcquire("crawl", { ttlMs: 60000 });
    assert.ok(next);
    await next.release();
});

test("meta is stored literally, even values that look like expressions", async () => {
    const lease = await tryAcquire("crawl", { ttlMs: 60000, meta: { triggeredBy: "$owner", n: { $add: [1, 2] } } });
    assert.deepEqual((await getLockState("crawl")).meta, { triggeredBy: "$owner", n: { $add: [1, 2] } });
    await lease.release();
});

test("an expired lease can be taken over, and the stale owner's release does not free the new lock", async () => {
    const stale = await tryAcquire("crawl", { ttlMs: 60000, meta: { runId: "old" } });
    // Simulate a stalled owner whose lease has expired.
    await JobLock.collection.updateOne({ _id: "crawl" }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await getLockState("crawl")).held, false);

    const fresh = await tryAcquire("crawl", { ttlMs: 60000, meta: { runId: "new" } });
    assert.ok(fresh, "the expired lease can be taken");
    await stale.release();

    const state = await getLockState("crawl");
    assert.equal(state.held, true);
    assert.equal(state.meta.runId, "new");
    assert.equal(await tryAcquire("crawl", { ttlMs: 60000 }), null);
    await fresh.release();
});

test("heartbeat renews the lease while the owner matches", async () => {
    const lease = await tryAcquire("crawl", { ttlMs: 3000 });
    const firstExpiry = lease.expiresAt;
    await sleep(2500); // past the original expiry; renewed every second
    const state = await getLockState("crawl");
    assert.equal(state.held, true);
    assert.ok(state.expiresAt > firstExpiry);
    assert.ok(state.acquiredAt < new Date(Date.now() - 2000), "same lease, not re-acquired");
    assert.equal(lease.signal.aborted, false);
    await lease.release();
});

test("heartbeat detects a takeover and aborts the signal", async () => {
    // ttl 3000: the first heartbeat runs at ~1 s, leaving ~2 s for its round trip before the
    // expiry timer would fire instead (the suite runs files in parallel, so the DB can be slow).
    const lease = await tryAcquire("crawl", { ttlMs: 3000 });
    await JobLock.collection.updateOne(
        { _id: "crawl" },
        { $set: { owner: "intruder", expiresAt: new Date(Date.now() + 60000) } }
    );
    const deadline = Date.now() + 6000;
    while (!lease.signal.aborted && Date.now() < deadline) await sleep(20);
    assert.equal(lease.signal.aborted, true);
    assert.match(lease.signal.reason.message, /owner changed/);
    await lease.release();
    assert.equal((await JobLock.collection.findOne({ _id: "crawl" })).owner, "intruder");
});

test("the signal aborts when renewal can't be confirmed before the lease expires", async () => {
    const lease = await tryAcquire("crawl", { ttlMs: 300 });
    // Make every renewal hang: the heartbeat never gets a confirmation.
    const original = JobLock.collection.updateOne;
    JobLock.collection.updateOne = () => new Promise(() => {});
    try {
        await sleep(450);
        assert.equal(lease.signal.aborted, true);
        assert.match(lease.signal.reason.message, /not confirmed/);
    } finally {
        JobLock.collection.updateOne = original;
    }
    await lease.release();
});
