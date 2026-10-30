const express = require("express");
const { z } = require("zod");

const { AppError } = require("../middleware/errors");
const { requireAdmin } = require("../middleware/requireAdmin");
const { ingestParticipants } = require("../services/ingest");

const rowsSchema = z.array(z.unknown()).min(1).max(500);

/** One row object, an array of rows, or { participants: [...] }. Anything else fails validation. */
function toRows(body) {
    if (Array.isArray(body)) return body;
    if (body && typeof body === "object") return "participants" in body ? body.participants : [body];
    return null;
}

const participantsRouter = express.Router();

participantsRouter.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});
participantsRouter.use(requireAdmin);

//used for upserting a participant row or multiple rows. Returns a summary of the operation.
participantsRouter.post("/", async (req, res) => {
    const parsed = rowsSchema.safeParse(toRows(req.body));
    if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Body must be a participant row, an array of 1–500 rows, or { participants: [...] }");
    }

    const { config, logger } = req.app.locals;
    const result = await ingestParticipants(parsed.data, {
        startDate: config.COMPETITION_START_DATE,
        endDate: config.COMPETITION_END_DATE,
        logger: req.log ?? logger
    });

    if (result.rejected.length === result.received) {
        throw new AppError(422, "ALL_ROWS_REJECTED", "Every row was rejected", result);
    }
    res.json(result);
});

module.exports = { participantsRouter };
