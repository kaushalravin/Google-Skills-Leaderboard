require("../../config/timezone");

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { MongoClient } = require("mongodb");

const { testConfig } = require("../helpers/env");
const { runScript } = require("../helpers/childProcess");

const CLI = path.resolve(__dirname, "../../scripts/check-real.js");
let replSet;

before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
});

after(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
});

test("check:real against an empty DB writes nothing and creates no collections", async (t) => {
    const uri = replSet.getUri("check-empty");
    const { code, stdout, stderr } = await runScript(CLI, [], uri);
    assert.equal(code, 0, stderr);
    assert.match(stdout, /users crawled: 0/);
    assert.match(stdout, /no user with a skillsUrl; skipped/);
    assert.match(stdout, /no collection\s+users \(email\) \(the server creates it at startup\)/);
    assert.doesNotMatch(stdout, /WARNING/);
    assert.match(stdout, /No data was written\.\s*$/);

    const client = await MongoClient.connect(uri);
    t.after(() => client.close());
    assert.deepEqual(await client.db("check-empty").listCollections().toArray(), []);
});

test("check:real reports counts, failures, Oct-25 badges and raw Earned texts without writing", async (t) => {
    const uri = replSet.getUri("check-data");
    const client = await MongoClient.connect(uri);
    t.after(() => client.close());
    const db = client.db("check-data");
    const urls = ["a", "b", "c"].map((s) => `https://www.skills.google/public_profiles/user-${s}`);
    await db.collection("users").insertMany([
        { username: "Asha", email: "a@x.io", skillsEmail: "a@s.io", skillsUrl: urls[0], badgeCount: 0, credits: 0 },
        { username: "Ben", email: "b@x.io", skillsEmail: "b@s.io", skillsUrl: urls[1], badgeCount: 0, credits: 0 },
        { username: "Chen", email: "c@x.io", skillsEmail: "c@s.io", skillsUrl: urls[2], badgeCount: 0, credits: 0 }
    ]);
    const dump = async () =>
        Object.fromEntries(
            await Promise.all(
                ["users", "badges", "userbadges"].map(async (c) => [c, await db.collection(c).find().toArray()])
            )
        );
    const before = await dump();
    const indexesBefore = await db.collection("users").indexes();

    const badge = (name, date) => ({ externalId: "1", name, badgeUrl: "https://x/badges/1", imageUrl: null, earnedAt: new Date(date) });
    const scrape = async (url) => {
        if (url === urls[0]) return [badge("Build a Website on Google Cloud", "2026-10-27"), badge("Analyze Images with the Cloud Vision API", "2026-10-25")];
        if (url === urls[1]) throw Object.assign(new Error("HTTP 404"), { isAxiosError: true, response: { status: 404, headers: {} } });
        return [];
    };
    const get = async () => ({ data: "<html><body><span>Earned Oct 27, 2026 EDT</span><span>Earned  Oct 25, 2026\n EDT</span></body></html>" });

    mongoose.set("autoIndex", false);
    mongoose.set("autoCreate", false);
    await mongoose.connect(uri);
    const lines = [];
    const { checkReal } = require("../../scripts/check-real");
    await checkReal({ config: testConfig({ CRAWL_MIN_GAP_MS: "0" }), scrape, get, out: (line) => lines.push(line) });
    const text = lines.join("\n");

    assert.match(text, /\s1 valid\s+2 whitelisted\s+Asha/);
    assert.match(text, /users crawled: 3, succeeded: 2, failed: 1/);
    assert.match(text, /http_404: 1 \(Ben\)/);
    assert.match(text, /dated exactly 2026-10-25[^\n]*\nAsha: Analyze Images with the Cloud Vision API/);
    assert.match(text, /profile of Asha\nEarned Oct 27, 2026 EDT\nEarned Oct 25, 2026 EDT/);
    assert.doesNotMatch(text, /@/, "no emails in the output");
    // The users collection was created without the schema's indexes: duplicate protection is off.
    assert.match(text, /MISSING\s+users \(email\)\nMISSING\s+users \(skillsEmail\)\nMISSING\s+users \(skillsUrl\)/);
    assert.match(text, /no collection\s+userbadges \(user \+ badge\)/);
    assert.match(text, /WARNING: duplicate protection is OFF for users \(email\), users \(skillsEmail\), users \(skillsUrl\)\./);
    assert.match(text, /already\nholds duplicate values/);
    assert.match(text, /No data was written\.$/);

    assert.deepEqual(await dump(), before);
    assert.deepEqual(await db.collection("users").indexes(), indexesBefore, "check:real never creates indexes");
    assert.deepEqual((await db.listCollections().toArray()).map((c) => c.name).sort(), ["users"]);
});

test("check:real reports every unique index ok, with no warning, when they all exist", async (t) => {
    const uri = replSet.getUri("check-indexes");
    const client = await MongoClient.connect(uri);
    t.after(() => client.close());
    const db = client.db("check-indexes");
    await db.collection("users").createIndexes([
        { key: { email: 1 }, unique: true },
        { key: { skillsEmail: 1 }, unique: true },
        { key: { skillsUrl: 1 }, unique: true }
    ]);
    await db.collection("userbadges").createIndex({ user: 1, badge: 1 }, { unique: true });
    const indexes = async () => [await db.collection("users").indexes(), await db.collection("userbadges").indexes()];
    const before = await indexes();

    const { code, stdout, stderr } = await runScript(CLI, [], uri);
    assert.equal(code, 0, stderr);
    assert.match(stdout, /ok\s+users \(email\)\nok\s+users \(skillsEmail\)\nok\s+users \(skillsUrl\)\nok\s+userbadges \(user \+ badge\)/);
    assert.doesNotMatch(stdout, /WARNING|MISSING/);
    assert.deepEqual(await indexes(), before, "check:real never creates or changes indexes");
});
