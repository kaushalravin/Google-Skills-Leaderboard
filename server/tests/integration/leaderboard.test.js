require("../../config/timezone");

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { startMongo } = require("../helpers/mongo");
const { buildTestApp } = require("../helpers/app");
const { User } = require("../../models/users");
const { Badge } = require("../../models/badges");
const { UserBadge } = require("../../models/userBadges");
const { Leaderboard } = require("../../models/leaderboard");
const { rebuildLeaderboard, getSnapshot } = require("../../services/leaderboard");
const { crawlAll } = require("../../services/crawl");

const COMPUTE = "The Basics of Google Cloud Compute";
const WEBSITE = "Build a Website on Google Cloud";
const VISION = "Analyze Images with the Cloud Vision API";
const SPEECH = "Using the Google Cloud Speech API";
const IAM = "Configure Service Accounts and IAM Roles for Google Cloud";
const STUDIO = "Develop AI-Powered Prototypes in Google AI Studio";

let mongo;
let app;
let seq = 0;

before(async () => {
    mongo = await startMongo();
    await Promise.all([User.init(), Badge.init(), UserBadge.init(), Leaderboard.init()]);
    ({ app } = buildTestApp());
});

after(async () => {
    await mongo?.stop();
});

beforeEach(async () => {
    await Promise.all([
        User.deleteMany({}), Badge.deleteMany({}), UserBadge.deleteMany({}), Leaderboard.deleteMany({})
    ]);
});

async function makeUser(username) {
    seq++;
    return User.create({
        username,
        email: `u${seq}@example.com`,
        skillsEmail: `u${seq}@skills.example.com`,
        skillsUrl: `https://www.skills.google/public_profiles/user-${seq}`,
        badgeCount: 0,
        credits: 3
    });
}

async function award(user, name, earnedAt, { newBadgeDoc = false } = {}) {
    seq++;
    const existing = newBadgeDoc ? null : await Badge.findOne({ name });
    const badge = existing ?? (await Badge.create({
        externalId: `ext-${seq}`,
        name,
        badgeUrl: `https://www.skills.google/badges/${seq}`,
        imageUrl: `https://cdn.example/${seq}.png`
    }));
    return UserBadge.create({ user: user._id, badge: badge._id, earnedAt: new Date(earnedAt) });
}

async function dbState() {
    const [users, badges, userBadges] = await Promise.all([
        User.find().sort({ _id: 1 }).lean(),
        Badge.find().sort({ _id: 1 }).lean(),
        UserBadge.find().sort({ _id: 1 }).lean()
    ]);
    return { users, badges, userBadges };
}

const list = (query = "") => request(app).get(`/api/leaderboard${query}`);
const summary = (rows) => rows.map((r) => [r.rank, r.username, r.validBadgeCount]);

test("ranks by count desc, then latest valid badge asc; ties share a rank (1,1,3); zero-badge users share the last rank", async () => {
    // Created out of name order so display order inside a rank must come from username.
    const bravo = await makeUser("Bravo");
    const alpha = await makeUser("Alpha");
    const charlie = await makeUser("Charlie");
    const delta = await makeUser("Delta");
    const golf = await makeUser("Golf");
    await makeUser("Zulu");
    await makeUser("Echo");

    for (const u of [alpha, bravo]) {
        await award(u, COMPUTE, "2026-10-26");
        await award(u, WEBSITE, "2026-10-27");
    }
    await award(charlie, COMPUTE, "2026-10-26");
    await award(charlie, WEBSITE, "2026-10-28");
    await award(delta, COMPUTE, "2026-10-27");
    await award(delta, WEBSITE, "2026-10-28");
    await award(delta, VISION, "2026-10-29");
    await award(golf, COMPUTE, "2026-10-26");

    const last = new Date("2026-10-29T06:00:00Z");
    assert.deepEqual(await rebuildLeaderboard({ lastSuccessfulUpdate: last }), { participants: 7 });

    const res = await list();
    assert.equal(res.status, 200);
    assert.match(res.headers["cache-control"], /public, max-age=30/);
    assert.deepEqual(summary(res.body.rows), [
        [1, "Delta", 3],
        [2, "Alpha", 2],
        [2, "Bravo", 2],
        [4, "Charlie", 2],
        [5, "Golf", 1],
        [6, "Echo", 0],
        [6, "Zulu", 0]
    ]);
    assert.equal(res.body.lastSuccessfulUpdate, last.toISOString());
    assert.equal(res.body.competitionStartDate, "2026-10-26T00:00:00.000Z");
    assert.deepEqual(res.body.pagination, { page: 1, limit: 50, total: 7, totalPages: 1 });

    const deltaRow = res.body.rows[0];
    assert.equal(deltaRow.userId, String(delta._id));
    assert.equal(deltaRow.skillsUrl, delta.skillsUrl);
    assert.equal(deltaRow.latestValidBadgeAt, "2026-10-29T00:00:00.000Z");
    assert.deepEqual(deltaRow.badges.map((b) => b.name), [COMPUTE, WEBSITE, VISION]);
    assert.equal(res.body.rows[5].latestValidBadgeAt, null);
    assert.deepEqual(res.body.rows[5].badges, []);
});

