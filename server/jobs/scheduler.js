const cron = require("node-cron");

const { settingsFromConfig } = require("../services/crawl");
const { startCrawl } = require("../services/crawlRunner");

let task = null;

/** Schedules the crawl; every trigger goes through the crawl lock. Returns the task or null. */
function startScheduler({ config, logger, deps = {} }) {
    if (!config.CRON_ENABLED) {
        logger.info("cron disabled (CRON_ENABLED=false): no crawls scheduled");
        return null;
    }
    if (task) return task;

    task = cron.schedule(
        config.CRON_SCHEDULE,
        async () => {
            try {
                const run = await startCrawl(
                    { trigger: "cron", triggeredBy: "cron" },
                    { crawlOptions: settingsFromConfig(config), lockTtlMs: config.LOCK_TTL_MS, logger, ...deps }
                );
                if (!run.started) {
                    logger.info({ lock: run.lock }, "cron crawl skipped: another crawl holds the lock");
                    return;
                }
                await run.done;
            } catch (err) {
                logger.error({ err }, "cron crawl could not start");
            }
        },
        { timezone: config.CRON_TIMEZONE, noOverlap: true, name: "crawl" }
    );
    logger.info({ schedule: config.CRON_SCHEDULE, timezone: config.CRON_TIMEZONE }, "cron crawl scheduled");
    return task;
}

async function stopScheduler() {
    if (!task) return;
    const current = task;
    task = null;
    await current.destroy();
}

module.exports = { startScheduler, stopScheduler };
