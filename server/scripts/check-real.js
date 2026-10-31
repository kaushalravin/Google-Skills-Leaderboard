// Read-only check against a real database: dry-run crawl report + one raw profile fetch.
// Usage: npm run check:real      (needs server/.env with MONGO_URI and ADMIN_API_KEY)
// Writes nothing: Mongoose autoIndex/autoCreate are off and the crawl runs with dryRun.
const { assertUtc } = require("../config/timezone");

const mongoose = require("mongoose");
const axios = require("axios");
const cheerio = require("cheerio");

const { loadEnv, loadEnvFile, EnvError } = require("../config/env");
const { createLogger } = require("../config/logger");
const { connectDb, disconnectDb } = require("../config/db");
const { crawlAll, settingsFromConfig, DAY_MS } = require("../services/crawl");
const { scrapeProfile } = require("../scraper/webScraper");
const { User } = require("../models/users");

const EARNED_TEXT = /Earned\s+[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}(?:\s+[A-Z]{2,5}\b)?/g;

// The unique indexes that keep participants and awarded badges from being duplicated.
const UNIQUE_INDEXES = [
    ["users", { email: 1 }],
    ["users", { skillsEmail: 1 }],
    ["users", { skillsUrl: 1 }],
    ["userbadges", { user: 1, badge: 1 }]
];

function dayBefore(isoDate) {
    return new Date(Date.parse(`${isoDate}T00:00:00.000Z`) - DAY_MS).toISOString().slice(0, 10);
}

/** Read-only (listIndexes): "ok", "MISSING" or "no collection" for each unique index. */
async function uniqueIndexStates(db) {
    const listed = new Map();
    for (const [collection] of UNIQUE_INDEXES) {
        if (listed.has(collection)) continue;
        try {
            listed.set(collection, await db.collection(collection).listIndexes().toArray());
        } catch (err) {
            if (err.code !== 26) throw err; // NamespaceNotFound: the collection doesn't exist yet
            listed.set(collection, null);
        }
    }
    return UNIQUE_INDEXES.map(([collection, key]) => {
        const indexes = listed.get(collection);
        const label = `${collection} (${Object.keys(key).join(" + ")})`;
        if (!indexes) return { label, state: "no collection" };
        const found = indexes.some((i) => i.unique && JSON.stringify(i.key) === JSON.stringify(key));
        return { label, state: found ? "ok" : "MISSING" };
    });
}