test("non-whitelisted, pre-start, non-zero seconds/ms and post-end rows are excluded", async () => {
    const user = await makeUser("Mixed");
    await award(user, "Some Other Badge", "2026-10-27");          // not whitelisted
    await award(user, COMPUTE, "2026-10-25");                     // before start
    await award(user, WEBSITE, "2026-10-25T18:30:00.000Z");       // old IST-midnight stamp for Oct 26
    await award(user, VISION, "2026-10-27T10:11:05.000Z");        // legacy crawl-date stamp (seconds)
    await award(user, SPEECH, "2026-10-27T00:00:00.123Z");        // milliseconds
    await award(user, STUDIO, "2026-10-26");                      // valid
    await award(user, IAM, "2026-11-05");                         // valid unless an end date excludes it

    await rebuildLeaderboard({});
    let row = (await getSnapshot()).rows[0];
    assert.equal(row.validBadgeCount, 2);
    assert.deepEqual(row.badges.map((b) => b.name), [STUDIO, IAM]);

    await rebuildLeaderboard({ endDate: "2026-11-04" });
    row = (await getSnapshot()).rows[0];
    assert.equal(row.validBadgeCount, 1);
    assert.equal(row.latestValidBadgeAt.toISOString(), "2026-10-26T00:00:00.000Z");
});

test("overlapping rebuilds run in order: a later 'keep' rebuild never reverts a crawl's snapshot", async () => {
    const user = await makeUser("Overlap");
    const crawledAt = new Date("2026-10-29T06:00:00.000Z");
    // A crawl's rebuild starts, and an ingestion rebuild (no lastSuccessfulUpdate) overlaps it.
    const crawl = rebuildLeaderboard({ lastSuccessfulUpdate: crawledAt });
    await award(user, COMPUTE, "2026-10-27");
    const ingest = rebuildLeaderboard({});
    await Promise.all([crawl, ingest]);

    const snapshot = await getSnapshot();
    assert.equal(snapshot.lastSuccessfulUpdate.toISOString(), crawledAt.toISOString());
    assert.equal(snapshot.rows[0].validBadgeCount, 1, "the later rebuild saw the later data");
});

test("two Badge docs with the same name count once (earliest date wins)", async () => {
    const user = await makeUser("Dup");
    await award(user, COMPUTE, "2026-10-28");
    await award(user, COMPUTE, "2026-10-27", { newBadgeDoc: true });
    assert.equal(await Badge.countDocuments({ name: COMPUTE }), 2);

    await rebuildLeaderboard({});
    const row = (await getSnapshot()).rows[0];
    assert.equal(row.validBadgeCount, 1);
    assert.equal(row.badges.length, 1);
    assert.equal(row.latestValidBadgeAt.toISOString(), "2026-10-27T00:00:00.000Z");
});

