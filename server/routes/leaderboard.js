const express = require("express");
const mongoose = require("mongoose");
const { z } = require("zod");

const { Leaderboard } = require("../models/leaderboard");
const { SNAPSHOT_ID } = require("../services/leaderboard");
const { AppError } = require("../middleware/errors");
const { parse } = require("../middleware/validation");

const CACHE_CONTROL = "public, max-age=30, stale-while-revalidate=60";

const listQuery = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    search: z.string().trim().max(100).optional()
});

const userIdParam = z.string().regex(/^[0-9a-fA-F]{24}$/, "must be a 24-character hex id");

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
        { $project: { lastSuccessfulUpdate: 1, competitionStartDate: 1, matching } },
        {
            $project: {
                lastSuccessfulUpdate: 1,
                competitionStartDate: 1,
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
        rows: (doc?.rows ?? []).map(withCredits)
    });
});

leaderboardRouter.get("/:userId", async (req, res) => {
    const userId = new mongoose.Types.ObjectId(parse(userIdParam, req.params.userId));
    const [doc] = await Leaderboard.aggregate([
        { $match: { _id: SNAPSHOT_ID } },
        { $project: { row: { $first: { $filter: { input: "$rows", as: "r", cond: { $eq: ["$$r.userId", userId] } } } } } }
    ]);
    if (!doc?.row) throw new AppError(404, "NOT_FOUND", "Participant not found on the leaderboard");
    res.set("Cache-Control", CACHE_CONTROL).json(withCredits(doc.row));
});

module.exports = { leaderboardRouter };