/** Prints the report. `scrape` and `get` are injectable so tests never touch the network. */
async function checkReal({ config, scrape = scrapeProfile, get = axios.get, out = console.log, logger }) {
    const users = await User.find({}, { username: 1, skillsUrl: 1 }).sort({ _id: 1 }).lean();
    const nameOf = new Map(users.map((u) => [String(u._id), u.username]));

    // Record what each profile returned so the report can show badge dates.
    const scrapedByUrl = new Map();
    const capturingScrape = async (url) => {
        const badges = await scrape(url);
        scrapedByUrl.set(url, badges);
        return badges;
    };

    const result = await crawlAll({ ...settingsFromConfig(config), dryRun: true, scrape: capturingScrape, logger });

    out("\n== Per-user valid badge counts (dry run) ==");
    const rows = result.report
        .map((r) => ({ username: nameOf.get(r.userId) ?? r.userId, scraped: r.scraped, valid: r.valid }))
        .sort((a, b) => b.valid - a.valid || a.username.localeCompare(b.username));
    for (const r of rows) out(`${String(r.valid).padStart(3)} valid  ${String(r.scraped).padStart(3)} whitelisted  ${r.username}`);

    out("\n== Totals ==");
    out(`users crawled: ${result.total}, succeeded: ${result.succeeded}, failed: ${result.failed}`);
    out(`users with >= 1 valid badge: ${rows.filter((r) => r.valid > 0).length}`);
    out(`valid badges in total: ${rows.reduce((n, r) => n + r.valid, 0)}`);
    out(`badges skipped (no parseable date): ${result.badgesSkippedNoDate}`);

    out("\n== Failures by reason ==");
    const byReason = new Map();
    for (const f of result.failures) {
        const list = byReason.get(f.reason) ?? [];
        list.push(nameOf.get(f.userId) ?? f.userId);
        byReason.set(f.reason, list);
    }
    if (byReason.size === 0) out("none");
    for (const [reason, names] of [...byReason].sort()) out(`${reason}: ${names.length} (${names.join(", ")})`);
    if (result.failed > result.failures.length) out(`(only the first ${result.failures.length} of ${result.failed} failures are listed)`);

    const edgeDay = dayBefore(config.COMPETITION_START_DATE);
    out(`\n== Whitelisted badges dated exactly ${edgeDay} (do not count) ==`);
    const edge = [];
    for (const user of users) {
        for (const badge of scrapedByUrl.get(user.skillsUrl) ?? []) {
            if (badge.earnedAt instanceof Date && badge.earnedAt.toISOString().slice(0, 10) === edgeDay) {
                edge.push(`${user.username}: ${badge.name}`);
            }
        }
    }
    out(edge.length ? edge.join("\n") : "none");

    out("\n== Raw \"Earned …\" texts from one profile (plain GET, not the scraper) ==");
    const sample = users.find((u) => u.skillsUrl);
    if (!sample) {
        out("no user with a skillsUrl; skipped");
    } else {
        out(`profile of ${sample.username}`);
        try {
            const response = await get(sample.skillsUrl, { timeout: 15000 });
            // Match per leaf element: .text() on a parent joins siblings without a space.
            const $ = cheerio.load(response.data);
            const earned = new Set();
            $("body *").each((_, el) => {
                if ($(el).children().length > 0) return;
                const text = $(el).text().replace(/\s+/g, " ");
                for (const match of text.match(EARNED_TEXT) ?? []) earned.add(match);
            });
            out(earned.size ? [...earned].join("\n") : "no \"Earned …\" text found on the page");
        } catch (err) {
            out(`fetch failed: ${err.response?.status ? `HTTP ${err.response.status}` : err.code || err.message}`);
        }
    }

    out("\n== Unique indexes (duplicate protection) ==");
    const indexStates = await uniqueIndexStates(User.db.db);
    for (const { label, state } of indexStates) {
        out(`${state.padEnd(13)} ${label}${state === "no collection" ? " (the server creates it at startup)" : ""}`);
    }
    const missing = indexStates.filter((i) => i.state === "MISSING").map((i) => i.label);
    if (missing.length) {
        out(`WARNING: duplicate protection is OFF for ${missing.join(", ")}.`);
        out("The server builds these indexes at startup. A missing one usually means the collection already");
        out('holds duplicate values, so the build failed (look for "index build failed" in the server logs).');
        out("Find and resolve the duplicates, then restart the server.");
    }

    out("\nNo data was written.");
}

async function main() {
    assertUtc();
    loadEnvFile();
    let config;
    try {
        config = loadEnv();
    } catch (err) {
        if (!(err instanceof EnvError)) throw err;
        console.error(`Invalid environment configuration:\n${err.message}`);
        return 1;
    }

    // Read-only: no index builds or collection creation on connect.
    mongoose.set("autoIndex", false);
    mongoose.set("autoCreate", false);
    await connectDb(config.MONGO_URI, { serverSelectionTimeoutMS: config.MONGO_SERVER_SELECTION_TIMEOUT_MS });
    try {
        await checkReal({ config, logger: createLogger({ level: "silent" }) });
    } finally {
        await disconnectDb();
    }
    return 0;
}

if (require.main === module) {
    main()
        .then((code) => {
            process.exitCode = code;
        })
        .catch((err) => {
            console.error(err.stack || err);
            process.exitCode = 1;
        });
}

module.exports = { checkReal };
