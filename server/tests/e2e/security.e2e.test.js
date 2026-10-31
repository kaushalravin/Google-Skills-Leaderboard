const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const {
    startHarness,
    badge,
    participant,
    profileUrl,
    assertPublicResponsesClean,
    assertErrorShape,
    ADMIN_KEY
} = require("./helpers/harness");

let h;
before(async () => {
    h = await startHarness();
});
after(async () => {
    await h?.stop();
});

const ADMIN_ROUTES = [
    ["POST", "/api/admin/crawl"],
    ["GET", "/api/admin/crawl/status"],
    ["GET", "/api/admin/crawl/logs"],
    ["POST", "/api/admin/participants"]
];

async function dataCounts(s) {
    const names = ["users", "badges", "userbadges", "crawler_logs"];
    return Object.fromEntries(await Promise.all(names.map(async (n) => [n, await s.db.collection(n).countDocuments()])));
}

test("every admin route returns 401 for a missing, empty, wrong, one-char-off or wrong-case key", async () => {
    const s = await h.newServer();
    const oneOff = ADMIN_KEY.slice(0, -1) + (ADMIN_KEY.endsWith("F") ? "E" : "F");
    // (Surrounding whitespace isn't a variant: HTTP strips it from header values.)
    const keys = [undefined, "", "wrong-key", oneOff, `${ADMIN_KEY}x`, ADMIN_KEY.slice(0, -1), ADMIN_KEY.toLowerCase(), ADMIN_KEY.toUpperCase()];
    assert.notEqual(ADMIN_KEY.toLowerCase(), ADMIN_KEY);
    const before = await dataCounts(s);
    for (const [method, path] of ADMIN_ROUTES) {
        for (const key of keys) {
            const headers = key === undefined ? {} : { "x-admin-key": key };
            const body = method === "POST" && path.endsWith("participants") ? participant("intruder", "Intruder") : undefined;
            const res = await s.request(method, path, { headers, body });
            assertErrorShape(res, 401, "UNAUTHORIZED");
            assert.equal(res.headers.get("cache-control"), "no-store");
        }
    }
    assert.deepEqual(await dataCounts(s), before, "nothing was written");
    // The real key still works.
    assert.equal((await s.get("/api/admin/crawl/status", { admin: true })).status, 200);
});

test("brute force is throttled before auth: after the limit even the right key gets 429", async () => {
    const s = await h.newServer({ env: { RATE_LIMIT_ADMIN_PER_MIN: "5" } });
    for (let i = 0; i < 5; i++) {
        assertErrorShape(await s.get("/api/admin/crawl/status", { headers: { "x-admin-key": `guess-${i}` } }), 401, "UNAUTHORIZED");
    }
    const blocked = await s.get("/api/admin/crawl/status", { admin: true });
    assertErrorShape(blocked, 429, "RATE_LIMITED");
    assert.ok(blocked.headers.get("retry-after") || blocked.headers.get("ratelimit"), "rate-limit headers are sent");
    assertErrorShape(await s.post("/api/admin/crawl", { admin: true }), 429, "RATE_LIMITED");
    assert.equal(await s.db.collection("crawler_logs").countDocuments(), 0, "the throttled crawl never started");
    // Public routes have their own limiter.
    assert.equal((await s.get("/api/leaderboard")).status, 200);
});

test("the public leaderboard is rate limited per IP; health is not", async () => {
    const s = await h.newServer({ env: { RATE_LIMIT_PUBLIC_PER_MIN: "3" } });
    for (let i = 0; i < 3; i++) assert.equal((await s.get("/api/leaderboard")).status, 200);
    assertErrorShape(await s.get("/api/leaderboard"), 429, "RATE_LIMITED");
    assertErrorShape(await s.get("/api/leaderboard/0123456789abcdef01234567"), 429, "RATE_LIMITED");
    for (let i = 0; i < 5; i++) assert.equal((await s.get("/api/health/live")).status, 200);
    assert.equal((await s.get("/api/health")).status, 200);
});

