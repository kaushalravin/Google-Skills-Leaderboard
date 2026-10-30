const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { startHarness, badge, participant, assertPublicResponsesClean, ObjectId } = require("./helpers/harness");

const T = {
    compute: "The Basics of Google Cloud Compute",
    iam: "Configure Service Accounts and IAM Roles for Google Cloud",
    speechLang: "Implement Speech and Language Solutions with Pre-trained APIs",
    aiStudio: "Develop AI-Powered Prototypes in Google AI Studio",
    vision: "Analyze Images with the Cloud Vision API",
    website: "Build a Website on Google Cloud",
    gemini: "Create Your First Gemini Enterprise Application",
    storage: "Store, Process, and Manage Data on Google Cloud - Console",
    speechApi: "Using the Google Cloud Speech API",
    genAi: "Explore Generative AI in Agent Platform"
};

let h;
before(async () => {
    h = await startHarness();
});
after(async () => {
    await h?.stop();
});

test("1: accepted badges all earned before Oct 26 give 0 valid badges and the bottom rank", async () => {
    const s = await h.newServer();
    s.setProfiles({
        early: { badges: [badge(T.compute, "Oct 1, 2026"), badge(T.website, "Oct 25, 2026")] },
        later: { badges: [badge(T.vision, "Oct 27, 2026")] }
    });
    await s.ingest([participant("early", "Early Bird"), participant("later", "Later")]);
    const run = await s.crawl();
    assert.equal(run.status, "success");

    const board = await s.board();
    assert.deepEqual(board.rows.map((r) => [r.rank, r.username, r.validBadgeCount]), [[1, "Later", 1], [2, "Early Bird", 0]]);
    assert.equal((await s.user("Early Bird")).badgeCount, 0);
    assert.equal((await s.userBadges("Early Bird")).length, 2, "pre-start badges are stored, just not counted");
});

test("2: three accepted badges before Oct 26 and two after count exactly 2", async () => {
    const s = await h.newServer();
    s.setProfiles({
        mix: {
            badges: [
                badge(T.compute, "Oct 10, 2026"),
                badge(T.iam, "Oct 20, 2026"),
                badge(T.vision, "Oct 25, 2026"),
                badge(T.website, "Oct 26, 2026"),
                badge(T.storage, "Oct 28, 2026")
            ]
        }
    });
    await s.ingest(participant("mix", "Mix"));
    await s.crawl();
    const row = await s.row("Mix");
    assert.equal(row.validBadgeCount, 2);
    assert.deepEqual(row.badges.map((b) => b.name), [T.website, T.storage]);
    assert.equal((await s.user("Mix")).badgeCount, 2);
});

test("3: the boundary: Oct 25 doesn't count, Oct 26 does (stored as UTC midnight)", async () => {
    const s = await h.newServer();
    s.setProfiles({ edge: { badges: [badge(T.compute, "Oct 25, 2026"), badge(T.website, "Oct 26, 2026")] } });
    await s.ingest(participant("edge", "Edge"));
    await s.crawl();
    const row = await s.row("Edge");
    assert.equal(row.validBadgeCount, 1);
    assert.equal(row.badges[0].name, T.website);
    assert.equal(row.latestValidBadgeAt, "2026-10-26T00:00:00.000Z");
    const stored = await s.userBadges("Edge");
    assert.deepEqual(stored.map((r) => r.earnedAt.toISOString()), ["2026-10-25T00:00:00.000Z", "2026-10-26T00:00:00.000Z"]);
});

test("4: badges that aren't in the CSV are ignored and never persisted", async () => {
    const s = await h.newServer();
    s.setProfiles({
        other: {
            badges: [
                badge("Introduction to Generative AI", "Oct 27, 2026"),
                badge("Google Cloud Fundamentals: Core Infrastructure", "Oct 28, 2026"),
                badge(T.gemini, "Oct 29, 2026")
            ]
        }
    });
    await s.ingest(participant("other", "Other"));
    await s.crawl();
    assert.equal((await s.row("Other")).validBadgeCount, 1);
    const names = (await s.db.collection("badges").find().toArray()).map((b) => b.name);
    assert.deepEqual(names, [T.gemini]);
    assert.equal(await s.db.collection("userbadges").countDocuments(), 1);
});