test("rebuild replaces the single snapshot doc; concurrent readers see the old or the new one, never a mix", async () => {
    const users = [];
    for (let i = 0; i < 30; i++) users.push(await makeUser(`Old ${String(i).padStart(2, "0")}`));
    await rebuildLeaderboard({ lastSuccessfulUpdate: new Date("2026-10-28T00:00:00Z") });

    await User.deleteMany({ _id: { $in: users.slice(0, 20).map((u) => u._id) } });
    const fresh = await makeUser("New");
    await award(fresh, COMPUTE, "2026-10-27");

    const rebuild = rebuildLeaderboard({ lastSuccessfulUpdate: new Date("2026-10-29T00:00:00Z") });
    const reads = [];
    for (let i = 0; i < 10; i++) reads.push(list("?limit=100"));
    await rebuild;
    for (const res of await Promise.all(reads)) {
        const { total } = res.body.pagination;
        if (total === 30) {
            assert.equal(res.body.lastSuccessfulUpdate, "2026-10-28T00:00:00.000Z");
            assert.ok(res.body.rows.every((r) => r.username.startsWith("Old")));
        } else {
            assert.equal(total, 11);
            assert.equal(res.body.lastSuccessfulUpdate, "2026-10-29T00:00:00.000Z");
            assert.equal(res.body.rows[0].username, "New");
        }
    }

    assert.equal(await Leaderboard.countDocuments(), 1);
    const snap = await getSnapshot();
    assert.equal(snap._id, "current");
    assert.equal(snap.rows.length, 11);
    assert.equal(snap.rows[0].username, "New");
    assert.ok(!snap.rows.some((r) => ["Old 00", "Old 19"].includes(r.username)));
});

test("a failed crawl leaves the previous snapshot and lastSuccessfulUpdate in place", async () => {
    const user = await makeUser("Kept");
    await award(user, COMPUTE, "2026-10-27");
    const last = new Date("2026-10-28T12:00:00Z");
    await rebuildLeaderboard({ lastSuccessfulUpdate: last });
    const beforeRes = await list();

    // New data appears, then a crawl fails for everyone; nothing rebuilds the snapshot.
    await award(user, WEBSITE, "2026-10-28");
    const failing = async () => {
        throw Object.assign(new Error("boom"), { isAxiosError: true, response: { status: 404, headers: {} } });
    };
    const result = await crawlAll({ scrape: failing, minGapMs: 0, maxRetries: 0 });
    assert.equal(result.succeeded, 0);

    const afterRes = await list();
    assert.deepEqual(afterRes.body, beforeRes.body);
    assert.equal(afterRes.body.lastSuccessfulUpdate, last.toISOString());
    assert.equal(afterRes.body.rows[0].validBadgeCount, 1);
});

test("pagination keeps global ranks", async () => {
    const names = ["A", "B", "C", "D", "E"];
    const badges = [COMPUTE, WEBSITE, VISION, SPEECH, IAM];
    for (let i = 0; i < names.length; i++) {
        const u = await makeUser(names[i]);
        for (let b = 0; b < names.length - i; b++) await award(u, badges[b], "2026-10-27");
    }
    await rebuildLeaderboard({});

    const page2 = await list("?page=2&limit=2");
    assert.deepEqual(summary(page2.body.rows), [[3, "C", 3], [4, "D", 2]]);
    assert.deepEqual(page2.body.pagination, { page: 2, limit: 2, total: 5, totalPages: 3 });

    const page3 = await list("?page=3&limit=2");
    assert.deepEqual(summary(page3.body.rows), [[5, "E", 1]]);

    const beyond = await list("?page=9&limit=2");
    assert.equal(beyond.status, 200);
    assert.deepEqual(beyond.body.rows, []);
    assert.equal(beyond.body.pagination.total, 5);
});