test("ingestion rejects unsafe profile URLs and normalizes the accepted variants", async () => {
    const s = await h.newServer();
    const bad = [
        "https://evil.example.com/public_profiles/abc",
        "https://skills.google.evil.com/public_profiles/abc",
        "https://evilskills.google/public_profiles/abc",
        "http://127.0.0.1/public_profiles/abc",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/public_profiles/abc",
        "http://localhost/public_profiles/abc",
        "https://www.skills.google:8443/public_profiles/abc",
        "https://user:pass@www.skills.google/public_profiles/abc",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "ftp://www.skills.google/public_profiles/abc",
        "https://www.skills.google/admin",
        "https://www.skills.google/public_profiles/abc/badges/1",
        "https://www.skills.google/public_profiles/../admin",
        "https://www.skills.google/public_profiles/ab%2Fc",
        `https://www.skills.google/public_profiles/${"a".repeat(3000)}`,
        "www.skills.google/public_profiles/abc",
        ""
    ];
    const good = [
        ["http://www.skills.google/public_profiles/Good-1", profileUrl("Good-1")],
        ["https://cloudskillsboost.google/public_profiles/good-2/", profileUrl("good-2")],
        ["http://www.cloudskillsboost.google/public_profiles/good-3?utm=x#top", profileUrl("good-3")],
        ["https://skills.google/public_profiles/good-4", profileUrl("good-4")]
    ];
    const rows = [
        ...bad.map((url, i) => ({ ...participant(`bad${i}`, `Bad ${i}`), profileUrl: url })),
        ...good.map(([url], i) => ({ ...participant(`good${i}`, `Good ${i}`), profileUrl: url }))
    ];
    const res = await s.ingest(rows);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.inserted, good.length);
    assert.deepEqual(res.body.rejected, bad.map((_, index) => ({ index, reason: "invalid_profile_url" })));

    const stored = (await s.db.collection("users").find().toArray()).map((u) => u.skillsUrl).sort();
    assert.deepEqual(stored, good.map(([, canonical]) => canonical).sort());
});

test("NoSQL operators: a batch of injected rows is a 422, unknown query keys are ignored, and no data changes", async () => {
    const s = await h.newServer();
    s.setProfiles({ base: { badges: [badge("Build a Website on Google Cloud", "Oct 27, 2026")] } });
    await s.ingest(participant("base", "Base"));
    await s.crawl();
    const before = await dataCounts(s);
    const baseUser = await s.user("Base");

    // Operator objects in a row fail validation. A batch where every row fails is a 422 (documented).
    const bodies = [
        { ...participant("x1", "X1"), profileUrl: { $gt: "" } },
        { ...participant("x2", "X2"), email: { $ne: null } },
        { ...participant("x3", "X3"), skillsEmail: { $regex: ".*" } },
        { ...participant("x4", "X4"), username: { $where: "sleep(1000)" } },
        { username: "X5", email: "base@example.com", skillsEmail: "base.skills@example.com", profileUrl: { $ne: null } }
    ];
    for (const body of bodies) {
        const res = await s.post("/api/admin/participants", { body, admin: true });
        assertErrorShape(res, 422, "ALL_ROWS_REJECTED");
    }
    const envelope = await s.post("/api/admin/participants", { body: { participants: { $gt: [] } }, admin: true });
    assertErrorShape(envelope, 400, "VALIDATION_ERROR");

    // Unknown query keys are ignored by design, so harmless extras like a dashboard's cache-busting
    // "?_=…" never break a request. Express keeps "search[$ne]" as a literal key name (no nested
    // objects), so operator-looking keys are just unknown keys: the response equals the plain one.
    const plain = await s.board();
    for (const q of ["?_=1793290000000", "?search[$ne]=x", "?page[$gt]=0", "?limit[$gt]=0", "?search[$regex]=.*"]) {
        const res = await s.get(`/api/leaderboard${q}`);
        assert.equal(res.status, 200, q);
        assert.deepEqual(res.body, plain, q);
    }
    // Typed parameters reject anything that isn't the expected type.
    assertErrorShape(await s.get("/api/leaderboard?page=abc"), 400, "VALIDATION_ERROR");
    assertErrorShape(await s.get("/api/leaderboard?search=a&search=b"), 400, "VALIDATION_ERROR");
    assertErrorShape(await s.get("/api/leaderboard/%7B%22$ne%22:null%7D"), 400, "VALIDATION_ERROR");

    assert.deepEqual(await dataCounts(s), before);
    assert.deepEqual(await s.user("Base"), baseUser);
});

