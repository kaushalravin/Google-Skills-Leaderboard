require("../../config/timezone");

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { startMongo } = require("../helpers/mongo");
const { User } = require("../../models/users");
const { Badge } = require("../../models/badges");
const { UserBadge } = require("../../models/userBadges");
const { crawlAll, settingsFromConfig } = require("../../services/crawl");
const { testConfig } = require("../helpers/env");

const COMPUTE = "The Basics of Google Cloud Compute";
const WEBSITE = "Build a Website on Google Cloud";
const VISION = "Analyze Images with the Cloud Vision API";

// Tiny delays so retry paths run fast.
const FAST = { ...settingsFromConfig(testConfig()), minGapMs: 0, backoffBaseMs: 1, backoffMaxMs: 5, retryAfterMaxMs: 300 };

let mongo;
let seq = 0;

before(async () => {
    mongo = await startMongo();
    await Promise.all([User.init(), Badge.init(), UserBadge.init()]);
});

after(async () => {
    await mongo?.stop();
});

beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Badge.deleteMany({}), UserBadge.deleteMany({})]);
});

async function makeUser(extra = {}) {
    seq++;
    return User.create({
        username: `User ${seq}`,
        email: `u${seq}@example.com`,
        skillsEmail: `u${seq}@skills.example.com`,
        skillsUrl: `https://www.skills.google/public_profiles/user-${seq}`,
        ...extra
    });
}

/** Shaped like scrapeProfile's output. */
function scraped(name, date, n = name.length) {
    return {
        externalId: String(n),
        name,
        badgeUrl: `https://www.skills.google/public_profiles/x/badges/${n}`,
        imageUrl: `https://cdn.example/${n}.png`,
        earnedAt: date === null ? null : new Date(date)
    };
}

/** scrape stub: url -> array | Error | (call) => array; records every call. */
function stubScrape(routes) {
    const calls = [];
    const scrape = async (url) => {
        calls.push({ url, at: Date.now() });
        const route = routes[url];
        const value = typeof route === "function" ? await route(calls.filter((c) => c.url === url).length) : route;
        if (value instanceof Error) throw value;
        return value ?? [];
    };
    scrape.calls = calls;
    return scrape;
}

function httpError(status, headers = {}) {
    return Object.assign(new Error(`Request failed with status code ${status}`), {
        isAxiosError: true,
        response: { status, headers }
    });
}

async function legacyRow(user, name, earnedAt) {
    const badge =
        (await Badge.findOne({ name })) ??
        (await Badge.create({ externalId: `legacy-${name}`, name, badgeUrl: `https://legacy/${encodeURIComponent(name)}`, imageUrl: null }));
    return UserBadge.create({ user: user._id, badge: badge._id, earnedAt: new Date(earnedAt) });
}

async function snapshot() {
    const [users, badges, userBadges] = await Promise.all([
        User.find().sort({ _id: 1 }).lean(),
        Badge.find().sort({ _id: 1 }).lean(),
        UserBadge.find().sort({ _id: 1 }).lean()
    ]);
    return { users, badges, userBadges };
}

const badgeCountOf = async (user) => (await User.findById(user._id).lean()).badgeCount;

test("creates Badge + UserBadge for whitelisted results and sets badgeCount; credits untouched", async () => {
    const user = await makeUser({ credits: 7 });
    const scrape = stubScrape({
        [user.skillsUrl]: [scraped(COMPUTE, "2026-10-27"), scraped(WEBSITE, "2026-10-28")]
    });

    const result = await crawlAll({ scrape, ...FAST });

    assert.deepEqual(
        { total: result.total, succeeded: result.succeeded, failed: result.failed, upserted: result.badgesUpserted },
        { total: 1, succeeded: 1, failed: 0, upserted: 2 }
    );
    assert.deepEqual((await Badge.find().lean()).map((b) => b.name).sort(), [WEBSITE, COMPUTE].sort());
    const rows = await UserBadge.find({ user: user._id }).lean();
    assert.equal(rows.length, 2);
    const doc = await User.findById(user._id).lean();
    assert.equal(doc.badgeCount, 2);
    assert.equal(doc.credits, 7);
});

test("duplicate runs and shared badges create no duplicate rows", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const scrape = stubScrape({
        [a.skillsUrl]: [scraped(COMPUTE, "2026-10-27", 111), scraped(COMPUTE, "2026-10-29", 111)],
        [b.skillsUrl]: [scraped(COMPUTE, "2026-10-28", 222)]
    });

    await crawlAll({ scrape, ...FAST, concurrency: 2 });
    await crawlAll({ scrape, ...FAST, concurrency: 2 });

    assert.equal(await Badge.countDocuments(), 1);
    assert.equal(await UserBadge.countDocuments(), 2);
    // A name listed twice keeps the earliest date.
    const rowA = await UserBadge.findOne({ user: a._id }).lean();
    assert.equal(rowA.earnedAt.toISOString(), "2026-10-27T00:00:00.000Z");
});