test("5: the same badge twice on a profile keeps the earliest date (Oct 20), so it doesn't count", async () => {
    const s = await h.newServer();
    s.setProfiles({ twice: { badges: [badge(T.vision, "Oct 28, 2026"), badge(T.vision, "Oct 20, 2026")] } });
    await s.ingest(participant("twice", "Twice"));
    await s.crawl();
    const rows = await s.userBadges("Twice");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].earnedAt.toISOString(), "2026-10-20T00:00:00.000Z");
    assert.equal((await s.row("Twice")).validBadgeCount, 0);
});

test("6: a malformed date is skipped, not counted, and doesn't break the run", async () => {
    const s = await h.newServer();
    s.setProfiles({
        odd: { badges: [{ title: T.compute, earned: "Earned recently" }, badge(T.website, "Oct 27, 2026")] }
    });
    await s.ingest(participant("odd", "Odd"));
    const run = await s.crawl();
    assert.equal(run.status, "success");
    assert.equal(run.counts.badgesSkippedNoDate, 1);
    assert.equal((await s.row("Odd")).validBadgeCount, 1);
    assert.deepEqual((await s.userBadges("Odd")).map((r) => r.badge.name), [T.website]);
});

test("7: all 10 accepted titles after Oct 26 give 10 valid badges and rank 1", async () => {
    const s = await h.newServer();
    const titles = Object.values(T);
    s.setProfiles({
        all: { badges: titles.map((title, i) => badge(title, `Oct ${27 + (i % 4)}, 2026`)) },
        some: { badges: [badge(T.compute, "Oct 27, 2026")] }
    });
    await s.ingest([participant("some", "Some"), participant("all", "All Ten")]);
    await s.crawl();
    const board = await s.board();
    assert.deepEqual([board.rows[0].rank, board.rows[0].username, board.rows[0].validBadgeCount], [1, "All Ten", 10]);
    assert.ok(board.rows[0].badges.some((b) => b.name === "Store, Process, and Manage Data on Google Cloud - Console"));
    assert.equal((await s.user("All Ten")).badgeCount, 10);
});

test("8: ranking by count, then credits, then earlier latest badge; identical triples share a rank; 0-badge last; paging and search keep global ranks", async () => {
    const s = await h.newServer();
    s.setProfiles({
        a: { badges: [badge(T.compute, "Oct 26, 2026"), badge(T.iam, "Oct 27, 2026"), badge(T.vision, "Oct 28, 2026")] },
        b: { badges: [badge(T.compute, "Oct 26, 2026"), badge(T.website, "Oct 27, 2026")] },
        c: { badges: [badge(T.iam, "Oct 26, 2026"), badge(T.website, "Oct 27, 2026")] },
        d: { badges: [badge(T.compute, "Oct 26, 2026"), badge(T.website, "Oct 29, 2026")] },
        e: { badges: [] },
        f: { mode: "noBadges" },
        // Same count: more credits beats an earlier date, and the other way round.
        g: { badges: [badge(T.storage, "Oct 26, 2026"), badge(T.speechApi, "Oct 26, 2026")] },
        h: { badges: [badge(T.genAi, "Oct 30, 2026"), badge(T.vision, "Oct 30, 2026")] }
    });
    await s.ingest([
        participant("f", "Fay"),
        participant("d", "Dev"),
        participant("b", "Ben"),
        participant("g", "Gus"),
        participant("e", "Eli"),
        participant("c", "Cara"),
        participant("h", "Hana"),
        participant("a", "Asha")
    ]);
    await s.crawl();

    const board = await s.board();
    assert.deepEqual(board.rows.map((r) => [r.rank, r.username, r.validBadgeCount, r.validCredits]), [
        [1, "Asha", 3, 20],
        [2, "Hana", 2, 28],
        [3, "Ben", 2, 17],
        [3, "Cara", 2, 17],
        [5, "Dev", 2, 17],
        [6, "Gus", 2, 7],
        [7, "Eli", 0, 0],
        [7, "Fay", 0, 0]
    ]);
    const hana = await s.board(`/${board.rows[1].userId}`);
    assert.deepEqual([hana.rank, hana.validBadgeCount, hana.validCredits], [2, 2, 28]);

    const page2 = await s.board("?page=2&limit=2");
    assert.deepEqual(page2.rows.map((r) => [r.rank, r.username]), [[3, "Ben"], [3, "Cara"]]);
    assert.deepEqual(page2.pagination, { page: 2, limit: 2, total: 8, totalPages: 4 });

    const search = await s.board("?search=dev");
    assert.deepEqual(search.rows.map((r) => [r.rank, r.username]), [[5, "Dev"]]);
    assert.equal(search.pagination.total, 1);
});

