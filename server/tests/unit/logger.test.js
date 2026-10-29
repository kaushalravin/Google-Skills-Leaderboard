const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Writable } = require("node:stream");

const { createLogger } = require("../../config/logger");

function capture() {
    const lines = [];
    const stream = new Writable({
        write(chunk, _enc, cb) {
            lines.push(JSON.parse(chunk));
            cb();
        }
    });
    return { lines, stream };
}

test("logs are JSON and redact the admin key and participant emails", () => {
    const { lines, stream } = capture();
    const logger = createLogger({ level: "info" }, stream);

    logger.info(
        {
            req: { headers: { "x-admin-key": "secret", host: "h" } },
            participant: { email: "a@b.c", skillsEmail: "d@e.f", profileId: "p1" }
        },
        "hello"
    );

    const [line] = lines;
    assert.equal(line.msg, "hello");
    assert.equal(line.service, "leaderboard-api");
    assert.equal(line.req.headers["x-admin-key"], "[redacted]");
    assert.equal(line.req.headers.host, "h");
    assert.equal(line.participant.email, "[redacted]");
    assert.equal(line.participant.skillsEmail, "[redacted]");
    assert.equal(line.participant.profileId, "p1");
    assert.match(line.time, /^\d{4}-\d{2}-\d{2}T/);
});
