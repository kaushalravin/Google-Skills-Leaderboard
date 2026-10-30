const { before, after, beforeEach } = require("node:test");

const { startMongo } = require("./mongo");
const { buildTestApp } = require("./app");
const { User } = require("../../models/users");
const { Badge } = require("../../models/badges");
const { UserBadge } = require("../../models/userBadges");
const { Leaderboard } = require("../../models/leaderboard");
const { rebuildLeaderboard, SNAPSHOT_ID } = require("../../services/leaderboard");

const START_DATE = "2026-10-26";
let seq = 0;

/** Registers the hooks: an in-memory DB emptied before each test, and `suite.app`. */
function leaderboardSuite() {
    const suite = {};
    let mongo;
    before(async () => {
        mongo = await startMongo();
        await Promise.all([User.init(), Badge.init(), UserBadge.init(), Leaderboard.init()]);
        ({ app: suite.app } = buildTestApp());
    });
    after(async () => {
        await mongo?.stop();
    });
    beforeEach(async () => {
        await Promise.all([
            User.deleteMany({}), Badge.deleteMany({}), UserBadge.deleteMany({}), Leaderboard.deleteMany({})
        ]);
    });
    return suite;
}

async function makeUser(username) {
    seq++;
    return User.create({
        username,
        email: `u${seq}@example.com`,
        skillsEmail: `u${seq}@skills.example.com`,
        skillsUrl: `https://www.skills.google/public_profiles/user-${seq}`,
        badgeCount: 0,
        credits: 3
    });
}

async function award(user, name, earnedAt, { newBadgeDoc = false } = {}) {
    seq++;
    const existing = newBadgeDoc ? null : await Badge.findOne({ name });
    const badge = existing ?? (await Badge.create({
        externalId: `ext-${seq}`,
        name,
        badgeUrl: `https://www.skills.google/badges/${seq}`,
        imageUrl: `https://cdn.example/${seq}.png`
    }));
    return UserBadge.create({ user: user._id, badge: badge._id, earnedAt: new Date(earnedAt) });
}

const rebuild = (options) => rebuildLeaderboard({ startDate: START_DATE, ...options });
const getSnapshot = () => Leaderboard.findById(SNAPSHOT_ID).lean();

module.exports = { leaderboardSuite, makeUser, award, rebuild, getSnapshot };
