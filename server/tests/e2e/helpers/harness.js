// Runs the real server (index.js) as a child process against an in-memory MongoDB replica set,
// with Google Skills replaced by fakeGoogle.js. Tests talk to it over HTTP and inspect MongoDB
// directly through the driver.
require("../../../config/timezone");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { setTimeout: sleep } = require("node:timers/promises");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { MongoClient, ObjectId, BSON } = require("mongodb");

const SERVER_DIR = path.resolve(__dirname, "../../..");
const FAKE_GOOGLE = path.join(__dirname, "fakeGoogle.js");
const ADMIN_KEY = "e2e-admin-key-0123456789abcdefABCDEF";
// Keep the parent's app settings (e.g. a developer's MONGO_URI) out of the children.
const APP_ENV_KEYS = /^(NODE_ENV|PORT|MONGO_|LOG_LEVEL|ADMIN_API_KEY|CORS_|TRUST_PROXY|COMPETITION_|CRAWL_|CRON_|LOCK_|RATE_LIMIT_|SUSPICIOUS_|STALE_|ENV_FILE|FAKE_GOOGLE_|TZ$)/;

const profileUrl = (id) => `https://www.skills.google/public_profiles/${id}`;
/** A badge as a profile shows it; `date` like "Oct 27, 2026" (shown with a US timezone, as on real profiles). */
const badge = (title, date) => ({ title, earned: `Earned ${date} EDT` });

// Every public response body, for the PII / internal-detail scans at the end of each file.
const publicResponses = [];
const knownEmails = new Set();

function childEnv(overrides) {
    const env = {};
    for (const [key, value] of Object.entries(process.env)) if (!APP_ENV_KEYS.test(key)) env[key] = value;
    return { ...env, ...overrides };
}

/** One per test file. `newServer()` gives every test its own database and server process. */
async function startHarness() {
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "leaderboard-e2e-"));
    const client = await MongoClient.connect(replSet.getUri());
    let seq = 0;
    const servers = [];

    async function newServer({ env = {}, dbName = `e2e_${process.pid}_${++seq}`, scenarioFile } = {}) {
        const scenario = scenarioFile ?? path.join(tmp, `${dbName}.scenario.json`);
        const requestLog = path.join(tmp, `${dbName}.requests.log`);
        if (!scenarioFile) fs.writeFileSync(scenario, JSON.stringify({ profiles: {} }));
        const db = client.db(dbName);
        const server = await spawnServer({
            ENV_FILE: "",
            NODE_ENV: "test",
            PORT: "0",
            LOG_LEVEL: "info",
            TZ: "America/New_York", // the server must still store UTC midnights
            MONGO_URI: replSet.getUri(dbName),
            ADMIN_API_KEY: ADMIN_KEY,
            CRON_ENABLED: "false",
            CRAWL_MIN_GAP_MS: "10",
            CRAWL_BACKOFF_BASE_MS: "50",
            CRAWL_BACKOFF_MAX_MS: "200",
            LOCK_TTL_MS: "20000", // generous: a busy test machine must not lose the lease mid-crawl
            RATE_LIMIT_PUBLIC_PER_MIN: "100000",
            RATE_LIMIT_ADMIN_PER_MIN: "100000",
            FAKE_GOOGLE_SCENARIO: scenario,
            FAKE_GOOGLE_LOG: requestLog,
            ...env
        });
        servers.push(server);
        return makeApi({ server, db, scenario, requestLog, dbName, restart: (extraEnv = {}) =>
            newServer({ env: { ...env, ...extraEnv }, dbName, scenarioFile: scenario }) });
    }

    return {
        replSet,
        client,
        newServer,
        async stop() {
            for (const server of servers) await server.kill();
            await client.close();
            await replSet.stop();
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    };
}

