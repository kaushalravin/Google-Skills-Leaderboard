// One crawl of every user.
// Usage: npm run crawl:once [-- --dry-run]
//   (default)  a real crawl through the crawl lock, recorded in crawler_logs; exits 2 if another crawl holds the lock.
//   --dry-run  scrape and report per-user valid counts; writes nothing, takes no lock (safe alongside a real crawl).
const { assertUtc } = require("../config/timezone");

const mongoose = require("mongoose");

const { loadEnv, loadEnvFile, EnvError } = require("../config/env");
const { createLogger } = require("../config/logger");
const { connectDb, disconnectDb } = require("../config/db");
const { crawlAll, settingsFromConfig } = require("../services/crawl");

async function main(argv) {
    assertUtc();
    loadEnvFile();
    const dryRun = argv.includes("--dry-run");

    let config;
    try {
        config = loadEnv();
    } catch (err) {
        if (!(err instanceof EnvError)) throw err;
        console.error(`Invalid environment configuration:\n${err.message}`);
        return 1;
    }

    if (dryRun) {
        console.warn("DRY RUN: scraping only; nothing will be written and no lock is taken.");
        // Mongoose otherwise builds model indexes and creates missing collections on connect.
        mongoose.set("autoIndex", false);
        mongoose.set("autoCreate", false);
    }

    const logger = createLogger({ level: config.LOG_LEVEL });
    const controller = new AbortController();
    process.once("SIGINT", () => {
        console.warn("Interrupted: finishing in-flight requests, no further writes.");
        controller.abort();
    });

    await connectDb(config.MONGO_URI, { serverSelectionTimeoutMS: config.MONGO_SERVER_SELECTION_TIMEOUT_MS });
    try {
        if (dryRun) {
            const { report, ...summary } = await crawlAll({
                ...settingsFromConfig(config),
                dryRun,
                logger,
                signal: controller.signal
            });
            console.table(report);
            console.log(JSON.stringify(summary, null, 2));
            return 0;
        }

        // Required only here so a dry run never registers the lock/log models.
        const { startCrawl } = require("../services/crawlRunner");
        const run = await startCrawl(
            { trigger: "cli", triggeredBy: "cli" },
            {
                crawlOptions: settingsFromConfig(config),
                lockTtlMs: config.LOCK_TTL_MS,
                logger,
                signal: controller.signal
            }
        );
        if (!run.started) {
            console.error(`Another crawl holds the lock: ${JSON.stringify(run.lock)}`);
            return 2;
        }
        const outcome = await run.done;
        console.log(JSON.stringify(outcome, null, 2));
        return outcome.status === "success" || outcome.status === "partial" ? 0 : 1;
    } finally {
        await disconnectDb();
    }
}

main(process.argv.slice(2))
    .then((code) => {
        process.exitCode = code;
    })
    .catch((err) => {
        console.error(err.stack || err);
        process.exitCode = 1;
    });
