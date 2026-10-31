require("../../config/timezone");

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout: sleep } = require("node:timers/promises");

const { startMongo } = require("../helpers/mongo");
const { User } = require("../../models/users");
const { Badge } = require("../../models/badges");
const { UserBadge } = require("../../models/userBadges");
const { CrawlerLog } = require("../../models/crawlerLog");
const { tryAcquire, getLockState } = require("../../services/lock");
const { JobLock } = require("../../models/jobLock");
const { startCrawl, lastSuccessfulRun, reconcileOrphanedRuns } = require("../../services/crawlRunner");
const { settingsFromConfig } = require("../../services/crawl");
const { testConfig } = require("../helpers/env");

const WEBSITE = "Build a Website on Google Cloud";
const CRAWL_OPTIONS = { ...settingsFromConfig(testConfig()), minGapMs: 0, maxRetries: 0 };
const LOCK_TTL_MS = testConfig().LOCK_TTL_MS;

let mongo;
let seq = 0;

before(async () => {
    mongo = await startMongo();
    await Promise.all([User.init(), Badge.init(), UserBadge.init(), CrawlerLog.init()]);
});

after(async () => {
    await mongo?.stop();
});

beforeEach(async () => {
    await Promise.all([
        User.deleteMany({}),
        Badge.deleteMany({}),
        UserBadge.deleteMany({}),
        CrawlerLog.deleteMany({}),
        JobLock.collection.deleteMany({})
    ]);
});

async function makeUser() {
    seq++;
    return User.create({
        username: `User ${seq}`,
        email: `u${seq}@example.com`,
        skillsEmail: `u${seq}@skills.example.com`,
        skillsUrl: `https://www.skills.google/public_profiles/user-${seq}`
    });
}

const badge = (name, date) => ({
    externalId: "638",
    name,
    badgeUrl: "https://www.skills.google/public_profiles/x/badges/638",
    imageUrl: null,
    earnedAt: new Date(date)
});

const http404 = () => Object.assign(new Error("Not Found"), { isAxiosError: true, response: { status: 404, headers: {} } });

/** A rebuildLeaderboard stub that records its calls and whether the lock was held during them. */
function rebuildStub(impl = async () => ({ participants: 0 })) {
    const calls = [];
    const fn = async (args) => {
        calls.push({ args, lockHeld: (await getLockState("crawl")).held });
        return impl(args);
    };
    return { fn, calls };
}

async function run(trigger, deps) {
    const started = await startCrawl({ trigger, triggeredBy: trigger }, { crawlOptions: CRAWL_OPTIONS, lockTtlMs: LOCK_TTL_MS, ...deps });
    assert.equal(started.started, true);
    const outcome = await started.done;
    const log = await CrawlerLog.findOne({ runId: started.runId }).lean();
    return { outcome, log };
}

test("success: log status/counts, lock released, rebuild called under the lock with finishedAt", async () => {
    await makeUser();
    await makeUser();
    const rebuild = rebuildStub();
    const { outcome, log } = await run("manual", {
        scrape: async () => [badge(WEBSITE, "2026-10-27")],
        rebuildLeaderboard: rebuild.fn
    });

    assert.equal(outcome.status, "success");
    assert.equal(log.status, "success");
    assert.equal(log.trigger, "manual");
    assert.deepEqual(log.counts, { total: 2, succeeded: 2, failed: 0, empty: 0, badgesUpserted: 2, badgesSkippedNoDate: 0 });
    assert.deepEqual(outcome.counts, log.counts);
    assert.deepEqual(log.failures, []);
    assert.equal(log.error, undefined);
    assert.ok(log.finishedAt >= log.startedAt);
    assert.equal(log.durationMs, log.finishedAt - log.startedAt);

    assert.equal(rebuild.calls.length, 1);
    assert.deepEqual(rebuild.calls[0].args, { lastSuccessfulUpdate: log.finishedAt, startDate: "2026-10-26", endDate: undefined });
    assert.equal(rebuild.calls[0].lockHeld, true);

    assert.equal((await getLockState("crawl")).held, false);
    assert.equal((await lastSuccessfulRun()).runId, outcome.runId);
});

