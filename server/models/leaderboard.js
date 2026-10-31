const mongoose = require("mongoose");

const badgeSchema = new mongoose.Schema(
    {
        name: String,
        imageUrl: String,
        earnedAt: Date
    },
    { _id: false }
);

const rowSchema = new mongoose.Schema(
    {
        rank: Number,
        previousRank: Number,
        userId: mongoose.Schema.Types.ObjectId,
        username: String,
        skillsUrl: String,
        validBadgeCount: Number,
        validCredits: Number,
        latestValidBadgeAt: Date,
        badges: [badgeSchema]
    },
    { _id: false }
);

const badgeStatSchema = new mongoose.Schema({ name: String, earnedBy: Number }, { _id: false });
const dailyCountSchema = new mongoose.Schema({ date: String, count: Number }, { _id: false });
const crawlRankSchema = new mongoose.Schema({ userId: mongoose.Schema.Types.ObjectId, rank: Number }, { _id: false });

/** A single precomputed snapshot (`_id: "current"`), replaced as a whole. No emails. */
const leaderboardSchema = new mongoose.Schema(
    {
        _id: String,
        lastSuccessfulUpdate: Date,
        generatedAt: Date,
        competitionStartDate: Date,
        totalValidBadges: Number,
        badgeStats: [badgeStatSchema],
        dailyCounts: [dailyCountSchema],
        rows: [rowSchema],
        // Who was on the board at the last crawl, and where: the baseline for the next crawl's movement. Internal only.
        crawlRanks: { type: [crawlRankSchema], default: undefined }
    },
    { collection: "leaderboard", versionKey: false }
);

const Leaderboard = mongoose.model("Leaderboard", leaderboardSchema);

module.exports = { Leaderboard };
