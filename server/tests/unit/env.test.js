const { test } = require("node:test");
const assert = require("node:assert/strict");

const { loadEnv, EnvError } = require("../../config/env");
const { testEnvSource } = require("../helpers/env");

function problemsFor(source) {
    try {
        loadEnv(source);
    } catch (err) {
        assert.ok(err instanceof EnvError, `expected EnvError, got ${err}`);
        return err.problems;
    }
    assert.fail("expected loadEnv to throw");
}

test("applies documented defaults to a minimal env", () => {
    const config = loadEnv({
        MONGO_URI: "mongodb://localhost/x",
        ADMIN_API_KEY: "k".repeat(32)
    });
    assert.equal(config.NODE_ENV, "development");
    assert.equal(config.PORT, 3000);
    assert.equal(config.TRUST_PROXY, 1);
    assert.equal(config.COMPETITION_START_DATE, "2026-10-26");
    assert.equal(config.COMPETITION_END_DATE, undefined);
    assert.equal(config.CRON_SCHEDULE, "0 */6 * * *");
    assert.equal(config.CRON_TIMEZONE, "Asia/Kolkata");
    assert.equal(config.CRON_ENABLED, true);
    assert.equal(config.CRAWL_CONCURRENCY, 3);
    assert.equal(config.CRAWL_MIN_GAP_MS, 500);
    assert.equal(config.CRAWL_MAX_RETRIES, 3);
    assert.equal(config.CRAWL_RETRY_AFTER_MAX_MS, 120000);
    assert.equal(config.LOCK_TTL_MS, 120000);
    assert.equal(config.RATE_LIMIT_PUBLIC_PER_MIN, 120);
    assert.equal(config.RATE_LIMIT_ADMIN_PER_MIN, 30);
    assert.equal(config.STALE_AFTER_HOURS, 13);
    assert.equal(config.SUSPICIOUS_EMPTY_MIN_USERS, 5);
    assert.equal(config.SUSPICIOUS_EMPTY_RATIO, 0.3);
    assert.deepEqual(config.CORS_ORIGINS, []);
    assert.ok(Object.isFrozen(config));
});

test("missing MONGO_URI and ADMIN_API_KEY are both reported as required", () => {
    const problems = problemsFor({});
    assert.ok(problems.includes("MONGO_URI is required"), problems.join("; "));
    assert.ok(problems.includes("ADMIN_API_KEY is required"), problems.join("; "));
});

test("rejects a non-mongodb URI and a short admin key", () => {
    const problems = problemsFor(
        testEnvSource({ MONGO_URI: "http://example.com", ADMIN_API_KEY: "short" })
    );
    assert.ok(problems.some((p) => p.startsWith("MONGO_URI")));
    assert.ok(problems.some((p) => p.startsWith("ADMIN_API_KEY must be at least 32")));
});

test("competition dates must be real YYYY-MM-DD calendar dates", () => {
    assert.ok(
        problemsFor(testEnvSource({ COMPETITION_START_DATE: "2026-02-31" }))
            .some((p) => p.includes("not a real calendar date"))
    );
    assert.ok(
        problemsFor(testEnvSource({ COMPETITION_START_DATE: "26/10/2026" }))
            .some((p) => p.includes("YYYY-MM-DD"))
    );
});

test("end date may equal but not precede the start date", () => {
    assert.equal(
        loadEnv(testEnvSource({ COMPETITION_END_DATE: "2026-10-26" })).COMPETITION_END_DATE,
        "2026-10-26"
    );
    assert.deepEqual(
        problemsFor(testEnvSource({ COMPETITION_END_DATE: "2026-10-25" })),
        ["COMPETITION_END_DATE must not be before COMPETITION_START_DATE"]
    );
});

test("booleans accept only true/false/1/0", () => {
    assert.equal(loadEnv(testEnvSource({ CRON_ENABLED: "false" })).CRON_ENABLED, false);
    assert.equal(loadEnv(testEnvSource({ CRON_ENABLED: "1" })).CRON_ENABLED, true);
    assert.ok(problemsFor(testEnvSource({ CRON_ENABLED: "yes" }))[0].startsWith("CRON_ENABLED"));
});

test("numbers are coerced and range-checked", () => {
    const config = loadEnv(testEnvSource({ PORT: "8080", TRUST_PROXY: "2" }));
    assert.equal(config.PORT, 8080);
    assert.equal(config.TRUST_PROXY, 2);
    assert.ok(problemsFor(testEnvSource({ PORT: "abc" }))[0].startsWith("PORT"));
    assert.ok(problemsFor(testEnvSource({ PORT: "70000" }))[0].startsWith("PORT"));
    assert.ok(problemsFor(testEnvSource({ CRAWL_CONCURRENCY: "0" }))[0].startsWith("CRAWL_CONCURRENCY"));
});

test("empty strings fall back to defaults", () => {
    const config = loadEnv(testEnvSource({ PORT: "", COMPETITION_END_DATE: "" }));
    assert.equal(config.PORT, 3000);
    assert.equal(config.COMPETITION_END_DATE, undefined);
});

test("CORS_ORIGINS is split on commas and trimmed", () => {
    const config = loadEnv(testEnvSource({ CORS_ORIGINS: "https://a.example, https://b.example ," }));
    assert.deepEqual(config.CORS_ORIGINS, ["https://a.example", "https://b.example"]);
});

test("backoff max must be >= base", () => {
    assert.deepEqual(
        problemsFor(testEnvSource({ CRAWL_BACKOFF_BASE_MS: "5000", CRAWL_BACKOFF_MAX_MS: "1000" })),
        ["CRAWL_BACKOFF_MAX_MS must be >= CRAWL_BACKOFF_BASE_MS"]
    );
});

test(".env.example lists every variable, validates once the key is set, and ships with cron off", () => {
    const text = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../.env.example"), "utf8");
    const example = {};
    for (const line of text.split(/\r?\n/)) {
        const match = /^([A-Z_]+)=(.*)$/.exec(line);
        if (match) example[match[1]] = match[2];
    }
    const config = loadEnv({ ...example, ADMIN_API_KEY: "k".repeat(32) });
    for (const key of [...Object.keys(config), "COMPETITION_END_DATE"]) {
        assert.ok(key in example, `${key} is missing from .env.example`);
    }
    assert.equal(config.CRON_ENABLED, false);
    assert.equal(example.ADMIN_API_KEY, "", "no key is shipped");
});
