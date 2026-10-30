require("../../config/timezone");

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
    isRetryable,
    parseRetryAfter,
    backoffDelay,
    isWhitelisted,
    isValidEarnedAt,
    competitionWindow
} = require("../../services/crawl");

const httpError = (status) => ({ isAxiosError: true, response: { status, headers: {} } });

test("only network errors, timeouts, 429 and 5xx are retryable", () => {
    for (const status of [429, 500, 502, 503, 504]) assert.equal(isRetryable(httpError(status)), true, status);
    for (const status of [400, 401, 403, 404, 410]) assert.equal(isRetryable(httpError(status)), false, status);
    assert.equal(isRetryable({ isAxiosError: true, code: "ECONNABORTED" }), true);
    assert.equal(isRetryable({ code: "ECONNRESET" }), true);
    assert.equal(isRetryable(new TypeError("cheerio blew up")), false);
});

test("Retry-After accepts delta-seconds and HTTP-dates", () => {
    const now = Date.parse("2026-10-29T12:00:00Z");
    assert.equal(parseRetryAfter("120", now), 120000);
    assert.equal(parseRetryAfter(" 0 ", now), 0);
    assert.equal(parseRetryAfter("Thu, 29 Oct 2026 12:00:30 GMT", now), 30000);
    assert.equal(parseRetryAfter("Thu, 29 Oct 2026 11:00:00 GMT", now), 0, "a past date means retry now");
    assert.equal(parseRetryAfter("soon", now), null);
    assert.equal(parseRetryAfter(undefined, now), null);
});

test("backoff uses full jitter within [0, min(max, base * 2^attempt))", () => {
    const settings = { backoffBaseMs: 1000, backoffMaxMs: 30000 };
    assert.equal(backoffDelay(0, settings, () => 0), 0);
    assert.equal(backoffDelay(0, settings, () => 0.999), 999);
    assert.equal(backoffDelay(2, settings, () => 0.5), 2000);
    assert.equal(backoffDelay(10, settings, () => 0.999), 29970, "capped by backoffMaxMs");
    for (let attempt = 0; attempt < 8; attempt++) {
        const d = backoffDelay(attempt, settings);
        assert.ok(d >= 0 && d < Math.min(30000, 1000 * 2 ** attempt));
    }
});

test("whitelist uses the scraper's normalization (trim, collapse spaces, lowercase)", () => {
    assert.equal(isWhitelisted("  build a   website on GOOGLE cloud "), true);
    assert.equal(isWhitelisted("Store, Process, and Manage Data on Google Cloud - Console"), true);
    assert.equal(isWhitelisted("Using the Google Cloud Speech API Level 2"), false);
    assert.equal(isWhitelisted("Some Other Course"), false);
});

test("valid earnedAt: in window, whole minute, end date inclusive", () => {
    const open = competitionWindow({ startDate: "2026-10-26" });
    assert.equal(isValidEarnedAt(new Date("2026-10-25T00:00:00Z"), open), false);
    assert.equal(isValidEarnedAt(new Date("2026-10-26T00:00:00Z"), open), true);
    assert.equal(isValidEarnedAt(new Date("2026-10-25T18:30:00Z"), open), false, "old IST midnight for Oct 26");
    assert.equal(isValidEarnedAt(new Date("2026-10-27T10:11:12.000Z"), open), false, "non-zero seconds");
    assert.equal(isValidEarnedAt(new Date("2026-10-27T10:11:00.345Z"), open), false, "non-zero milliseconds");
    assert.equal(isValidEarnedAt(null, open), false);

    const closed = competitionWindow({ startDate: "2026-10-26", endDate: "2026-11-30" });
    assert.equal(isValidEarnedAt(new Date("2026-11-30T00:00:00Z"), closed), true);
    assert.equal(isValidEarnedAt(new Date("2026-12-01T00:00:00Z"), closed), false);
});
