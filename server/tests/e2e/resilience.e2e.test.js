const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { setTimeout: sleep } = require("node:timers/promises");

const {
    startHarness,
    badge,
    participant,
    dumpDb,
    childEnv,
    assertPublicResponsesClean,
    ADMIN_KEY,
    SERVER_DIR,
    FAKE_GOOGLE
} = require("./helpers/harness");

const COMPUTE = "The Basics of Google Cloud Compute";
const WEBSITE = "Build a Website on Google Cloud";
const VISION = "Analyze Images with the Cloud Vision API";

let h;
before(async () => {
    h = await startHarness();
});
after(async () => {
    await h?.stop();
});

const twoBadges = () => ({ badges: [badge(COMPUTE, "Oct 26, 2026"), badge(WEBSITE, "Oct 27, 2026")] });
const requestsFor = (s, id) => s.googleRequests().filter((r) => r.id === id);

test("12: a profile that later shows the sign-in page keeps its badges, is an empty_result and makes the run partial", async () => {
    const s = await h.newServer();
    const profiles = { flaky: twoBadges(), steady: { badges: [badge(VISION, "Oct 27, 2026")] } };
    s.setProfiles(profiles);
    await s.ingest([participant("flaky", "Flaky"), participant("steady", "Steady")]);
    await s.crawl();
    const rowBefore = await s.row("Flaky");
    const stored = await s.userBadges("Flaky");

    profiles.flaky = { mode: "signin" };
    s.setProfiles(profiles);
    const run = await s.crawl();
    assert.equal(run.status, "partial");
    assert.equal(run.counts.empty, 1);
    const user = await s.user("Flaky");
    assert.deepEqual(run.failures, [{ userId: String(user._id), reason: "empty_result", httpStatus: null }]);
    assert.deepEqual(await s.row("Flaky"), rowBefore);
    assert.equal(user.badgeCount, 2);
    assert.deepEqual(await s.userBadges("Flaky"), stored);
    // A partial run still rebuilds the leaderboard and advances lastSuccessfulUpdate.
    const status = await s.get("/api/admin/crawl/status", { admin: true });
    assert.equal(status.body.lastSuccessfulUpdate, run.finishedAt);
    assert.equal((await s.board()).lastSuccessfulUpdate, run.finishedAt);
});

test("13: a 404 is not retried (one request) and the participant's data is kept", async () => {
    const s = await h.newServer();
    const profiles = { gone: twoBadges(), here: twoBadges() };
    s.setProfiles(profiles);
    await s.ingest([participant("gone", "Gone"), participant("here", "Here")]);
    await s.crawl();
    const firstCrawlRequests = requestsFor(s, "gone").length;

    profiles.gone = { mode: "404" };
    s.setProfiles(profiles);
    const run = await s.crawl();
    assert.equal(run.status, "partial");
    assert.equal(run.failures[0].reason, "http_404");
    assert.equal(requestsFor(s, "gone").length - firstCrawlRequests, 1, "exactly one request, no retries");
    assert.equal((await s.row("Gone")).validBadgeCount, 2);
    assert.equal((await s.user("Gone")).badgeCount, 2);
});

test("14: a 500 is retried and the second attempt succeeds", async () => {
    const s = await h.newServer();
    s.setProfiles({ wobbly: { mode: "500-then-200", ...twoBadges() } });
    await s.ingest(participant("wobbly", "Wobbly"));
    const run = await s.crawl();
    assert.equal(run.status, "success");
    assert.deepEqual(requestsFor(s, "wobbly").map((r) => r.status), [500, 200]);
    assert.equal((await s.row("Wobbly")).validBadgeCount, 2);
});

test("15: a 429 with Retry-After: 1 pauses that profile and every other worker for ~1 s", async () => {
    const s = await h.newServer({ env: { CRAWL_CONCURRENCY: "3", CRAWL_MIN_GAP_MS: "10" } });
    // The others answer slowly, so the 429 lands while they are still in flight.
    const profiles = { limited: { mode: "429-then-200", ...twoBadges() } };
    for (const id of ["o1", "o2", "o3", "o4", "o5"]) profiles[id] = { ...twoBadges(), delayMs: 800 };
    s.setProfiles(profiles);
    await s.ingest(["limited", "o1", "o2", "o3", "o4", "o5"].map((id) => participant(id, `User ${id}`)));
    const run = await s.crawl();
    assert.equal(run.status, "success");

    const log = s.googleRequests();
    const tooMany = log.find((r) => r.id === "limited" && r.status === 429);
    const retry = log.find((r) => r.id === "limited" && r.status === 200);
    assert.ok(retry.t - tooMany.t >= 950, `retried after ${retry.t - tooMany.t} ms: ${JSON.stringify(log)}`);

    // o1 and o2 are the other workers' first requests and may already be under way when the 429
    // arrives. o3-o5 can only start after a worker finishes o1/o2 (800 ms each), i.e. after the 429
    // was handled; without the shared pause they would start ~800 ms after it, not >= 1 s.
    const later = log.filter((r) => ["o3", "o4", "o5"].includes(r.id));
    assert.equal(later.length, 3, JSON.stringify(log));
    for (const r of later) assert.ok(r.t - tooMany.t >= 950, `${r.id} started ${r.t - tooMany.t} ms after the 429: ${JSON.stringify(log)}`);
});

