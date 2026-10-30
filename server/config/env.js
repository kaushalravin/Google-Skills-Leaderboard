const { existsSync } = require("node:fs");
const path = require("node:path");
const { z } = require("zod");

class EnvError extends Error {
    constructor(problems) {
        super(problems.map((p) => `  - ${p}`).join("\n"));
        this.name = "EnvError";
        this.problems = problems;
    }
}

function isCalendarDate(value) {
    const [y, m, d] = value.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return (
        date.getUTCFullYear() === y &&
        date.getUTCMonth() === m - 1 &&
        date.getUTCDate() === d
    );
}

const required = (what) => ({
    error: (issue) => (issue.input === undefined ? "is required" : `must be ${what}`)
});

const isoDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .refine(isCalendarDate, "is not a real calendar date");

const bool = z
    .enum(["true", "false", "1", "0"], { error: "must be true or false" })
    .transform((v) => v === "true" || v === "1");

const int = (fallback, { min = 0, max } = {}) => {
    let schema = z.coerce.number().int().min(min);
    if (max !== undefined) schema = schema.max(max);
    return schema.default(fallback);
};

const fields = z.object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: int(3000, { max: 65535 }),
    MONGO_URI: z
        .string(required("a string"))
        .regex(/^mongodb(\+srv)?:\/\//, "must start with mongodb:// or mongodb+srv://"),
    MONGO_SERVER_SELECTION_TIMEOUT_MS: int(10000, { min: 100 }),
    LOG_LEVEL: z
        .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
        .default("info"),
    ADMIN_API_KEY: z
        .string(required("a string"))
        .min(32, "must be at least 32 characters"),
    CORS_ORIGINS: z
        .string()
        .default("")
        .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
    TRUST_PROXY: int(1, { max: 10 }),

    COMPETITION_START_DATE: isoDate.default("2026-10-26"),
    COMPETITION_END_DATE: isoDate.optional(),

    CRON_SCHEDULE: z.string().default("0 */6 * * *"),
    CRON_TIMEZONE: z.string().default("Asia/Kolkata"),
    CRON_ENABLED: bool.default(true),
    CRAWL_CONCURRENCY: int(3, { min: 1, max: 20 }),
    CRAWL_MIN_GAP_MS: int(500),
    CRAWL_MAX_RETRIES: int(3, { max: 10 }),
    CRAWL_BACKOFF_BASE_MS: int(1000, { min: 1 }),
    CRAWL_BACKOFF_MAX_MS: int(30000, { min: 1 }),
    CRAWL_RETRY_AFTER_MAX_MS: int(120000, { min: 1 }),
    SUSPICIOUS_EMPTY_MIN_USERS: int(5, { min: 1 }),
    SUSPICIOUS_EMPTY_RATIO: z.coerce.number().gt(0).max(1).default(0.3),

    LOCK_TTL_MS: int(120000, { min: 3000 }),
    RATE_LIMIT_PUBLIC_PER_MIN: int(120, { min: 1 }),
    RATE_LIMIT_ADMIN_PER_MIN: int(30, { min: 1 }),
    STALE_AFTER_HOURS: int(13, { min: 1 })
});

const schema = fields.superRefine((env, ctx) => {
    if (env.COMPETITION_END_DATE && env.COMPETITION_END_DATE < env.COMPETITION_START_DATE) {
        ctx.addIssue({
            code: "custom",
            path: ["COMPETITION_END_DATE"],
            message: "must not be before COMPETITION_START_DATE"
        });
    }
    if (env.CRAWL_BACKOFF_MAX_MS < env.CRAWL_BACKOFF_BASE_MS) {
        ctx.addIssue({
            code: "custom",
            path: ["CRAWL_BACKOFF_MAX_MS"],
            message: "must be >= CRAWL_BACKOFF_BASE_MS"
        });
    }
});

/**
 * Validates environment variables and returns a frozen config object.
 * Empty strings are treated as unset so `PORT=` in a .env falls back to the default.
 * Throws EnvError listing every problem at once.
 */
function loadEnv(source = process.env) {
    const input = {};
    for (const key of Object.keys(fields.shape)) {
        if (source[key] !== undefined && source[key] !== "") input[key] = source[key];
    }
    const result = schema.safeParse(input);
    if (!result.success) {
        throw new EnvError(
            result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
        );
    }
    return Object.freeze(result.data);
}

/** Loads server/.env (or ENV_FILE) if present. An empty ENV_FILE disables loading. */
function loadEnvFile() {
    const envFile = process.env.ENV_FILE ?? path.join(__dirname, "../.env");
    if (envFile && existsSync(envFile)) process.loadEnvFile(envFile);
}

module.exports = { loadEnv, loadEnvFile, EnvError };
