const mongoose = require("mongoose");

const crawlerLogSchema = new mongoose.Schema(
    {
        runId: { type: String, required: true, unique: true },
        trigger: { type: String, enum: ["cron", "manual", "cli"], required: true },
        triggeredBy: String,
        status: { type: String, enum: ["running", "success", "partial", "failed", "aborted"], required: true },
        startedAt: { type: Date, required: true },
        finishedAt: Date,
        durationMs: Number,
        counts: {
            total: Number,
            succeeded: Number,
            failed: Number,
            empty: Number,
            badgesUpserted: Number,
            badgesSkippedNoDate: Number
        },
        failures: {
            type: [{ _id: false, userId: String, reason: String, httpStatus: Number }],
            default: undefined
        },
        error: String
    },
    { collection: "crawler_logs", versionKey: false }
);
crawlerLogSchema.index({ startedAt: -1 });
crawlerLogSchema.index({ status: 1, finishedAt: -1 });

const CrawlerLog = mongoose.model("CrawlerLog", crawlerLogSchema);

module.exports = { CrawlerLog };
