const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");

const { TEST_ADMIN_KEY } = require("./env");

const SERVER_ENTRY = path.resolve(__dirname, "../../index.js");
// Keep the parent's app settings (e.g. a developer's MONGO_URI or ENV_FILE) out of the children.
const APP_ENV_KEYS = /^(NODE_ENV|PORT|MONGO_|LOG_LEVEL|ADMIN_API_KEY|CORS_|TRUST_PROXY|COMPETITION_|CRAWL_|CRON_|LOCK_|RATE_LIMIT_|SUSPICIOUS_|STALE_|ENV_FILE|FAKE_GOOGLE_|TZ$)/;

function childEnv(overrides) {
    const env = {};
    for (const [key, value] of Object.entries(process.env)) if (!APP_ENV_KEYS.test(key)) env[key] = value;
    return { ...env, ...overrides };
}

/**
 * Spawns the real entry point with a clean app env and no .env file. The IPC channel carries
 * the test-only "shutdown" message, since Windows can't deliver a catchable SIGTERM.
 */
function startServer(env) {
    const child = spawn(process.execPath, [SERVER_ENTRY], {
        env: childEnv({ ENV_FILE: "", ...env }),
        stdio: ["ignore", "pipe", "pipe", "ipc"]
    });
    child.stdoutText = "";
    child.stderrText = "";
    child.stdout.on("data", (d) => (child.stdoutText += d));
    child.stderr.on("data", (d) => (child.stderrText += d));
    child.exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
    return child;
}

const logLines = (text) =>
    text.split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line));

/** Resolves with the "server listening" log line; rejects if the server exits or `ms` passes first. */
function waitForListening(child, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no listen log:\n${child.stdoutText}${child.stderrText}`)), ms);
        child.stdout.on("data", () => {
            const listening = logLines(child.stdoutText).find((l) => l.msg === "server listening");
            if (listening) {
                clearTimeout(timer);
                resolve(listening);
            }
        });
        child.exited.then(({ code }) => {
            clearTimeout(timer);
            reject(new Error(`server exited ${code}:\n${child.stderrText}`));
        });
    });
}

/** Runs a script with a clean app env; resolves { code, stdout, stderr } even on a non-zero exit. */
async function runScript(script, args, uri) {
    try {
        const { stdout, stderr } = await promisify(execFile)(process.execPath, [script, ...args], {
            env: childEnv({ ENV_FILE: "", MONGO_URI: uri, ADMIN_API_KEY: TEST_ADMIN_KEY, LOG_LEVEL: "silent" })
        });
        return { code: 0, stdout, stderr };
    } catch (err) {
        if (typeof err.code !== "number") throw err;
        return { code: err.code, stdout: err.stdout, stderr: err.stderr };
    }
}

module.exports = { childEnv, startServer, logLines, waitForListening, runScript };