test("16: a block (every profile shows the sign-in page) fails the run and leaves the public leaderboard untouched", async () => {
    const s = await h.newServer();
    const ids = ["u1", "u2", "u3", "u4", "u5", "u6"];
    const profiles = Object.fromEntries(ids.map((id) => [id, twoBadges()]));
    s.setProfiles(profiles);
    await s.ingest(ids.map((id) => participant(id, `User ${id}`)));
    await s.crawl();
    const before = await s.board();
    const usersBefore = await s.db.collection("users").find().sort({ _id: 1 }).toArray();

    s.setProfiles(Object.fromEntries(ids.map((id) => [id, { mode: "signin" }])));
    const run = await s.crawl();
    assert.equal(run.status, "failed");
    assert.equal(run.error, "suspicious_empty_run");

    assert.deepEqual(await s.board(), before);
    const status = await s.get("/api/admin/crawl/status", { admin: true });
    assert.equal(status.body.lastSuccessfulUpdate, before.lastSuccessfulUpdate);
    assert.deepEqual(await s.db.collection("users").find().sort({ _id: 1 }).toArray(), usersBefore);
});

test("17: across varied crawls nothing is deleted, counts never drop, and repeats create no duplicates", async () => {
    const s = await h.newServer();
    const ids = ["v1", "v2", "v3", "v4"];
    const profiles = Object.fromEntries(ids.map((id) => [id, twoBadges()]));
    s.setProfiles(profiles);
    await s.ingest(ids.map((id) => participant(id, `User ${id}`)));
    await s.seedUsers([{ id: "v5", username: "Seeded" }]);
    profiles.v5 = { badges: [badge(VISION, "Oct 28, 2026")] };
    s.setProfiles(profiles);

    const counts = async () => ({
        users: await s.db.collection("users").countDocuments(),
        badges: await s.db.collection("badges").countDocuments(),
        userbadges: await s.db.collection("userbadges").countDocuments()
    });
    const variants = [
        () => {},
        () => Object.assign(profiles, { v1: { mode: "signin" }, v2: { mode: "404" } }),
        () => Object.assign(profiles, { v1: twoBadges(), v2: { mode: "500-then-200", ...twoBadges() }, v3: { mode: "noBadges" } }),
        () => Object.assign(profiles, { v3: twoBadges(), v4: { badges: [{ title: COMPUTE, earned: "Earned recently" }] } }),
        () => {}
    ];
    let previous = await counts();
    for (const change of variants) {
        change();
        s.setProfiles(profiles);
        await s.crawl(); // also asserts: no deletions, no duplicate rows
        const now = await counts();
        for (const key of Object.keys(now)) assert.ok(now[key] >= previous[key], `${key} dropped`);
        previous = now;
    }
    assert.deepEqual(previous, { users: 5, badges: 3, userbadges: 9 });

    const repeat = await counts();
    await s.crawl();
    assert.deepEqual(await counts(), repeat, "an identical crawl adds nothing");
});

test("18: graceful shutdown mid-crawl ends the run 'aborted', releases the lock and exits 0; a restart crawls fine", async () => {
    const s = await h.newServer();
    const ids = ["s1", "s2", "s3", "s4", "s5", "s6"];
    s.setProfiles(Object.fromEntries(ids.map((id) => [id, { ...twoBadges(), delayMs: 1500 }])));
    await s.ingest(ids.map((id) => participant(id, `User ${id}`)));

    const started = await s.post("/api/admin/crawl", { admin: true });
    assert.equal(started.status, 202);
    while (s.googleRequests().length === 0) await sleep(20);

    const { code } = await s.shutdown();
    assert.equal(code, 0);
    const log = await s.db.collection("crawler_logs").findOne({ runId: started.body.runId });
    assert.equal(log.status, "aborted");
    assert.ok(log.finishedAt);
    const lock = await s.db.collection("job_locks").findOne({ _id: "crawl" });
    assert.equal(lock.owner, null);
    assert.ok(lock.expiresAt <= new Date());

    s.setProfiles(Object.fromEntries(ids.map((id) => [id, twoBadges()])));
    const restarted = await s.restart();
    const run = await restarted.crawl();
    assert.equal(run.status, "success");
    assert.equal(await restarted.db.collection("crawler_logs").countDocuments({ status: "running" }), 0);
    const { code: second } = await restarted.shutdown();
    assert.equal(second, 0);
});