test("search treats regex metacharacters literally and returns quickly", async () => {
    const s = await h.newServer();
    await s.ingest([
        participant("lit1", "a.b (dev)"),
        participant("lit2", "axb"),
        participant("lit3", `${"a".repeat(30)}!`),
        participant("lit4", "plain")
    ]);
    const cases = [
        [".*", []],
        ["a.b", ["a.b (dev)"]],
        ["(dev)", ["a.b (dev)"]],
        ["(a+)+$", []],
        ["[", []],
        ["\\", []]
    ];
    for (const [search, expected] of cases) {
        const started = Date.now();
        const board = await s.board(`?search=${encodeURIComponent(search)}`);
        assert.ok(Date.now() - started < 1000, `search ${search} took too long`);
        assert.deepEqual(board.rows.map((r) => r.username), expected, search);
    }
});

test("no public response anywhere in this file contained an email, '@' or internal details", async () => {
    const s = await h.newServer();
    s.setProfiles({ pii: { badges: [badge("Build a Website on Google Cloud", "Oct 27, 2026")] } });
    await s.ingest(participant("pii", "Pii Person", { email: "pii.person@example.com", skillsEmail: "pii.skills@example.com" }));
    await s.crawl();
    const userId = (await s.board()).rows[0].userId;
    for (const p of ["/api/leaderboard", `/api/leaderboard/${userId}`, "/api/leaderboard?search=pii", "/api/health", "/api/health/live"]) {
        await s.get(p);
    }
    assertPublicResponsesClean();
});

test("helmet's security headers are set; with CORS_ORIGINS a disallowed Origin gets no Access-Control-Allow-Origin", async () => {
    const s = await h.newServer({ env: { CORS_ORIGINS: "https://leaderboard.gdgmit.example" } });
    const res = await s.get("/api/leaderboard", { headers: { Origin: "https://evil.example" } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.ok(res.headers.get("content-security-policy"));
    assert.ok(res.headers.get("strict-transport-security"));
    assert.equal(res.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.ok(res.headers.get("referrer-policy"));
    assert.ok(res.headers.get("cross-origin-opener-policy"));
    assert.equal(res.headers.get("x-powered-by"), null);

    const allowed = await s.get("/api/leaderboard", { headers: { Origin: "https://leaderboard.gdgmit.example" } });
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://leaderboard.gdgmit.example");
    const preflight = await s.request("OPTIONS", "/api/leaderboard", {
        headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" }
    });
    assert.equal(preflight.headers.get("access-control-allow-origin"), null);
});

test("more than 500 rows → 400; 10 concurrent identical submissions → exactly one user", async () => {
    const s = await h.newServer();
    const tooMany = Array.from({ length: 501 }, (_, i) => participant(`many${i}`, `Many ${i}`));
    assertErrorShape(await s.ingest(tooMany), 400, "VALIDATION_ERROR");
    assert.equal(await s.db.collection("users").countDocuments(), 0);

    const results = await Promise.all(Array.from({ length: 10 }, () => s.ingest(participant("same", "Same Person"))));
    assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.status)));
    assert.equal(results.reduce((n, r) => n + r.body.inserted, 0), 1);
    assert.equal(await s.db.collection("users").countDocuments({ skillsUrl: profileUrl("same") }), 1);
    assert.equal(await s.db.collection("users").countDocuments(), 1);
});

test("an email that belongs to a different profile rejects that row and leaves the other user unchanged", async () => {
    const s = await h.newServer();
    await s.ingest(participant("owner", "Owner"));
    const owner = await s.user("Owner");

    const res = await s.ingest([
        participant("taker", "Taker", { email: "owner@example.com" }),
        participant("taker2", "Taker Two", { skillsEmail: "owner.skills@example.com" }),
        participant("fine", "Fine")
    ]);
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body.rejected, [
        { index: 0, reason: "email_in_use_by_other_profile" },
        { index: 1, reason: "email_in_use_by_other_profile" }
    ]);
    assert.equal(res.body.inserted, 1);
    assert.deepEqual(await s.user("Owner"), owner);
    assert.equal(await s.db.collection("users").countDocuments(), 2);
    assert.doesNotMatch(res.text, /@/, "no emails echoed back");
});