test("a null earnedAt is skipped (never defaulted) and leaves an existing row untouched", async () => {
    const user = await makeUser();
    const existing = await legacyRow(user, COMPUTE, "2026-10-27T00:00:00Z");
    const scrape = stubScrape({ [user.skillsUrl]: [scraped(COMPUTE, null), scraped(WEBSITE, "2026-10-28")] });

    const result = await crawlAll({ scrape, ...FAST });

    assert.equal(result.badgesSkippedNoDate, 1);
    assert.equal(result.badgesUpserted, 1);
    const row = await UserBadge.findById(existing._id).lean();
    assert.equal(row.earnedAt.toISOString(), "2026-10-27T00:00:00.000Z");
    assert.equal(await UserBadge.countDocuments({ user: user._id }), 2);
    assert.equal(await badgeCountOf(user), 2);
});

test("badges earned before 2026-10-26 are stored but don't count", async () => {
    const user = await makeUser();
    const scrape = stubScrape({
        [user.skillsUrl]: [scraped(COMPUTE, "2026-10-25"), scraped(WEBSITE, "2026-10-26")]
    });

    await crawlAll({ scrape, ...FAST });

    assert.equal(await UserBadge.countDocuments({ user: user._id }), 2);
    assert.equal(await badgeCountOf(user), 1);
});

test("a non-whole-second legacy row doesn't count until a scrape corrects it", async () => {
    const user = await makeUser();
    const stamped = await legacyRow(user, COMPUTE, "2026-10-27T10:11:12.345Z");

    await crawlAll({ scrape: stubScrape({ [user.skillsUrl]: [scraped(WEBSITE, "2026-10-28")] }), ...FAST });
    assert.equal(await badgeCountOf(user), 1, "stamped row excluded");
    assert.ok(await UserBadge.findById(stamped._id), "excluded, not deleted");

    await crawlAll({
        scrape: stubScrape({ [user.skillsUrl]: [scraped(COMPUTE, "2026-10-27"), scraped(WEBSITE, "2026-10-28")] }),
        ...FAST
    });
    const corrected = await UserBadge.findById(stamped._id).lean();
    assert.equal(corrected.earnedAt.toISOString(), "2026-10-27T00:00:00.000Z");
    assert.equal(await UserBadge.countDocuments({ user: user._id }), 2);
    assert.equal(await badgeCountOf(user), 2);
});

test("an old IST-midnight row is corrected to UTC midnight and then counts", async () => {
    const user = await makeUser();
    const ist = await legacyRow(user, COMPUTE, "2026-10-25T18:30:00.000Z"); // "Oct 26" parsed on an IST server
    await User.updateOne({ _id: user._id }, { $set: { badgeCount: 0 } });

    await crawlAll({ scrape: stubScrape({ [user.skillsUrl]: [scraped(COMPUTE, "2026-10-26")] }), ...FAST });

    const row = await UserBadge.findById(ist._id).lean();
    assert.equal(row.earnedAt.toISOString(), "2026-10-26T00:00:00.000Z");
    assert.equal(await badgeCountOf(user), 1);
});

test("an empty result: failure with no writes if the user has valid badges, success otherwise", async () => {
    const withBadges = await makeUser();
    await legacyRow(withBadges, COMPUTE, "2026-10-27T00:00:00Z");
    await User.updateOne({ _id: withBadges._id }, { $set: { badgeCount: 1 } });
    await makeUser();
    const before = await snapshot();

    const result = await crawlAll({ scrape: stubScrape({}), ...FAST });

    assert.equal(result.succeeded, 1);
    assert.equal(result.failed, 1);
    assert.deepEqual(result.failures, [{ userId: String(withBadges._id), reason: "empty_result", httpStatus: null }]);
    assert.deepEqual(await snapshot(), before);
});

test("a thrown scrape leaves data untouched and is recorded", async () => {
    const user = await makeUser();
    await legacyRow(user, COMPUTE, "2026-10-27T00:00:00Z");
    await User.updateOne({ _id: user._id }, { $set: { badgeCount: 1 } });
    const before = await snapshot();

    const scrape = stubScrape({ [user.skillsUrl]: new TypeError("unexpected markup") });
    const result = await crawlAll({ scrape, ...FAST });

    assert.equal(result.failed, 1);
    assert.equal(result.failures[0].reason, "unexpected markup");
    assert.equal(scrape.calls.length, 1, "non-network errors are not retried");
    assert.deepEqual(await snapshot(), before);
});

