require("../../config/timezone");

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { startMongo } = require("../helpers/mongo");
const { buildTestApp } = require("../helpers/app");
const { TEST_ADMIN_KEY } = require("../helpers/env");
const { User } = require("../../models/users");
const { Badge } = require("../../models/badges");
const { UserBadge } = require("../../models/userBadges");
const { Leaderboard } = require("../../models/leaderboard");
const { rebuildLeaderboard, getSnapshot } = require("../../services/leaderboard");

const CANONICAL = "https://www.skills.google/public_profiles/aB12-cd34";

let mongo;
let app;

before(async () => {
    mongo = await startMongo();
    await Promise.all([User.init(), Badge.init(), UserBadge.init(), Leaderboard.init()]);
    ({ app } = buildTestApp());
});

after(async () => {
    await mongo?.stop();
});

beforeEach(async () => {
    await Promise.all([User.deleteMany({}), UserBadge.deleteMany({}), Leaderboard.deleteMany({})]);
});

const post = (body, key = TEST_ADMIN_KEY) => {
    const req = request(app).post("/api/admin/participants");
    if (key !== null) req.set("x-admin-key", key);
    return req.send(body);
};

const row = (n, profileUrl = `https://www.skills.google/public_profiles/p-${n}`) => ({
    username: `User ${n}`,
    email: `user${n}@example.com`,
    skillsEmail: `user${n}@skills.example.com`,
    profileUrl
});

function assertNoEmails(res) {
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes("@"), `response leaks an email: ${text}`);
}

test("URL variants of one profile give exactly one user with the canonical skillsUrl", async () => {
    // A seeded user, exactly as seeds/userSeed.js would store it.
    await User.create({ username: "Seeded", email: "seed@example.com", skillsEmail: "seed@skills.example.com", skillsUrl: CANONICAL });

    const variants = [
        "http://www.skills.google/public_profiles/aB12-cd34",
        "https://skills.google/public_profiles/aB12-cd34",
        "https://www.cloudskillsboost.google/public_profiles/aB12-cd34",
        "https://cloudskillsboost.google/public_profiles/aB12-cd34",
        "https://www.skills.google/public_profiles/aB12-cd34/",
        "https://www.skills.google/public_profiles/aB12-cd34?utm=1#top",
        "https://www.skills.google/public_profiles/AB12-CD34"
    ];
    for (const profileUrl of variants) {
        const res = await post({ username: "Renamed", email: "seed@example.com", skillsEmail: "seed@skills.example.com", profileUrl });
        assert.equal(res.status, 200, profileUrl);
        assert.deepEqual(res.body, { received: 1, inserted: 0, updated: 1, duplicatesInBatch: 0, rejected: [] });
        assertNoEmails(res);
    }
    const users = await User.find().lean();
    assert.equal(users.length, 1);
    assert.equal(users[0].skillsUrl, CANONICAL);
    assert.equal(users[0].username, "Renamed");
});

test("a new participant is stored with the canonical URL and schema defaults", async () => {
    const res = await post({ ...row(1, "http://cloudskillsboost.google/public_profiles/New-Id/?a=b"), email: "  MiXed@Example.COM " });
    assert.equal(res.status, 200);
    assert.equal(res.body.inserted, 1);
    const user = await User.findOne().lean();
    assert.equal(user.skillsUrl, "https://www.skills.google/public_profiles/New-Id");
    assert.equal(user.email, "mixed@example.com");
    assert.equal(user.badgeCount, 0);
    assert.equal(user.credits, 0);
});

test("SSRF and malformed URLs are rejected per row; valid rows in the batch persist", async () => {
    const bad = [
        "https://evil.com/public_profiles/x",
        "https://skills.google.evil.com/public_profiles/x",
        "https://evilskills.google/public_profiles/x",
        "https://www.skills.google/profiles/x",
        "https://www.skills.google/public_profiles/x/extra",
        "https://user:pass@www.skills.google/public_profiles/x",
        "https://www.skills.google:8080/public_profiles/x",
        "ftp://www.skills.google/public_profiles/x",
        "javascript:alert(1)",
        "data:text/html,hi"
    ];
    const rows = bad.map((url, i) => row(i, url));
    rows.push(row(99));
    const res = await post({ participants: rows });
    assert.equal(res.status, 200);
    assert.equal(res.body.inserted, 1);
    assert.deepEqual(res.body.rejected, bad.map((_, index) => ({ index, reason: "invalid_profile_url" })));
    assertNoEmails(res);
    const users = await User.find().lean();
    assert.deepEqual(users.map((u) => u.skillsUrl), ["https://www.skills.google/public_profiles/p-99"]);
});