test("partial: some users fail; failures recorded; rebuild still called", async () => {
    const ok = await makeUser();
    const bad = await makeUser();
    const rebuild = rebuildStub();
    const { log } = await run("cron", {
        scrape: async (url) => {
            if (url === bad.skillsUrl) throw http404();
            return [badge(WEBSITE, "2026-10-27")];
        },
        rebuildLeaderboard: rebuild.fn
    });
    assert.equal(log.status, "partial");
    assert.deepEqual(log.counts, { total: 2, succeeded: 1, failed: 1, empty: 0, badgesUpserted: 1, badgesSkippedNoDate: 0 });
    assert.deepEqual(log.failures, [{ userId: String(bad._id), reason: "http_404", httpStatus: 404 }]);
    assert.equal(rebuild.calls.length, 1);
    assert.equal((await User.findById(ok._id)).badgeCount, 1);
});

test("a user with valid badges who comes back empty makes the run partial; data kept, leaderboard rebuilt", async () => {
    const ok = await makeUser();
    const blank = await makeUser();
    await run("cli", { scrape: async () => [badge(WEBSITE, "2026-10-27")], rebuildLeaderboard: rebuildStub().fn });
    const rebuild = rebuildStub();
    const { log } = await run("cli", {
        scrape: async (url) => (url === blank.skillsUrl ? [] : [badge(WEBSITE, "2026-10-27")]),
        rebuildLeaderboard: rebuild.fn
    });
    assert.equal(log.status, "partial");
    assert.deepEqual(log.counts, { total: 2, succeeded: 1, failed: 1, empty: 1, badgesUpserted: 1, badgesSkippedNoDate: 0 });
    assert.deepEqual(log.failures, [{ userId: String(blank._id), reason: "empty_result", httpStatus: null }]);
    assert.equal(rebuild.calls.length, 1);
    assert.equal((await User.findById(ok._id)).badgeCount, 1);
    assert.equal((await User.findById(blank._id)).badgeCount, 1, "the empty user's data is kept");
});

test("a user without valid badges who comes back empty still counts as succeeded", async () => {
    const ok = await makeUser();
    const newcomer = await makeUser();
    const { log } = await run("cli", {
        scrape: async (url) => (url === newcomer.skillsUrl ? [] : [badge(WEBSITE, "2026-10-27")]),
        rebuildLeaderboard: rebuildStub().fn
    });
    assert.equal(log.status, "success");
    assert.deepEqual(log.counts, { total: 2, succeeded: 2, failed: 0, empty: 0, badgesUpserted: 1, badgesSkippedNoDate: 0 });
    assert.equal((await User.findById(ok._id)).badgeCount, 1);
});

test("failed: no user succeeded; no rebuild; lock released; lastSuccessfulRun unchanged", async () => {
    await makeUser();
    await makeUser();
    const rebuild = rebuildStub();
    const { log } = await run("cli", { scrape: async () => { throw http404(); }, rebuildLeaderboard: rebuild.fn });
    assert.equal(log.status, "failed");
    assert.deepEqual(log.counts, { total: 2, succeeded: 0, failed: 2, empty: 0, badgesUpserted: 0, badgesSkippedNoDate: 0 });
    assert.equal(rebuild.calls.length, 0);
    assert.equal((await getLockState("crawl")).held, false);
    assert.equal(await lastSuccessfulRun(), null);
});

test("zero users is a success", async () => {
    const rebuild = rebuildStub();
    const { log } = await run("cli", { scrape: async () => [], rebuildLeaderboard: rebuild.fn });
    assert.equal(log.status, "success");
    assert.equal(log.counts.total, 0);
    assert.equal(rebuild.calls.length, 1);
});

const makeUsers = (n) => Promise.all(Array.from({ length: n }, makeUser));
const withBadge = async () => [badge(WEBSITE, "2026-10-27")];

test("suspicious: an all-empty run of >= 5 users is failed, not rebuilt, lastSuccessfulUpdate kept", async () => {
    await makeUsers(5);
    const first = await run("cron", { scrape: withBadge, rebuildLeaderboard: rebuildStub().fn });
    assert.equal(first.log.status, "success");

    const rebuild = rebuildStub();
    const { log } = await run("cron", { scrape: async () => [], rebuildLeaderboard: rebuild.fn });
    assert.equal(log.status, "failed");
    assert.equal(log.error, "suspicious_empty_run");
    assert.equal(rebuild.calls.length, 0);
    assert.equal((await lastSuccessfulRun()).runId, first.log.runId);
    assert.equal(await UserBadge.countDocuments(), 5, "nothing was deleted");
    assert.equal((await getLockState("crawl")).held, false);
});

