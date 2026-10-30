// Tests run with the same forced TZ=UTC as the server.
require("../../config/timezone");
const { loadEnv } = require("../../config/env");

const TEST_ADMIN_KEY = "test-admin-key-0123456789abcdef0123";

/** A minimal valid env source; override any variable per test. */
function testEnvSource(overrides = {}) {
    return {
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        MONGO_URI: "mongodb://127.0.0.1:27017/leaderboard-test",
        ADMIN_API_KEY: TEST_ADMIN_KEY,
        CRON_ENABLED: "false",
        // Tests share one app (and its limiters) across many requests; rate-limit tests set low limits.
        RATE_LIMIT_PUBLIC_PER_MIN: "100000",
        RATE_LIMIT_ADMIN_PER_MIN: "100000",
        ...overrides
    };
}

function testConfig(overrides = {}) {
    return loadEnv(testEnvSource(overrides));
}

module.exports = { TEST_ADMIN_KEY, testEnvSource, testConfig };