test("invalid rows (missing fields, bad email, wrong types) are rejected as invalid_row", async () => {
    const res = await post([
        { ...row(1), email: "not-an-email" },
        { ...row(2), username: "   " },
        { ...row(3), skillsEmail: undefined },
        "a string",
        null,
        { ...row(4), profileUrl: 123 },
        row(5)
    ]);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.rejected, [
        { index: 0, reason: "invalid_row" },
        { index: 1, reason: "invalid_row" },
        { index: 2, reason: "invalid_row" },
        { index: 3, reason: "invalid_row" },
        { index: 4, reason: "invalid_row" },
        { index: 5, reason: "invalid_profile_url" }
    ]);
    assert.equal(res.body.inserted, 1);
    assertNoEmails(res);
});

test("10 concurrent identical submissions give exactly one user", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => post(row(1))));
    for (const res of results) assert.equal(res.status, 200);
    assert.equal(results.reduce((n, r) => n + r.body.inserted, 0), 1);
    assert.equal(results.reduce((n, r) => n + r.body.updated, 0), 9);
    assert.equal(await User.countDocuments(), 1);
});

test("concurrent case-variant submissions give exactly one user", async () => {
    const urls = [
        "https://www.skills.google/public_profiles/case-ID",
        "https://www.skills.google/public_profiles/CASE-id",
        "https://www.skills.google/public_profiles/case-id",
        "http://cloudskillsboost.google/public_profiles/CASE-ID/"
    ];
    const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) => post(row(1, urls[i % urls.length])))
    );
    for (const res of results) assert.equal(res.status, 200);
    assert.equal(await User.countDocuments(), 1);
});

test("an exact-URL insert race is retried as an update (E11000 on skillsUrl)", async () => {
    // Simulate losing the race: another writer inserts between our find and our upsert.
    const originalFindOne = User.findOne;
    let raced = false;
    User.findOne = function (...args) {
        const query = originalFindOne.apply(this, args);
        if (!raced) {
            raced = true;
            return {
                sort: () => ({
                    lean: async () => {
                        await User.collection.insertOne({
                            username: "Other writer", email: "other@example.com",
                            skillsEmail: "other@skills.example.com", skillsUrl: row(1).profileUrl,
                            badgeCount: 0, credits: 0
                        });
                        return null;
                    }
                })
            };
        }
        return query;
    };
    try {
        const res = await post(row(1));
        assert.equal(res.status, 200);
        assert.deepEqual([res.body.inserted, res.body.updated], [0, 1]);
    } finally {
        User.findOne = originalFindOne;
    }
    const users = await User.find().lean();
    assert.equal(users.length, 1);
    assert.equal(users[0].username, "User 1");
});

test("within a batch the last row for a profile wins; earlier ones count as duplicates", async () => {
    const res = await post([
        { ...row(1), username: "First" },
        row(2),
        { ...row(1, "https://skills.google/public_profiles/P-1/"), username: "Last" }
    ]);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { received: 3, inserted: 2, updated: 0, duplicatesInBatch: 1, rejected: [] });
    const user = await User.findOne({ skillsUrl: /p-1$/i }).lean();
    assert.equal(user.username, "Last");
    assert.equal(user.skillsUrl, "https://www.skills.google/public_profiles/P-1");
});

test("an email used by another profile rejects that row; the other rows persist", async () => {
    await post(row(1));
    const res = await post([
        row(2),
        { ...row(3), email: "user1@example.com" },
        { ...row(4), skillsEmail: "USER1@skills.example.com" },
        row(5)
    ]);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
        received: 4,
        inserted: 2,
        updated: 0,
        duplicatesInBatch: 0,
        rejected: [
            { index: 1, reason: "email_in_use_by_other_profile" },
            { index: 2, reason: "email_in_use_by_other_profile" }
        ]
    });
    assertNoEmails(res);
    assert.equal(await User.countDocuments(), 3);
    assert.equal((await User.findOne({ skillsUrl: row(1).profileUrl }).lean()).username, "User 1");
});

