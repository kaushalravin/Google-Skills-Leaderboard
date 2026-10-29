const { createApp } = require("../../app");
const { createLogger } = require("../../config/logger");
const { testConfig } = require("./env");

/** `crawlDeps`: passed through to startCrawl by the admin routes (e.g. a stubbed scrape). */
function buildTestApp(configOverrides = {}, { crawlDeps = {} } = {}) {
    const config = testConfig(configOverrides);
    const logger = createLogger({ level: "silent" });
    return { app: createApp({ config, logger, crawlDeps }), config, logger };
}

module.exports = { buildTestApp };
