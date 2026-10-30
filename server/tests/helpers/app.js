const assert = require("node:assert/strict");

const { createApp } = require("../../app");
const { createLogger } = require("../../config/logger");
const { testConfig } = require("./env");

/** `crawlDeps`: passed through to startCrawl by the admin routes (e.g. a stubbed scrape). */
function buildTestApp(configOverrides = {}, { crawlDeps = {} } = {}) {
    const config = testConfig(configOverrides);
    const logger = createLogger({ level: "silent" });
    return { app: createApp({ config, logger, crawlDeps }) };
}

/** The standard error body: { error: { code, message, requestId } }, JSON, no stack. */
function assertErrorShape(res, status, code) {
    assert.equal(res.status, status);
    assert.match(res.headers["content-type"], /application[/]json/);
    assert.equal(res.body.error.code, code);
    assert.equal(typeof res.body.error.message, "string");
    assert.equal(res.body.error.requestId, res.headers["x-request-id"]);
    assert.equal(res.body.error.stack, undefined);
}

module.exports = { buildTestApp, assertErrorShape };
