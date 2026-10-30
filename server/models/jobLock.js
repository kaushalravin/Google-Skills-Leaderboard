const mongoose = require("mongoose");

// One doc per lock name. All lock operations go through the native collection so the
// pipeline updates can use the DB clock ($$NOW) instead of this process's clock.
const JobLock = mongoose.model(
    "JobLock",
    new mongoose.Schema(
        {
            _id: String,
            owner: String,
            meta: mongoose.Schema.Types.Mixed,
            acquiredAt: Date,
            heartbeatAt: Date,
            expiresAt: Date
        },
        { collection: "job_locks", versionKey: false }
    )
);

module.exports = { JobLock };
