require("../../config/timezone");

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const axios = require("axios");
const XLSX = require("xlsx");

const SERVER_ROOT = path.resolve(__dirname, "../..");
const at = (rel) => path.join(SERVER_ROOT, rel);

// sha256 of each protected file as committed in 34b7e84 (git cat-file -p 34b7e84:<path>).
const PROTECTED = {
    "scraper/webScraper.js": "5742813ae7682cf72cc6111c0e8318759701ee43290ca8fcc8a685589507c75b",
    "scraper/test.js": "bf607742e03ac1c5a386f9406bb8c4026f198d2e430f14d83172d9cb1234a593",
    "seeds/userSeed.js": "3c092ccd7cb356614ff55385584c25ed3e195323707109099814fcd65ba83d4c",
    "models/users.js": "d20eab6bf9d5ddccbda9f4433af46521feb03561130eb71b9aa83f354fc854a4",
    "models/badges.js": "09b61db47388a77bab2387e7b91616544a4645200905b4b1e7c153542afdfd9b",
    "models/userBadges.js": "096b39b5947a105cbae1aafe2f0225f2da7c7c949f6de5ede6ff5b9f09783287"
};

// The organisers' list, in CSV order.
const EXPECTED_BADGES = [
    ["The Basics of Google Cloud Compute", "https://www.skills.google/course_templates/754", 4],
    ["Configure Service Accounts and IAM Roles for Google Cloud", "https://www.skills.google/course_templates/702", 4],
    ["Implement Speech and Language Solutions with Pre-trained APIs", "https://www.skills.google/course_templates/700", 4],
    ["Develop AI-Powered Prototypes in Google AI Studio", "https://www.skills.google/course_templates/1426", 0],
    ["Analyze Images with the Cloud Vision API", "https://www.skills.google/course_templates/633", 12],
    ["Build a Website on Google Cloud", "https://www.skills.google/course_templates/638", 13],
    ["Create Your First Gemini Enterprise Application", "https://www.skills.google/course_templates/1586/", 0],
    ["Store, Process, and Manage Data on Google Cloud - Console", "https://www.skills.google/course_templates/658", 3],
    ["Using the Google Cloud Speech API", "https://www.skills.google/course_templates/756", 4],
    ["Explore Generative AI in Agent Platform", "https://www.skills.google/course_templates/959", 16]
];

test("protected files are byte-identical to commit 34b7e84", () => {
    for (const [rel, expected] of Object.entries(PROTECTED)) {
        const actual = createHash("sha256").update(readFileSync(at(rel))).digest("hex");
        assert.equal(actual, expected, `${rel} was modified`);
    }
});

test("the protected scraper, models and scraper/test.js load with their exports", () => {
    const scraper = require("../../scraper/webScraper");
    assert.equal(typeof scraper.scrapeProfile, "function");
    assert.equal(typeof scraper.syncUserBadges, "function");
    assert.equal(typeof scraper.scrape, "function");

    assert.equal(require("../../models/users").User.modelName, "User");
    assert.equal(require("../../models/badges").Badge.modelName, "Badge");
    assert.equal(require("../../models/userBadges").UserBadge.modelName, "UserBadge");
    assert.equal(typeof require("../../scraper/test").test, "function");
});

test("seeds/userSeed.js is syntax-checked only (requiring it would run the seed)", () => {
    execFileSync(process.execPath, ["--check", at("seeds/userSeed.js")]);
});

test("Accepted Badges.csv has exactly the 10 organiser rows", () => {
    const workbook = XLSX.readFile(at("data/Accepted Badges.csv"));
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });

    assert.deepEqual(Object.keys(rows[0]), [
        "Course Name",
        "Course URL",
        "Type of Course",
        "# of credits required"
    ]);
    assert.deepEqual(
        rows.map((r) => [r["Course Name"], r["Course URL"], r["# of credits required"]]),
        EXPECTED_BADGES
    );
    assert.deepEqual([...new Set(rows.map((r) => r["Type of Course"]))], ["Skill Badge"]);
});

test("the protected scraper accepts all 10 titles and drops anything else", async (t) => {
    const { scrapeProfile } = require("../../scraper/webScraper");
    const card = (title, n) => `
        <div class="profile-badge">
          <a class="badge-image" href="/public_profiles/x/badges/${n}"><img src="https://cdn.example/${n}.png"></a>
          <span class="ql-title-medium l-mts">${title}</span>
          <span class="ql-body-medium l-mbs">Earned Oct 26, 2026 EDT</span>
        </div>`;
    const titles = [...EXPECTED_BADGES.map(([name]) => name), "Using the Google Cloud Speech API Level 2", "Some Other Course"];
    const html = `<div class="profile-badges">${titles.map(card).join("")}</div>`;

    t.mock.method(axios, "get", async () => ({ data: html }));
    const badges = await scrapeProfile("https://www.skills.google/public_profiles/test");

    assert.deepEqual(badges.map((b) => b.name), EXPECTED_BADGES.map(([name]) => name));
    // With TZ=UTC the displayed calendar date is stored as UTC midnight.
    assert.equal(badges[0].earnedAt.toISOString(), "2026-10-26T00:00:00.000Z");
});

test("the timezone module forces UTC even when the process starts in another zone", () => {
    const out = execFileSync(
        process.execPath,
        ["-e", 'require("./config/timezone").assertUtc(); console.log(new Date("Oct 26, 2026").toISOString())'],
        { cwd: SERVER_ROOT, env: { ...process.env, TZ: "America/New_York" }, encoding: "utf8" }
    );
    assert.equal(out.trim(), "2026-10-26T00:00:00.000Z");
});
