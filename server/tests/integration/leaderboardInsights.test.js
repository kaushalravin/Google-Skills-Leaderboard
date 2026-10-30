require("../../config/timezone");

const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { leaderboardSuite, makeUser, award, rebuild, getSnapshot } = require("../helpers/leaderboard");
const { UserBadge } = require("../../models/userBadges");
const { Leaderboard } = require("../../models/leaderboard");

const COMPUTE = "The Basics of Google Cloud Compute";
const WEBSITE = "Build a Website on Google Cloud";
const VISION = "Analyze Images with the Cloud Vision API";
const IAM = "Configure Service Accounts and IAM Roles for Google Cloud";
const CSV_ORDER = [
    COMPUTE,
    IAM,
    "Implement Speech and Language Solutions with Pre-trained APIs",
    "Develop AI-Powered Prototypes in Google AI Studio",
    VISION,
    WEBSITE,
    "Create Your First Gemini Enterprise Application",
    "Store, Process, and Manage Data on Google Cloud - Console",
    "Using the Google Cloud Speech API",
    "Explore Generative AI in Agent Platform"
];

const suite = leaderboardSuite();

const crawl = (at) => rebuild({ lastSuccessfulUpdate: new Date(at) });
const ingestion = () => rebuild({});
const list = (query = "") => request(suite.app).get(`/api/leaderboard${query}`);
const one = (userId) => request(suite.app).get(`/api/leaderboard/${userId}`);
const movement = async () => (await list()).body.rows.map((r) => [r.username, r.rank, r.previousRank]);

test("movement after two crawls: previousRank is the rank in the replaced snapshot", async () => {
    const ann = await makeUser("Ann");
    const bob = await makeUser("Bob");
    const cat = await makeUser("Cat");
    await award(ann, COMPUTE, "2026-10-26");
    await award(ann, WEBSITE, "2026-10-26");
    await award(bob, COMPUTE, "2026-10-26");

    await crawl("2026-10-27T06:00:00Z");
    assert.deepEqual(await movement(), [["Ann", 1, null], ["Bob", 2, null], ["Cat", 3, null]]);

    await award(cat, COMPUTE, "2026-10-27");
    await award(cat, WEBSITE, "2026-10-27");
    await award(cat, VISION, "2026-10-27");
    await crawl("2026-10-27T12:00:00Z");
    assert.deepEqual(await movement(), [["Cat", 1, 3], ["Ann", 2, 1], ["Bob", 3, 2]]);

    await crawl("2026-10-27T18:00:00Z");
    assert.deepEqual(await movement(), [["Cat", 1, 1], ["Ann", 2, 2], ["Bob", 3, 3]]);
});

test("ingestion carries previousRank over unchanged; a new participant gets null, also after a crawl", async () => {
    const ann = await makeUser("Ann");
    const bob = await makeUser("Bob");
    await award(ann, COMPUTE, "2026-10-26");
    await crawl("2026-10-27T06:00:00Z");
    await award(bob, COMPUTE, "2026-10-26");
    await award(bob, WEBSITE, "2026-10-26");
    const crawledAt = new Date("2026-10-27T12:00:00Z");
    await crawl(crawledAt);
    assert.deepEqual(await movement(), [["Bob", 1, 2], ["Ann", 2, 1]]);

    await makeUser("Dan");
    await ingestion();
    assert.deepEqual(await movement(), [["Bob", 1, 2], ["Ann", 2, 1], ["Dan", 3, null]]);
    assert.equal((await getSnapshot()).lastSuccessfulUpdate.toISOString(), crawledAt.toISOString());

    await ingestion();
    assert.deepEqual(await movement(), [["Bob", 1, 2], ["Ann", 2, 1], ["Dan", 3, null]], "repeated ingestion is stable");

    // Dan was ingested, Eve added without any rebuild: neither was on the board at the last crawl.
    await makeUser("Eve");
    await crawl("2026-10-27T18:00:00Z");
    assert.deepEqual(await movement(), [["Bob", 1, 1], ["Ann", 2, 2], ["Dan", 3, null], ["Eve", 3, null]]);
});

