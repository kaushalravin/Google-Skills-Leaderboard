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
        userId: mongoose.Schema.Types.ObjectId,
        username: String,
        skillsUrl: String,
        validBadgeCount: Number,
        latestValidBadgeAt: Date,
        badges: [badgeSchema]
    },
    { _id: false }
);

/** A single precomputed snapshot (`_id: "current"`), replaced as a whole. No emails. */
const leaderboardSchema = new mongoose.Schema(
    {
        _id: String,
        lastSuccessfulUpdate: Date,
        generatedAt: Date,
        competitionStartDate: Date,
        rows: [rowSchema]
    },
    { collection: "leaderboard", versionKey: false }
);

const Leaderboard = mongoose.model("Leaderboard", leaderboardSchema);

module.exports = { Leaderboard };
