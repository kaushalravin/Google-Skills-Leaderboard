require("../../config/timezone");

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { compareRows, assignRanks } = require("../../services/leaderboard");

const row = (username, validBadgeCount, validCredits, latest) => ({
    userId: username,
    username,
    validBadgeCount,
    validCredits,
    latestValidBadgeAt: latest ? new Date(`${latest}T00:00:00Z`) : null
});
const rank = (rows) => assignRanks(rows.sort(compareRows)).map((r) => [r.rank, r.username]);

test("order is count desc, credits desc, latest date asc; only an identical triple shares a rank", () => {
    assert.deepEqual(rank([
        row("None", 0, 0, null),
        row("LateEight", 2, 8, "2026-10-28"),
        row("Rich", 2, 25, "2026-10-30"),
        row("Bea", 2, 8, "2026-10-27"),
        row("Ann", 2, 8, "2026-10-27"),
        row("Three", 3, 0, "2026-10-29"),
        row("Zero", 0, 0, null)
    ]), [
        [1, "Three"],
        [2, "Rich"],
        [3, "Ann"],
        [3, "Bea"],
        [5, "LateEight"],
        [6, "None"],
        [6, "Zero"]
    ]);
});