test("dailyCounts: one entry per day from the start to the last crawl, zero days included, same rule as ranking", async () => {
    const ann = await makeUser("Ann");
    const bob = await makeUser("Bob");
    await makeUser("Cat");
    await award(ann, COMPUTE, "2026-10-26");
    await award(bob, COMPUTE, "2026-10-26");
    await award(ann, WEBSITE, "2026-10-28");
    await award(ann, WEBSITE, "2026-10-27", { newBadgeDoc: true });   // duplicate name: counts once, earliest date
    await award(bob, "Some Other Badge", "2026-10-29");               // not whitelisted
    await award(bob, VISION, "2026-10-25");                           // before start
    await award(bob, IAM, "2026-10-29T10:11:05.000Z");                // legacy stamp with seconds

    await crawl("2026-10-30T06:00:00Z");
    const { body } = await list();
    assert.deepEqual(body.dailyCounts, [
        { date: "2026-10-26", count: 2 },
        { date: "2026-10-27", count: 1 },
        { date: "2026-10-28", count: 0 },
        { date: "2026-10-29", count: 0 },
        { date: "2026-10-30", count: 0 }
    ]);
    assert.equal(body.totalValidBadges, 3);
    assert.equal(body.totalValidBadges, body.rows.reduce((sum, r) => sum + r.validBadgeCount, 0));
    assert.equal(body.dailyCounts.reduce((sum, d) => sum + d.count, 0), body.totalValidBadges);

    // The whole board, independent of search and pagination.
    for (const query of ["?search=cat", "?page=2&limit=1", "?page=9"]) {
        const res = await list(query);
        assert.equal(res.body.totalValidBadges, 3, query);
        assert.deepEqual(res.body.dailyCounts, body.dailyCounts, query);
        assert.deepEqual(res.body.badgeStats, body.badgeStats, query);
    }

    await rebuild({ lastSuccessfulUpdate: new Date("2026-10-30T06:00:00Z"), endDate: "2026-10-27" });
    assert.deepEqual((await list()).body.dailyCounts, [
        { date: "2026-10-26", count: 2 },
        { date: "2026-10-27", count: 1 }
    ], "never past the end date");
});

test("dailyCounts without a crawl runs to the latest counted badge, and is empty with no badges", async () => {
    const ann = await makeUser("Ann");
    await ingestion();
    assert.deepEqual((await list()).body.dailyCounts, []);
    assert.equal((await list()).body.totalValidBadges, 0);

    await award(ann, COMPUTE, "2026-10-28");
    await ingestion();
    assert.deepEqual((await list()).body.dailyCounts, [
        { date: "2026-10-26", count: 0 },
        { date: "2026-10-27", count: 0 },
        { date: "2026-10-28", count: 1 }
    ]);

    // A badge dated after the crawl's UTC day (profiles show dates in another zone) is still included.
    await award(ann, WEBSITE, "2026-10-29");
    await crawl("2026-10-28T20:00:00Z");
    assert.deepEqual((await list()).body.dailyCounts.slice(-2), [
        { date: "2026-10-28", count: 1 },
        { date: "2026-10-29", count: 1 }
    ]);
});

test("badgeStats: the 10 accepted badges in CSV order, earnedBy counts participants under the ranking rule", async () => {
    const ann = await makeUser("Ann");
    const bob = await makeUser("Bob");
    await award(ann, COMPUTE, "2026-10-26");
    await award(ann, COMPUTE, "2026-10-27", { newBadgeDoc: true });
    await award(bob, COMPUTE, "2026-10-27");
    await award(ann, VISION, "2026-10-27");
    await award(bob, VISION, "2026-10-25");                     // before start
    await award(bob, WEBSITE, "2026-10-27T00:00:00.123Z");      // milliseconds
    await award(bob, "Some Other Badge", "2026-10-27");

    await crawl("2026-10-28T06:00:00Z");
    const { body } = await list();
    assert.deepEqual(body.badgeStats.map((s) => s.name), CSV_ORDER);
    const earned = Object.fromEntries(body.badgeStats.map((s) => [s.name, s.earnedBy]));
    assert.equal(earned[COMPUTE], 2);
    assert.equal(earned[VISION], 1);
    assert.equal(earned[WEBSITE], 0);
    assert.equal(body.badgeStats.reduce((sum, s) => sum + s.earnedBy, 0), body.totalValidBadges);
    for (const stat of body.badgeStats) assert.deepEqual(Object.keys(stat).sort(), ["earnedBy", "name"]);
});