async function spawnServer(env) {
    const child = spawn(process.execPath, ["--require", FAKE_GOOGLE, "index.js"], {
        cwd: SERVER_DIR,
        env: childEnv(env),
        stdio: ["ignore", "pipe", "pipe", "ipc"]
    });
    const logs = [];
    let buffer = "";
    child.stdout.on("data", (chunk) => {
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            try {
                logs.push(JSON.parse(line));
            } catch {
                logs.push({ raw: line });
            }
        }
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));

    for (let i = 0; i < 200; i++) {
        const listening = logs.find((l) => l.msg === "server listening");
        if (listening) {
            return {
                child,
                logs,
                exited,
                stderr: () => stderr,
                baseUrl: `http://127.0.0.1:${listening.port}`,
                async kill() {
                    if (child.exitCode === null && child.signalCode === null) child.kill();
                    await exited;
                }
            };
        }
        if (child.exitCode !== null) break;
        await sleep(50);
    }
    child.kill();
    throw new Error(`server did not start\n${stderr}\n${JSON.stringify(logs)}`);
}

function makeApi({ server, db, scenario, requestLog, dbName, restart }) {
    async function request(method, urlPath, { body, rawBody, headers = {}, admin = false } = {}) {
        const init = { method, headers: { ...headers } };
        if (admin) init.headers["x-admin-key"] = ADMIN_KEY;
        if (body !== undefined) {
            init.body = JSON.stringify(body);
            init.headers["content-type"] = "application/json";
        }
        if (rawBody !== undefined) {
            init.body = rawBody;
            init.headers["content-type"] ??= "application/json";
        }
        const res = await fetch(server.baseUrl + urlPath, init);
        const text = await res.text();
        let json;
        try {
            json = JSON.parse(text);
        } catch {
            json = undefined;
        }
        if (!urlPath.startsWith("/api/admin")) publicResponses.push({ path: urlPath, status: res.status, text });
        return { status: res.status, headers: res.headers, body: json, text };
    }

    const api = {
        dbName,
        db,
        scenarioPath: scenario,
        logs: server.logs,
        server,
        restart,
        request,
        get: (p, opts) => request("GET", p, opts),
        post: (p, opts) => request("POST", p, opts),

        setProfiles(profiles) {
            fs.writeFileSync(scenario, JSON.stringify({ profiles }));
        },
        googleRequests() {
            if (!fs.existsSync(requestLog)) return [];
            return fs.readFileSync(requestLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
        },

        /** Ingests participants through the real admin endpoint. */
        async ingest(rows) {
            for (const row of [].concat(rows)) {
                knownEmails.add(row.email);
                knownEmails.add(row.skillsEmail);
            }
            return request("POST", "/api/admin/participants", { body: rows, admin: true });
        },
        /** Inserts users the way the original seed did, bypassing the API. */
        async seedUsers(users) {
            const docs = users.map((u) => ({
                username: u.username,
                email: u.email ?? `${u.id}@seed.example.com`,
                skillsEmail: u.skillsEmail ?? `${u.id}.skills@seed.example.com`,
                skillsUrl: profileUrl(u.id),
                badgeCount: 0,
                credits: u.credits ?? 0,
                __v: 0
            }));
            for (const d of docs) {
                knownEmails.add(d.email);
                knownEmails.add(d.skillsEmail);
            }
            await db.collection("users").insertMany(docs);
            return docs;
        },

        /** Starts a crawl via the admin API and waits for it to finish; checks the integrity invariants. */
        async crawl() {
            const before = await integritySnapshot(db);
            const started = await request("POST", "/api/admin/crawl", { admin: true });
            assert.equal(started.status, 202, started.text);
            const run = await api.waitForRun(started.body.runId);
            const lockLogs = server.logs.filter((l) => /lock|abort|crawl/i.test(l.msg ?? "")).slice(-10);
            assert.notEqual(run.status, "aborted", `run aborted: ${JSON.stringify({ run, lockLogs })}`);
            await assertIntegrity(db, before);
            return run;
        },
        async waitForRun(runId, timeoutMs = 30000) {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                const { body } = await request("GET", "/api/admin/crawl/status", { admin: true });
                if (body.latestRun?.runId === runId && body.latestRun.status !== "running" && !body.lock.held) {
                    return body.latestRun;
                }
                await sleep(50);
            }
            throw new Error(`run ${runId} did not finish`);
        },
        async board(query = "") {
            const res = await request("GET", `/api/leaderboard${query}`);
            assert.equal(res.status, 200, res.text);
            return res.body;
        },
        async row(username) {
            const board = await api.board("?limit=100");
            return board.rows.find((r) => r.username === username);
        },
        async user(username) {
            return db.collection("users").findOne({ username });
        },
        async userBadges(username) {
            const user = await api.user(username);
            return db
                .collection("userbadges")
                .aggregate([
                    { $match: { user: user._id } },
                    { $lookup: { from: "badges", localField: "badge", foreignField: "_id", as: "badge" } },
                    { $unwind: "$badge" },
                    { $sort: { earnedAt: 1 } }
                ])
                .toArray();
        },

        /** Graceful shutdown: SIGTERM, or the test-only IPC message on Windows (no catchable signals there). */
        async shutdown() {
            if (process.platform === "win32") server.child.send("shutdown");
            else server.child.kill("SIGTERM");
            return server.exited;
        }
    };
    return api;
}