test("suspicious: all-empty is flagged even when nobody had valid badges before", async () => {
    await makeUsers(5);
    const { log } = await run("cron", { scrape: async () => [], rebuildLeaderboard: rebuildStub().fn });
    assert.equal(log.status, "failed");
    assert.equal(log.error, "suspicious_empty_run");
});

test("suspicious: empty_result >= 30% of users with valid badges is flagged; an isolated one is not", async () => {
    const users = await makeUsers(5);
    await run("cron", { scrape: withBadge, rebuildLeaderboard: rebuildStub().fn });
    const emptyFor = (n) => {
        const blank = new Set(users.slice(0, n).map((u) => u.skillsUrl));
        return async (url) => (blank.has(url) ? [] : [badge(WEBSITE, "2026-10-27")]);
    };

    const isolated = await run("cron", { scrape: emptyFor(1), rebuildLeaderboard: rebuildStub().fn }); // 1/5 = 20%
    assert.equal(isolated.log.status, "partial");
    assert.equal(isolated.log.counts.empty, 1);
    assert.equal(isolated.log.error, undefined);

    const rebuild = rebuildStub();
    const mass = await run("cron", { scrape: emptyFor(2), rebuildLeaderboard: rebuild.fn }); // 2/5 = 40%
    assert.equal(mass.log.status, "failed");
    assert.equal(mass.log.error, "suspicious_empty_run");
    assert.equal(rebuild.calls.length, 0);
});

test("suspicious: runs below SUSPICIOUS_EMPTY_MIN_USERS are not flagged", async () => {
    await makeUsers(4);
    const rebuild = rebuildStub();
    const { log } = await run("cron", { scrape: async () => [], rebuildLeaderboard: rebuild.fn });
    assert.equal(log.status, "success");
    assert.equal(rebuild.calls.length, 1);

    // The threshold comes from env config.
    const lowered = await run("cron", {
        scrape: async () => [],
        rebuildLeaderboard: rebuildStub().fn,
        crawlOptions: settingsFromConfig(testConfig({ SUSPICIOUS_EMPTY_MIN_USERS: "2", CRAWL_MIN_GAP_MS: "0", CRAWL_MAX_RETRIES: "0" }))
    });
    assert.equal(lowered.log.status, "failed");
});

test("crash: crawlAll throws -> failed with error, lock released, done resolves", async () => {
    await makeUser();
    const rebuild = rebuildStub();
    // An invalid concurrency makes crawlAll itself throw (p-limit rejects it).
    const started = await startCrawl(
        { trigger: "manual", triggeredBy: "admin" },
        { crawlOptions: { ...CRAWL_OPTIONS, concurrency: 0 }, lockTtlMs: LOCK_TTL_MS, scrape: async () => [], rebuildLeaderboard: rebuild.fn }
    );
    const outcome = await started.done;
    const log = await CrawlerLog.findOne({ runId: started.runId }).lean();
    assert.equal(outcome.status, "failed");
    assert.equal(log.status, "failed");
    assert.match(log.error, /concurrency/i);
    assert.equal(rebuild.calls.length, 0);
    assert.equal((await getLockState("crawl")).held, false);
});

test("crash: the log can't be written -> done still resolves failed and the lock is released", async () => {
    const original = CrawlerLog.create;
    CrawlerLog.create = async () => {
        throw new Error("db down");
    };
    try {
        const started = await startCrawl({ trigger: "cli", triggeredBy: "cli" }, { crawlOptions: CRAWL_OPTIONS, lockTtlMs: LOCK_TTL_MS });
        assert.equal((await started.done).status, "failed");
    } finally {
        CrawlerLog.create = original;
    }
    assert.equal((await getLockState("crawl")).held, false);
});

test("a rebuild error is recorded in log.error without changing the status", async () => {
    await makeUser();
    const rebuild = rebuildStub(async () => {
        throw new Error("boom");
    });
    const { outcome, log } = await run("manual", {
        scrape: async () => [badge(WEBSITE, "2026-10-27")],
        rebuildLeaderboard: rebuild.fn
    });
    assert.equal(outcome.status, "success");
    assert.equal(log.status, "success");
    assert.match(log.error, /leaderboard rebuild failed: boom/);
    assert.equal((await getLockState("crawl")).held, false);
});