test("non-whitelisted legacy UserBadges are not counted and not deleted", async () => {
    const user = await makeUser();
    const legacy = await legacyRow(user, "Some Old Non-Competition Course", "2026-10-27T00:00:00Z");

    await crawlAll({ scrape: stubScrape({ [user.skillsUrl]: [scraped(VISION, "2026-10-28")] }), ...FAST });

    assert.equal(await badgeCountOf(user), 1);
    assert.ok(await UserBadge.findById(legacy._id));
});

test("a 503 is retried and then succeeds", async () => {
    const user = await makeUser();
    const scrape = stubScrape({
        [user.skillsUrl]: (n) => (n === 1 ? httpError(503) : [scraped(COMPUTE, "2026-10-27")])
    });

    const result = await crawlAll({ scrape, ...FAST });

    assert.equal(scrape.calls.length, 2);
    assert.equal(result.succeeded, 1);
    assert.equal(await badgeCountOf(user), 1);
});

test("a 404 is not retried; network errors are retried at most 3 times", async () => {
    const gone = await makeUser();
    const flaky = await makeUser();
    const scrape = stubScrape({
        [gone.skillsUrl]: httpError(404),
        [flaky.skillsUrl]: Object.assign(new Error("socket hang up"), { isAxiosError: true, code: "ECONNRESET" })
    });

    const result = await crawlAll({ scrape, ...FAST });

    assert.equal(scrape.calls.filter((c) => c.url === gone.skillsUrl).length, 1);
    assert.equal(scrape.calls.filter((c) => c.url === flaky.skillsUrl).length, 4);
    assert.equal(result.failed, 2);
    assert.deepEqual(
        result.failures.map((f) => [f.userId, f.reason, f.httpStatus]).sort(),
        [[String(gone._id), "http_404", 404], [String(flaky._id), "ECONNRESET", null]].sort()
    );
});

test("Retry-After (capped) pauses all workers, not just the one that got the 429", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const c = await makeUser();
    const scrape = stubScrape({
        [a.skillsUrl]: (n) => (n === 1 ? httpError(429, { "retry-after": "5" }) : []),
        [b.skillsUrl]: [],
        [c.skillsUrl]: []
    });

    const started = Date.now();
    const result = await crawlAll({ scrape, ...FAST, concurrency: 2 });
    const firstCall = (url) => scrape.calls.find((call) => call.url === url).at;
    const aCalls = scrape.calls.filter((call) => call.url === a.skillsUrl);

    assert.equal(result.succeeded, 3);
    assert.equal(aCalls.length, 2);
    // retry-after "5" s is capped to retryAfterMaxMs (300 ms) for everyone.
    assert.ok(firstCall(c.skillsUrl) - aCalls[0].at >= 280, "worker 2's next request waited for the pause");
    assert.ok(aCalls[1].at - aCalls[0].at >= 280);
    assert.ok(Date.now() - started < 3000, "the 5 s Retry-After was capped");
});

test("abort stops new work and nothing is written afterwards", async () => {
    const users = [await makeUser(), await makeUser(), await makeUser()];
    const controller = new AbortController();
    const scrape = stubScrape({
        [users[0].skillsUrl]: () => {
            controller.abort();
            return [scraped(COMPUTE, "2026-10-27")];
        },
        [users[1].skillsUrl]: [scraped(COMPUTE, "2026-10-27")],
        [users[2].skillsUrl]: [scraped(COMPUTE, "2026-10-27")]
    });
    const before = await snapshot();

    const result = await crawlAll({ scrape, ...FAST, concurrency: 1, signal: controller.signal });

    assert.equal(result.aborted, true);
    assert.equal(scrape.calls.length, 1, "no new users after abort");
    assert.equal(result.succeeded + result.failed, 0);
    assert.deepEqual(await snapshot(), before, "the in-flight result was not persisted");
});

test("dry-run writes nothing and reports per-user valid counts", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const before = await snapshot();
    const scrape = stubScrape({
        [a.skillsUrl]: [scraped(COMPUTE, "2026-10-27"), scraped(WEBSITE, "2026-10-25"), scraped(VISION, null)],
        [b.skillsUrl]: [scraped(VISION, "2026-10-30")]
    });

    const result = await crawlAll({ scrape, ...FAST, dryRun: true });

    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(
        result.report.sort((x, y) => x.userId.localeCompare(y.userId)),
        [
            { userId: String(a._id), scraped: 3, valid: 1 },
            { userId: String(b._id), scraped: 1, valid: 1 }
        ].sort((x, y) => x.userId.localeCompare(y.userId))
    );
});