test("re-submission updates username/emails but never badgeCount or credits", async () => {
    await post(row(1));
    await User.updateOne({ skillsUrl: row(1).profileUrl }, { $set: { badgeCount: 4, credits: 7 } });
    const res = await post({ ...row(1), username: "New Name", email: "new@example.com", skillsEmail: "new@skills.example.com" });
    assert.equal(res.status, 200);
    assert.equal(res.body.updated, 1);
    const user = await User.findOne().lean();
    assert.equal(user.username, "New Name");
    assert.equal(user.email, "new@example.com");
    assert.equal(user.skillsEmail, "new@skills.example.com");
    assert.equal(user.badgeCount, 4);
    assert.equal(user.credits, 7);
});

test("the snapshot is rebuilt with lastSuccessfulUpdate preserved; the new participant has 0 badges", async () => {
    const lastRun = new Date("2026-10-28T06:00:00.000Z");
    await rebuildLeaderboard({ lastSuccessfulUpdate: lastRun });
    const before = await getSnapshot();
    assert.deepEqual(before.rows, []);

    const res = await post(row(1));
    assert.equal(res.status, 200);
    const snapshot = await getSnapshot();
    assert.equal(snapshot.lastSuccessfulUpdate.toISOString(), lastRun.toISOString());
    assert.ok(snapshot.generatedAt > before.generatedAt);
    assert.equal(snapshot.rows.length, 1);
    assert.equal(snapshot.rows[0].username, "User 1");
    assert.equal(snapshot.rows[0].validBadgeCount, 0);

    const board = await request(app).get("/api/leaderboard");
    assert.equal(board.body.rows[0].username, "User 1");
    assert.equal(board.body.lastSuccessfulUpdate, lastRun.toISOString());
});

test("with no prior snapshot, lastSuccessfulUpdate stays null", async () => {
    await post(row(1));
    const snapshot = await getSnapshot();
    assert.equal(snapshot.lastSuccessfulUpdate, null);
    assert.equal(snapshot.rows.length, 1);
});

test("a batch with no insert/update does not rebuild the snapshot", async () => {
    await post(row(1));
    const first = await getSnapshot();
    await post({ ...row(2), email: "user1@example.com" });
    const second = await getSnapshot();
    assert.equal(second.generatedAt.getTime(), first.generatedAt.getTime());
});

test("admin auth is required: missing or wrong key → 401, nothing written", async () => {
    for (const key of [null, "wrong", `${TEST_ADMIN_KEY}x`, TEST_ADMIN_KEY.slice(0, -1)]) {
        const res = await post(row(1), key);
        assert.equal(res.status, 401);
        assert.equal(res.body.error.code, "UNAUTHORIZED");
        assert.equal(res.headers["cache-control"], "no-store", "like every admin response");
        assertNoEmails(res);
    }
    assert.equal(await User.countDocuments(), 0);
});

test("422 only when every row is rejected; the details list the reasons without emails", async () => {
    await post(row(1));
    const res = await post([{ ...row(2), email: "user1@example.com" }, row(3, "https://evil.com/x")]);
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, "ALL_ROWS_REJECTED");
    assert.deepEqual(res.body.error.details.rejected, [
        { index: 0, reason: "email_in_use_by_other_profile" },
        { index: 1, reason: "invalid_profile_url" }
    ]);
    assertNoEmails(res);
});

test("malformed bodies → 400 VALIDATION_ERROR (empty, > 500 rows, wrong envelope)", async () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => row(i));
    for (const body of [[], { participants: [] }, { participants: "x" }, tooMany, { participants: tooMany }]) {
        const res = await post(body);
        assert.equal(res.status, 400);
        assert.equal(res.body.error.code, "VALIDATION_ERROR");
        assertNoEmails(res);
    }
    const noBody = await request(app).post("/api/admin/participants").set("x-admin-key", TEST_ADMIN_KEY);
    assert.equal(noBody.status, 400);
    const badJson = await request(app).post("/api/admin/participants").set("x-admin-key", TEST_ADMIN_KEY)
        .set("Content-Type", "application/json").send("{\"email\":\"a@b.c\"");
    assert.equal(badJson.status, 400);
    assertNoEmails(badJson);
    assert.equal(await User.countDocuments(), 0);
});

test("500 rows are accepted in one batch, with Cache-Control: no-store", async () => {
    const res = await post(Array.from({ length: 500 }, (_, i) => row(i)));
    assert.equal(res.status, 200);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.body.inserted, 500);
    assert.equal(await User.countDocuments(), 500);
});
