const { User } = require("../models/users");
require("../models/badges"); // registers Badge for populate
const { UserBadge } = require("../models/userBadges");
const { Leaderboard } = require("../models/leaderboard");
const {
    selectValidBadges, competitionWindow, badgeCredits, normalizeBadgeName, ACCEPTED_BADGE_NAMES, DAY_MS
} = require("./crawl");

const SNAPSHOT_ID = "current";
// Asia/Kolkata has no daylight saving, so its calendar day is always UTC shifted by 5 h 30 min.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

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

/**
 * One entry per UTC day from the start through the last crawl's day (or the latest counted badge,
 * whichever is later, so no counted badge falls outside), never past the end date or today in India:
 * a profile date ahead of the real date must not show up as a future day.
 */
function buildDailyCounts(validRows, window, lastSuccessfulUpdate, now) {
    const counts = new Map();
    let latest = lastSuccessfulUpdate ? lastSuccessfulUpdate.getTime() : null;
    for (const row of validRows) {
        const day = row.earnedAt.toISOString().slice(0, 10);
        counts.set(day, (counts.get(day) ?? 0) + 1);
        latest = Math.max(latest ?? 0, row.earnedAt.getTime());
    }
    if (latest === null) return [];
    if (window.end) latest = Math.min(latest, window.end.getTime() - 1);
    const todayIST = new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
    latest = Math.min(latest, Date.parse(`${todayIST}T00:00:00.000Z`));

    const days = [];
    for (let t = window.start.getTime(); t <= latest; t += DAY_MS) {
        const date = new Date(t).toISOString().slice(0, 10);
        days.push({ date, count: counts.get(date) ?? 0 });
    }
    return days;
}

/**
 * Movement is crawl to crawl: after a crawl, previousRank is the rank at the previous crawl, so
 * someone ingested in between (in the snapshot, but not at that crawl) is new. After ingestion the
 * existing values carry over. A snapshot from before crawlRanks were stored falls back to its rows'
 * ranks once; one from before previousRank existed stays without it until the next crawl.
 */
function previousRanks(previous, afterCrawl) {
    const prevRows = previous?.rows ?? [];
    const byUser = new Map(prevRows.map((row) => [String(row.userId), row]));
    const legacy = prevRows.length > 0 && !("previousRank" in prevRows[0]);
    const crawlRank = new Map((previous?.crawlRanks ?? prevRows).map((entry) => [String(entry.userId), entry.rank]));
    return (userId) => {
        const prev = byUser.get(String(userId));
        if (afterCrawl) return { previousRank: crawlRank.get(String(userId)) ?? null };
        if (prev) return "previousRank" in prev ? { previousRank: prev.previousRank } : {};
        return legacy ? {} : { previousRank: null };
    };
}

async function buildAndReplace({ lastSuccessfulUpdate, startDate, endDate, now = new Date() }) {
    const previous = await Leaderboard.findById(SNAPSHOT_ID, { lastSuccessfulUpdate: 1, rows: 1, crawlRanks: 1 }).lean();
    const afterCrawl = lastSuccessfulUpdate !== undefined;
    if (!afterCrawl) lastSuccessfulUpdate = previous?.lastSuccessfulUpdate ?? null;
    const previousRankOf = previousRanks(previous, afterCrawl);

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

    const allValid = [];
    const earnedBy = new Map(ACCEPTED_BADGE_NAMES.map((name) => [normalizeBadgeName(name), 0]));
    const rows = users.map((user) => {
        const valid = [...selectValidBadges(byUser.get(String(user._id)) ?? [], window).values()]
            .sort((a, b) => a.earnedAt - b.earnedAt);
        for (const r of valid) {
            allValid.push(r);
            const key = normalizeBadgeName(r.badge.name);
            earnedBy.set(key, earnedBy.get(key) + 1);
        }
        return {
            userId: user._id,
            username: user.username,
            skillsUrl: user.skillsUrl,
            validBadgeCount: valid.length,
            validCredits: valid.reduce((sum, r) => sum + badgeCredits(r.badge.name), 0),
            latestValidBadgeAt: valid.length ? valid[valid.length - 1].earnedAt : null,
            badges: valid.map((r) => ({ name: r.badge.name, imageUrl: r.badge.imageUrl ?? null, earnedAt: r.earnedAt })),
            ...previousRankOf(user._id)
        };
    });
    assignRanks(rows.sort(compareRows));
    const crawlRanks = afterCrawl
        ? rows.map((row) => ({ userId: row.userId, rank: row.rank }))
        : previous?.crawlRanks;

    await Leaderboard.replaceOne(
        { _id: SNAPSHOT_ID },
        {
            lastSuccessfulUpdate,
            generatedAt: new Date(),
            competitionStartDate: window.start,
            totalValidBadges: allValid.length,
            badgeStats: ACCEPTED_BADGE_NAMES.map((name) => ({ name, earnedBy: earnedBy.get(normalizeBadgeName(name)) })),
            dailyCounts: buildDailyCounts(allValid, window, lastSuccessfulUpdate, now),
            rows,
            ...(crawlRanks ? { crawlRanks } : {})
        },
        { upsert: true }
    );
    return { participants: rows.length };
}

module.exports = { rebuildLeaderboard, compareRows, assignRanks, SNAPSHOT_ID };
