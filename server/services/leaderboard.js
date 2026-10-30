const { User } = require("../models/users");
require("../models/badges"); // registers Badge for populate
const { UserBadge } = require("../models/userBadges");
const { Leaderboard } = require("../models/leaderboard");
const { selectValidBadges, competitionWindow, badgeCredits } = require("./crawl");

const SNAPSHOT_ID = "current";

const time = (date) => (date ? date.getTime() : 0);

/** validBadgeCount desc, validCredits desc, latestValidBadgeAt asc (earlier finisher first), then username. */
function compareRows(a, b) {
    if (a.validBadgeCount !== b.validBadgeCount) return b.validBadgeCount - a.validBadgeCount;
    if (a.validCredits !== b.validCredits) return b.validCredits - a.validCredits;
    if (time(a.latestValidBadgeAt) !== time(b.latestValidBadgeAt)) {
        return time(a.latestValidBadgeAt) - time(b.latestValidBadgeAt);
    }
    if (a.username !== b.username) return a.username < b.username ? -1 : 1;
    return String(a.userId) < String(b.userId) ? -1 : 1;
}

/** Standard competition ranking: only an identical (count, credits, date) triple shares a rank (1, 1, 3). */
function assignRanks(rows) {
    rows.forEach((row, i) => {
        const prev = rows[i - 1];
        const tied = prev
            && prev.validBadgeCount === row.validBadgeCount
            && prev.validCredits === row.validCredits
            && time(prev.latestValidBadgeAt) === time(row.latestValidBadgeAt);
        row.rank = tied ? prev.rank : i + 1;
    });
    return rows;
}

/**
 * Recomputes the snapshot from User + UserBadge (read-only) and replaces the single
 * leaderboard doc in one write, so readers see either the old or the new snapshot.
 * Omitting `lastSuccessfulUpdate` keeps the current snapshot's value (ingestion must not fake a crawl time).
 * Rebuilds run one at a time (single instance), so a rebuild that started earlier, on older data,
 * can never overwrite a later one, e.g. an ingestion overlapping a crawl's rebuild.
 */
let queue = Promise.resolve();
function rebuildLeaderboard(options = {}) {
    const run = queue.then(() => buildAndReplace(options));
    queue = run.catch(() => {});
    return run;
}

async function buildAndReplace({ lastSuccessfulUpdate, startDate = "2026-10-26", endDate }) {
    if (lastSuccessfulUpdate === undefined) {
        lastSuccessfulUpdate = (await getSnapshot())?.lastSuccessfulUpdate ?? null;
    }
    const window = competitionWindow({ startDate, endDate });
    const [users, userBadges] = await Promise.all([
        User.find({}, { username: 1, skillsUrl: 1 }).lean(),
        UserBadge.find({}, { user: 1, badge: 1, earnedAt: 1 }).populate("badge", "name imageUrl").lean()
    ]);

    const byUser = new Map();
    for (const row of userBadges) {
        const key = String(row.user);
        if (!byUser.has(key)) byUser.set(key, []);
        byUser.get(key).push(row);
    }

    const rows = users.map((user) => {
        const valid = [...selectValidBadges(byUser.get(String(user._id)) ?? [], window).values()]
            .sort((a, b) => a.earnedAt - b.earnedAt);
        return {
            userId: user._id,
            username: user.username,
            skillsUrl: user.skillsUrl,
            validBadgeCount: valid.length,
            validCredits: valid.reduce((sum, r) => sum + badgeCredits(r.badge.name), 0),
            latestValidBadgeAt: valid.length ? valid[valid.length - 1].earnedAt : null,
            badges: valid.map((r) => ({ name: r.badge.name, imageUrl: r.badge.imageUrl ?? null, earnedAt: r.earnedAt }))
        };
    });
    assignRanks(rows.sort(compareRows));

    await Leaderboard.replaceOne(
        { _id: SNAPSHOT_ID },
        {
            lastSuccessfulUpdate,
            generatedAt: new Date(),
            competitionStartDate: window.start,
            rows
        },
        { upsert: true }
    );
    return { participants: rows.length };
}

async function getSnapshot() {
    return Leaderboard.findById(SNAPSHOT_ID).lean();
}

module.exports = { rebuildLeaderboard, getSnapshot, compareRows, assignRanks, SNAPSHOT_ID };
