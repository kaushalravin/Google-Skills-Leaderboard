const pino = require("pino");

// Secrets and participant PII never reach the logs.
const REDACT_PATHS = [
    'req.headers["x-admin-key"]',
    "req.headers.authorization",
    "req.headers.cookie",
    'res.headers["set-cookie"]',
    "email",
    "skillsEmail",
    "*.email",
    "*.skillsEmail"
];

function createLogger({ level = "info" } = {}, destination) {
    return pino(
        {
            level,
            base: { service: "leaderboard-api" },
            timestamp: pino.stdTimeFunctions.isoTime,
            redact: { paths: REDACT_PATHS, censor: "[redacted]" }
        },
        destination
    );
}

module.exports = { createLogger, REDACT_PATHS };
