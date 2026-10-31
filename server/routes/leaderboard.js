const express = require("express");
const mongoose = require("mongoose");
const { z } = require("zod");

const { Leaderboard } = require("../models/leaderboard");
const { SNAPSHOT_ID } = require("../services/leaderboard");
const { AppError } = require("../middleware/errors");
const { parse, escapeRegex } = require("../middleware/validation");

const CACHE_CONTROL = "public, max-age=30, stale-while-revalidate=60";

const listQuery = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    search: z.string().trim().max(100).optional()
});

const userIdParam = z.string().regex(/^[0-9a-fA-F]{24}$/, "must be a 24-character hex id");

// A snapshot built before credits were ranked has no validCredits until the next rebuild: report it as unknown, not 0.
const withCredits = (row) => ({ ...row, validCredits: row.validCredits ?? null });

const leaderboardRouter = express.Router();

// Pages are cut inside MongoDB ($filter + $slice), so a request never loads every row.
leaderboardRouter.get("/", async (req, res) => {
    const { page, limit, search } = parse(listQuery, req.query);
    const matching = search
        ? {
            $filter: {
                input: "$rows",
                as: "r",
                cond: { $regexMatch: { input: "$$r.username", regex: escapeRegex(search), options: "i" } }
            }
        }
        : "$rows";

    const [doc] = await Leaderboard.aggregate([
        { $match: { _id: SNAPSHOT_ID } },
        { $set: { matching } },
        {
            $project: {
                lastSuccessfulUpdate: 1,
                competitionStartDate: 1,
                totalValidBadges: 1,
                badgeStats: 1,
                dailyCounts: 1,
                total: { $size: "$matching" },
                rows: { $slice: ["$matching", (page - 1) * limit, limit] }
            }
        }
    ]);

    const total = doc?.total ?? 0;
    res.set("Cache-Control", CACHE_CONTROL).json({
        lastSuccessfulUpdate: doc?.lastSuccessfulUpdate ?? null,
        competitionStartDate: doc?.competitionStartDate ?? null,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        totalValidBadges: doc?.totalValidBadges,
        badgeStats: doc?.badgeStats,
        dailyCounts: doc?.dailyCounts,
        rows: (doc?.rows ?? []).map(withCredits)
    });
});

// Only the participant's row and the one ahead of it leave MongoDB. Rows are sorted by rank, so
// the nearest strictly better rank is the last earlier row whose rank is lower (equal ranks skipped).
leaderboardRouter.get("/:userId", async (req, res) => {
    const userId = new mongoose.Types.ObjectId(parse(userIdParam, req.params.userId));
    const [doc] = await Leaderboard.aggregate([
        { $match: { _id: SNAPSHOT_ID } },
        { $project: { rows: 1, total: { $size: "$rows" }, index: { $indexOfArray: ["$rows.userId", userId] } } },
        { $match: { index: { $gte: 0 } } },
        { $project: { rows: 1, total: 1, index: 1, row: { $arrayElemAt: ["$rows", "$index"] } } },
        {
            $project: {
                total: 1,
                index: 1,
                row: 1,
                ahead: {
                    $last: {
                        $filter: {
                            input: { $slice: ["$rows", "$index"] },
                            as: "r",
                            cond: { $lt: ["$$r.rank", "$row.rank"] }
                        }
                    }
                }
            }
        }
    ]);
    if (!doc) throw new AppError(404, "NOT_FOUND", "Participant not found on the leaderboard");
    const { ahead } = doc;
    res.set("Cache-Control", CACHE_CONTROL).json({
        ...withCredits(doc.row),
        position: doc.index + 1,
        totalParticipants: doc.total,
        ahead: ahead
            ? withCredits({
                rank: ahead.rank,
                username: ahead.username,
                validBadgeCount: ahead.validBadgeCount,
                validCredits: ahead.validCredits
            })
            : null
    });
});

module.exports = { leaderboardRouter };