/** Ids of every user, badge and userbadge, plus duplicate checks. */
async function integritySnapshot(db) {
    const ids = async (name) =>
        new Set((await db.collection(name).find({}, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)));
    return { users: await ids("users"), badges: await ids("badges"), userbadges: await ids("userbadges") };
}

async function assertIntegrity(db, before) {
    const after = await integritySnapshot(db);
    for (const name of ["users", "badges", "userbadges"]) {
        for (const id of before[name]) assert.ok(after[name].has(id), `a ${name} document was deleted (${id})`);
    }
    const dupPairs = await db
        .collection("userbadges")
        .aggregate([{ $group: { _id: { user: "$user", badge: "$badge" }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }])
        .toArray();
    assert.deepEqual(dupPairs, [], "duplicate (user, badge) rows");
    const dupBadges = await db
        .collection("badges")
        .aggregate([{ $group: { _id: "$name", n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }])
        .toArray();
    assert.deepEqual(dupBadges, [], "duplicate Badge documents for one name");
    const dupUsers = await db
        .collection("users")
        .aggregate([{ $group: { _id: { $toLower: "$skillsUrl" }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }])
        .toArray();
    assert.deepEqual(dupUsers, [], "duplicate participants for one profile");
}

/** Every collection, its indexes and documents, as canonical EJSON. */
async function dumpDb(db) {
    const out = {};
    const collections = (await db.listCollections().toArray()).map((c) => c.name).sort();
    for (const name of collections) {
        const docs = await db.collection(name).find({}).sort({ _id: 1 }).toArray();
        const indexes = await db.collection(name).indexes();
        out[name] = BSON.EJSON.stringify({ docs, indexes }, { relaxed: false });
    }
    return out;
}

/** Fails if any recorded public response leaks PII or internals. */
function assertPublicResponsesClean() {
    assert.ok(publicResponses.length > 0, "no public responses were recorded");
    for (const { path: p, text } of publicResponses) {
        assert.doesNotMatch(text, /@/, `"@" in public response ${p}`);
        for (const email of knownEmails) assert.ok(!text.includes(email), `email in public response ${p}`);
        assertNoInternals(text, p);
    }
}

function assertNoInternals(text, where = "") {
    assert.doesNotMatch(text, /\bat [\w.<>]+ \(|node:internal|[A-Za-z]:\\\\|\/(home|Users|usr)\/|\.js:\d+/, `stack/path in ${where}`);
    assert.doesNotMatch(text, /Mongo(Server|Network)?Error|E11000|ECONNREFUSED|buffering timed out|Cast to ObjectId/i, `DB error text in ${where}`);
}

const participant = (id, username, extra = {}) => ({
    username,
    email: `${id}@example.com`,
    skillsEmail: `${id}.skills@example.com`,
    profileUrl: profileUrl(id),
    ...extra
});

module.exports = {
    startHarness,
    spawnServer,
    childEnv,
    ADMIN_KEY,
    SERVER_DIR,
    FAKE_GOOGLE,
    badge,
    profileUrl,
    participant,
    dumpDb,
    assertPublicResponsesClean,
    assertNoInternals,
    ObjectId
};