test("search is literal and case-insensitive; regex characters are safe; ranks stay global", async () => {
    for (const name of ["a.b", "axb", "x.*y", "(paren", "[a]", "Plain"]) await makeUser(name);
    const top = await makeUser("Top");
    await award(top, COMPUTE, "2026-10-27");
    await rebuildLeaderboard({});

    const search = async (term) => {
        const res = await list(`?search=${encodeURIComponent(term)}`);
        assert.equal(res.status, 200, `search ${term}`);
        return res.body;
    };
    const names = async (term) => (await search(term)).rows.map((r) => r.username);

    assert.deepEqual(await names(".*"), ["x.*y"]);
    assert.deepEqual(await names("("), ["(paren"]);
    assert.deepEqual(await names("[a"), ["[a]"]);
    assert.deepEqual(await names("A.B"), ["a.b"]);
    assert.deepEqual(await names("\\"), []);

    const plain = await search("plain");
    assert.deepEqual(summary(plain.rows), [[2, "Plain", 0]]);
    assert.equal(plain.pagination.total, 1);

    const tooLong = await list(`?search=${"a".repeat(101)}`);
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.body.error.code, "VALIDATION_ERROR");
});

test("no email or skillsEmail in any response or in the stored doc", async () => {
    const user = await makeUser("Private");
    await award(user, COMPUTE, "2026-10-27");
    await rebuildLeaderboard({});

    const stored = JSON.stringify(await getSnapshot());
    const responses = [
        await list(),
        await list("?search=priv"),
        await request(app).get(`/api/leaderboard/${user._id}`),
        await request(app).get("/api/leaderboard/000000000000000000000000"),
        await request(app).get("/api/leaderboard/bad")
    ];
    for (const text of [stored, ...responses.map((r) => r.text)]) {
        assert.ok(!/email/i.test(text), text);
        assert.ok(!text.includes("@example.com"), text);
    }
});

test("GET /:userId returns the row with badges; 400 on a malformed id, 404 when unknown", async () => {
    const user = await makeUser("Solo");
    await award(user, COMPUTE, "2026-10-27");

    // No snapshot yet: unknown.
    const early = await request(app).get(`/api/leaderboard/${user._id}`);
    assert.equal(early.status, 404);

    await rebuildLeaderboard({});
    const ok = await request(app).get(`/api/leaderboard/${user._id}`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers["cache-control"], /public, max-age=30/);
    assert.equal(ok.body.userId, String(user._id));
    assert.equal(ok.body.rank, 1);
    assert.equal(ok.body.validBadgeCount, 1);
    assert.equal(ok.body.badges.length, 1);
    assert.equal(ok.body.badges[0].name, COMPUTE);
    assert.equal(ok.body.badges[0].earnedAt, "2026-10-27T00:00:00.000Z");
    assert.match(ok.body.badges[0].imageUrl, /^https:\/\/cdn\.example\//);

    const bad = await request(app).get("/api/leaderboard/not-an-id");
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, "VALIDATION_ERROR");
    assert.equal(typeof bad.body.error.requestId, "string");

    const missing = await request(app).get("/api/leaderboard/0123456789abcdef01234567");
    assert.equal(missing.status, 404);
    assert.deepEqual(Object.keys(missing.body.error).sort(), ["code", "message", "requestId"]);
    assert.equal(missing.body.error.code, "NOT_FOUND");

    for (const query of ["?page=0", "?limit=0", "?limit=101", "?page=abc", "?page=1.5", "?search=a&search=b"]) {
        const res = await list(query);
        assert.equal(res.status, 400, query);
        assert.equal(res.body.error.code, "VALIDATION_ERROR");
    }
});

test("no snapshot yet: 200 with empty rows and null lastSuccessfulUpdate", async () => {
    await makeUser("NotYet");
    const res = await list();
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
        lastSuccessfulUpdate: null,
        competitionStartDate: null,
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
        rows: []
    });
    assert.equal(await getSnapshot(), null);
});

test("rebuild never modifies User, Badge or UserBadge", async () => {
    const a = await makeUser("A");
    const b = await makeUser("B");
    await award(a, COMPUTE, "2026-10-27");
    await award(a, "Some Other Badge", "2026-10-27");
    await award(b, WEBSITE, "2026-10-27T10:11:05.000Z");
    const beforeState = await dbState();

    await rebuildLeaderboard({});
    await rebuildLeaderboard({ endDate: "2026-10-26" });

    assert.deepEqual(await dbState(), beforeState);
});