test("9: progress between crawls raises the count, updates ranks and advances lastSuccessfulUpdate", async () => {
    const s = await h.newServer();
    const profiles = {
        p: { badges: [badge(T.compute, "Oct 27, 2026")] },
        q: { badges: [badge(T.compute, "Oct 26, 2026"), badge(T.website, "Oct 27, 2026")] }
    };
    s.setProfiles(profiles);
    await s.ingest([participant("p", "Priya"), participant("q", "Quinn")]);
    await s.crawl();
    const first = await s.board();
    assert.deepEqual(first.rows.map((r) => [r.rank, r.username, r.validBadgeCount]), [[1, "Quinn", 2], [2, "Priya", 1]]);

    profiles.p.badges.push(badge(T.vision, "Oct 26, 2026"), badge(T.storage, "Oct 29, 2026"));
    s.setProfiles(profiles);
    await s.crawl();
    const second = await s.board();
    assert.deepEqual(second.rows.map((r) => [r.rank, r.username, r.validBadgeCount]), [[1, "Priya", 3], [2, "Quinn", 2]]);
    assert.ok(new Date(second.lastSuccessfulUpdate) > new Date(first.lastSuccessfulUpdate));
    assert.equal((await s.user("Priya")).badgeCount, 3);
});

test("10: legacy rows (crawl-time stamp, IST midnight) don't count until a crawl corrects them to the profile dates", async () => {
    const s = await h.newServer();
    const [seeded] = await s.seedUsers([{ id: "legacy", username: "Legacy" }]);
    const user = await s.user("Legacy");
    const badges = await s.db.collection("badges").insertMany([
        { externalId: "legacy-754", name: T.compute, badgeUrl: "https://www.skills.google/public_profiles/legacy/badges/legacy-754", imageUrl: null, __v: 0 },
        { externalId: "legacy-638", name: T.website, badgeUrl: "https://www.skills.google/public_profiles/legacy/badges/legacy-638", imageUrl: null, __v: 0 }
    ]);
    const legacy = await s.db.collection("userbadges").insertMany([
        { user: user._id, badge: badges.insertedIds[0], earnedAt: new Date("2026-10-27T10:11:12.345Z"), __v: 0 }, // old crawl-time stamp
        { user: user._id, badge: badges.insertedIds[1], earnedAt: new Date("2026-10-25T18:30:00.000Z"), __v: 0 } // "Oct 26" at IST midnight
    ]);

    // An ingestion rebuilds the snapshot before any crawl: neither legacy row counts yet.
    await s.ingest(participant("other", "Other"));
    assert.equal((await s.row("Legacy")).validBadgeCount, 0);

    s.setProfiles({
        legacy: { badges: [badge(T.compute, "Oct 27, 2026"), badge(T.website, "Oct 26, 2026")] },
        other: { badges: [] }
    });
    await s.crawl();
    const rows = await s.userBadges("Legacy");
    assert.deepEqual(rows.map((r) => String(r._id)).sort(), Object.values(legacy.insertedIds).map(String).sort(), "same rows, corrected in place");
    assert.deepEqual(rows.map((r) => [r.badge.name, r.earnedAt.toISOString()]), [
        [T.website, "2026-10-26T00:00:00.000Z"],
        [T.compute, "2026-10-27T00:00:00.000Z"]
    ]);
    assert.equal((await s.row("Legacy")).validBadgeCount, 2);
    assert.equal(await s.db.collection("badges").countDocuments(), 2, "the legacy Badge docs were reused");
    assert.equal(seeded.skillsUrl, (await s.user("Legacy")).skillsUrl);
});

test("11: a participant ingested after a crawl appears with 0 badges and lastSuccessfulUpdate is unchanged", async () => {
    const s = await h.newServer();
    s.setProfiles({ early: { badges: [badge(T.compute, "Oct 27, 2026")] } });
    await s.ingest(participant("early", "Early"));
    await s.crawl();
    const before = await s.board();

    const res = await s.ingest(participant("late", "Latecomer"));
    assert.equal(res.status, 200);
    assert.equal(res.body.inserted, 1);
    const after = await s.board();
    assert.equal(after.lastSuccessfulUpdate, before.lastSuccessfulUpdate);
    assert.deepEqual(after.rows.map((r) => [r.rank, r.username, r.validBadgeCount]), [[1, "Early", 1], [2, "Latecomer", 0]]);
    assert.ok(ObjectId.isValid(after.rows[1].userId));
});

test("31 (this file): no public response contained an email, '@' or internal details", () => {
    assertPublicResponsesClean();
});