test("18b: after a hard crash mid-crawl, a restart reconciles the orphaned run and the next crawl succeeds", async () => {
    const s = await h.newServer({ env: { LOCK_TTL_MS: "5000" } });
    const ids = ["k1", "k2", "k3", "k4"];
    s.setProfiles(Object.fromEntries(ids.map((id) => [id, { ...twoBadges(), delayMs: 2000 }])));
    await s.ingest(ids.map((id) => participant(id, `User ${id}`)));

    const started = await s.post("/api/admin/crawl", { admin: true });
    while (s.googleRequests().length === 0) await sleep(20);
    s.server.child.kill("SIGKILL"); // no shutdown handler runs
    await s.server.exited;
    assert.equal((await s.db.collection("crawler_logs").findOne({ runId: started.body.runId })).status, "running");

    // Restart at once, while the dead run's lease (LOCK_TTL_MS = 5 s) hasn't expired yet.
    s.setProfiles(Object.fromEntries(ids.map((id) => [id, twoBadges()])));
    const restarted = await s.restart();
    let run;
    for (let i = 0; i < 100 && !run; i++) {
        const res = await restarted.post("/api/admin/crawl", { admin: true });
        if (res.status === 202) run = await restarted.waitForRun(res.body.runId);
        else await sleep(200);
    }
    assert.equal(run.status, "success");
    const orphan = await restarted.db.collection("crawler_logs").findOne({ runId: started.body.runId });
    assert.equal(orphan.status, "failed");
    assert.equal(orphan.error, "orphaned");
    assert.equal(await restarted.db.collection("crawler_logs").countDocuments({ status: "running" }), 0);
});

test("19: two concurrent manual crawls give one 202 and one 409 with the holder; with CRON_ENABLED=false nothing is scheduled", async () => {
    const s = await h.newServer({ env: { CRON_ENABLED: "false", CRON_SCHEDULE: "* * * * * *" } });
    s.setProfiles({ slow: { ...twoBadges(), delayMs: 1000 } });
    await s.ingest(participant("slow", "Slow"));

    const [a, b] = await Promise.all([s.post("/api/admin/crawl", { admin: true }), s.post("/api/admin/crawl", { admin: true })]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [202, 409]);
    const conflict = a.status === 409 ? a : b;
    const accepted = a.status === 202 ? a : b;
    assert.equal(conflict.body.error.code, "CRAWL_IN_PROGRESS");
    assert.equal(conflict.body.error.details.trigger, "manual");
    assert.ok(!Number.isNaN(Date.parse(conflict.body.error.details.since)));
    await s.waitForRun(accepted.body.runId);

    // A every-second schedule would have fired by now if cron were enabled.
    await sleep(2500);
    assert.equal(await s.db.collection("crawler_logs").countDocuments({ trigger: "cron" }), 0);
    assert.equal(await s.db.collection("crawler_logs").countDocuments(), 1);
    assert.ok(s.logs.some((l) => /cron disabled/.test(l.msg ?? "")));
    assert.equal((await s.get("/api/health")).body.cron.enabled, false);
});

test("20: check:real reports against the fake profiles and leaves the database byte-for-byte unchanged", async () => {
    const s = await h.newServer();
    const profiles = {
        r1: twoBadges(),
        r2: { badges: [badge(VISION, "Oct 27, 2026")] },
        r3: { badges: [badge(WEBSITE, "Oct 25, 2026")] }
    };
    s.setProfiles(profiles);
    await s.ingest([participant("r1", "Riya"), participant("r2", "Rohan"), participant("r3", "Ravi")]);
    await s.crawl();
    await s.shutdown();

    // Make the report different from what's stored: one more badge, and a missing profile.
    profiles.r2.badges.push(badge(COMPUTE, "Oct 28, 2026"), badge(WEBSITE, "Oct 25, 2026"));
    profiles.r3 = { mode: "404" };
    s.setProfiles(profiles);

    const before = await dumpDb(s.db);
    const out = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--require", FAKE_GOOGLE, path.join("scripts", "check-real.js")], {
            cwd: SERVER_DIR,
            env: childEnv({
                ENV_FILE: "",
                TZ: "America/New_York",
                MONGO_URI: h.replSet.getUri(s.dbName),
                ADMIN_API_KEY: ADMIN_KEY,
                CRAWL_MIN_GAP_MS: "10",
                CRAWL_MAX_RETRIES: "0",
                FAKE_GOOGLE_SCENARIO: s.scenarioPath
            })
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (c) => (stdout += c));
        child.stderr.on("data", (c) => (stderr += c));
        child.on("error", reject);
        child.on("exit", (code) => resolve({ code, stdout, stderr }));
    });
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /2 valid\s+2 whitelisted\s+Riya/);
    assert.match(out.stdout, /2 valid\s+3 whitelisted\s+Rohan/);
    assert.match(out.stdout, /Rohan: Build a Website on Google Cloud/);
    assert.match(out.stdout, /http_404: 1 \(Ravi\)/);
    assert.match(out.stdout, /Earned Oct 26, 2026 EDT/);
    // The server built the unique indexes at startup; check:real only lists them.
    assert.match(out.stdout, /ok\s+users \(email\)\nok\s+users \(skillsEmail\)\nok\s+users \(skillsUrl\)\nok\s+userbadges \(user \+ badge\)/);
    assert.doesNotMatch(out.stdout, /WARNING/);
    assert.match(out.stdout, /No data was written\.\s*$/);

    assert.deepEqual(await dumpDb(s.db), before);
});

test("31 (this file): no public response contained an email, '@' or internal details", () => {
    assertPublicResponsesClean();
});