test("a second start while a run holds the lock is refused with the holder", async () => {
    await makeUser();
    let releaseScrape;
    const gate = new Promise((resolve) => (releaseScrape = resolve));
    const first = await startCrawl(
        { trigger: "cron", triggeredBy: "cron" },
        { crawlOptions: CRAWL_OPTIONS, lockTtlMs: LOCK_TTL_MS, scrape: async () => { await gate; return []; }, rebuildLeaderboard: async () => {} }
    );
    const second = await startCrawl({ trigger: "manual", triggeredBy: "admin" }, { crawlOptions: CRAWL_OPTIONS, lockTtlMs: LOCK_TTL_MS });
    assert.equal(second.started, false);
    assert.equal(second.lock.held, true);
    assert.deepEqual(second.lock.meta, { runId: first.runId, trigger: "cron", triggeredBy: "cron" });
    releaseScrape();
    assert.equal((await first.done).status, "success");
});

test("heartbeat detects a takeover mid-run: aborted, no crawl writes after, intruder keeps the lock", async () => {
    const first = await makeUser();
    await makeUser();
    const rebuild = rebuildStub();
    const scraped = [];
    const scrape = async (url) => {
        scraped.push(url);
        // Another process takes the lock over while this scrape is in flight.
        await JobLock.collection.updateOne(
            { _id: "crawl" },
            { $set: { owner: "intruder", expiresAt: new Date(Date.now() + 60000) } }
        );
        await sleep(400); // > one heartbeat (ttl/3 = 100 ms)
        return [badge(WEBSITE, "2026-10-27")];
    };
    const { log } = await run("cron", {
        scrape,
        lockTtlMs: 300,
        crawlOptions: { ...CRAWL_OPTIONS, concurrency: 1 },
        rebuildLeaderboard: rebuild.fn
    });

    assert.equal(log.status, "aborted");
    assert.deepEqual(scraped, [first.skillsUrl], "no new user starts after the abort");
    assert.equal(await Badge.countDocuments(), 0);
    assert.equal(await UserBadge.countDocuments(), 0);
    assert.deepEqual((await User.find().lean()).map((u) => u.badgeCount), [0, 0]);
    assert.equal(rebuild.calls.length, 0);
    assert.equal((await JobLock.collection.findOne({ _id: "crawl" })).owner, "intruder");
});

test("an external signal aborts the run", async () => {
    await makeUser();
    const controller = new AbortController();
    const { log } = await run("cli", {
        signal: controller.signal,
        scrape: async () => {
            controller.abort();
            return [badge(WEBSITE, "2026-10-27")];
        },
        rebuildLeaderboard: async () => {}
    });
    assert.equal(log.status, "aborted");
    assert.equal(await UserBadge.countDocuments(), 0);
    assert.equal((await getLockState("crawl")).held, false);
});

test("reconcileOrphanedRuns marks orphaned running logs failed but keeps the lock holder's run", async () => {
    const base = { trigger: "cron", triggeredBy: "cron", status: "running", startedAt: new Date() };
    await CrawlerLog.create([{ ...base, runId: "orphan" }, { ...base, runId: "live" }, { ...base, runId: "done", status: "success" }]);
    const lease = await tryAcquire("crawl", { ttlMs: 60000, meta: { runId: "live", trigger: "cron", triggeredBy: "cron" } });

    assert.equal(await reconcileOrphanedRuns(), 1);
    const byId = Object.fromEntries((await CrawlerLog.find().lean()).map((l) => [l.runId, l]));
    assert.equal(byId.orphan.status, "failed");
    assert.equal(byId.orphan.error, "orphaned");
    assert.equal(byId.live.status, "running");
    assert.equal(byId.done.status, "success");

    await lease.release();
    assert.equal(await reconcileOrphanedRuns(), 1, "once the lock is free, the remaining running log is orphaned too");
    assert.equal((await CrawlerLog.findOne({ runId: "live" })).status, "failed");
});

test("a new run marks logs left 'running' by a crashed process as failed (orphaned)", async () => {
    // A process died mid-run and the server restarted before its lease expired, so boot-time
    // reconciliation had to leave the log alone. Whoever takes the lock next must close it.
    await makeUser();
    await CrawlerLog.create({ runId: "crashed", trigger: "cron", triggeredBy: "cron", status: "running", startedAt: new Date() });
    const { outcome } = await run("manual", { scrape: async () => [badge(WEBSITE, "2026-10-27")], rebuildLeaderboard: rebuildStub().fn });
    assert.equal(outcome.status, "success");
    const crashed = await CrawlerLog.findOne({ runId: "crashed" }).lean();
    assert.equal(crashed.status, "failed");
    assert.equal(crashed.error, "orphaned");
    assert.ok(crashed.finishedAt);
});