test("GET /:userId: position, totalParticipants and ahead (strictly better rank; null at rank 1)", async () => {
    const top = await makeUser("Top");
    const alpha = await makeUser("Alpha");
    const bravo = await makeUser("Bravo");
    const last = await makeUser("Last");
    await award(top, COMPUTE, "2026-10-26");
    await award(top, WEBSITE, "2026-10-26");
    for (const u of [alpha, bravo]) await award(u, COMPUTE, "2026-10-26");
    await crawl("2026-10-27T06:00:00Z");

    const get = async (user) => {
        const res = await one(user._id);
        assert.equal(res.status, 200);
        assert.ok(!/email|@example\.com/i.test(res.text), res.text);
        return res.body;
    };

    const first = await get(top);
    assert.deepEqual([first.rank, first.position, first.totalParticipants, first.ahead], [1, 1, 4, null]);
    assert.equal(first.username, "Top");
    assert.equal(first.badges.length, 2);
    assert.equal(first.previousRank, null);

    const tiedA = await get(alpha);
    const tiedB = await get(bravo);
    assert.deepEqual([tiedA.rank, tiedA.position, tiedB.rank, tiedB.position], [2, 2, 2, 3]);
    const topAhead = { rank: 1, username: "Top", validBadgeCount: 2, validCredits: 17 };
    assert.deepEqual(tiedA.ahead, topAhead);
    assert.deepEqual(tiedB.ahead, topAhead, "an equal rank is never 'ahead'");

    const bottom = await get(last);
    assert.deepEqual([bottom.rank, bottom.position, bottom.totalParticipants], [4, 4, 4]);
    assert.deepEqual(bottom.ahead, { rank: 2, username: "Bravo", validBadgeCount: 1, validCredits: 4 });

    // Everyone tied at rank 1: nobody is ahead.
    await UserBadge.deleteMany({});
    await crawl("2026-10-27T12:00:00Z");
    for (const user of [top, alpha, bravo, last]) assert.equal((await get(user)).ahead, null);
});

test("an old snapshot without totalValidBadges, badgeStats, dailyCounts or previousRank doesn't crash: they stay absent until a crawl rebuild", async () => {
    const ann = await makeUser("Ann");
    const bob = await makeUser("Bob");
    await award(bob, COMPUTE, "2026-10-26");
    await Leaderboard.collection.insertOne({
        _id: "current",
        lastSuccessfulUpdate: new Date("2026-10-28T00:00:00Z"),
        generatedAt: new Date("2026-10-28T00:00:00Z"),
        competitionStartDate: new Date("2026-10-26T00:00:00Z"),
        rows: [
            { rank: 1, userId: ann._id, username: "Ann", skillsUrl: ann.skillsUrl, validBadgeCount: 1, validCredits: 4,
                latestValidBadgeAt: new Date("2026-10-26T00:00:00Z"), badges: [] },
            { rank: 2, userId: bob._id, username: "Bob", skillsUrl: bob.skillsUrl, validBadgeCount: 0,
                latestValidBadgeAt: null, badges: [] }
        ]
    });

    const res = await list();
    assert.equal(res.status, 200);
    for (const key of ["totalValidBadges", "badgeStats", "dailyCounts"]) assert.ok(!(key in res.body), key);
    assert.ok(res.body.rows.every((r) => !("previousRank" in r)));

    const annRes = await one(ann._id);
    assert.equal(annRes.status, 200);
    assert.ok(!("previousRank" in annRes.body));
    assert.deepEqual([annRes.body.position, annRes.body.totalParticipants, annRes.body.ahead], [1, 2, null]);
    const bobRes = await one(bob._id);
    assert.equal(bobRes.status, 200);
    assert.equal(bobRes.body.validCredits, null);
    assert.deepEqual(bobRes.body.ahead, { rank: 1, username: "Ann", validBadgeCount: 1, validCredits: 4 });

    // Ingestion over an old snapshot doesn't invent movement, not even "new" for an added participant.
    await makeUser("Cat");
    await ingestion();
    let body = (await list()).body;
    assert.ok(body.rows.every((r) => !("previousRank" in r)));
    assert.equal(body.totalValidBadges, 1);

    await crawl("2026-10-29T06:00:00Z");
    body = (await list()).body;
    assert.deepEqual(body.rows.map((r) => [r.username, r.rank, r.previousRank]), [["Bob", 1, 1], ["Ann", 2, 2], ["Cat", 2, 2]]);
});

test("someone ingested between two crawls is new at the next crawl, then moves normally", async () => {
    const ann = await makeUser("Ann");
    const bob = await makeUser("Bob");
    await award(ann, COMPUTE, "2026-10-26");
    await award(ann, WEBSITE, "2026-10-26");
    await award(bob, COMPUTE, "2026-10-26");
    await crawl("2026-10-27T06:00:00Z");

    // Ingestion puts Cat in the snapshot at the bottom; the next crawl must not treat that as a rank she held.
    const cat = await makeUser("Cat");
    await ingestion();
    assert.deepEqual(await movement(), [["Ann", 1, null], ["Bob", 2, null], ["Cat", 3, null]]);

    await award(cat, COMPUTE, "2026-10-27");
    await award(cat, WEBSITE, "2026-10-27");
    await award(cat, VISION, "2026-10-27");
    await crawl("2026-10-27T12:00:00Z");
    assert.deepEqual(await movement(), [["Cat", 1, null], ["Ann", 2, 1], ["Bob", 3, 2]]);

    await award(bob, WEBSITE, "2026-10-27");
    await award(bob, VISION, "2026-10-27");
    await award(bob, IAM, "2026-10-27");
    await crawl("2026-10-27T18:00:00Z");
    assert.deepEqual(await movement(), [["Bob", 1, 3], ["Cat", 2, 1], ["Ann", 3, 2]]);

    const body = (await list()).body;
    assert.equal(body.crawlRanks, undefined, "the crawl baseline is internal");
});

test("a snapshot from before crawl ranks were stored falls back to its row ranks once", async () => {
    const ann = await makeUser("Ann");
    const bob = await makeUser("Bob");
    await award(bob, COMPUTE, "2026-10-26");
    await Leaderboard.collection.insertOne({
        _id: "current",
        lastSuccessfulUpdate: new Date("2026-10-27T06:00:00Z"),
        rows: [
            { rank: 1, previousRank: null, userId: ann._id, username: "Ann", validBadgeCount: 1, validCredits: 4 },
            { rank: 2, previousRank: null, userId: bob._id, username: "Bob", validBadgeCount: 0, validCredits: 0 }
        ]
    });
    await crawl("2026-10-27T12:00:00Z");
    assert.deepEqual(await movement(), [["Bob", 1, 2], ["Ann", 2, 1]]);
    assert.equal((await getSnapshot()).crawlRanks.length, 2);
});

test("dailyCounts never include a day after today in India", async () => {
    const ann = await makeUser("Ann");
    await award(ann, COMPUTE, "2026-10-26");
    await award(ann, WEBSITE, "2026-10-28");
    // A badge dated 30 Oct while it is still 29 Oct in India (and a crawl stamped later) must not add 30 Oct.
    await award(ann, VISION, "2026-10-30");
    const now = new Date("2026-10-29T12:00:00Z");
    await rebuild({ lastSuccessfulUpdate: new Date("2026-10-30T02:00:00Z"), now });
    const { dailyCounts } = (await list()).body;
    assert.deepEqual(dailyCounts.map((d) => d.date), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"]);

    // Just after midnight in India (18:30 UTC) the new day is included, even though it is still the 29th in UTC.
    await rebuild({ lastSuccessfulUpdate: new Date("2026-10-30T02:00:00Z"), now: new Date("2026-10-29T18:45:00Z") });
    const later = (await list()).body.dailyCounts;
    assert.equal(later.at(-1).date, "2026-10-30");
    assert.equal(later.at(-1).count, 1);
});
