const express = require("express");
const pinoHttp = require("pino-http");

const { requestId } = require("./middleware/requestId");
const { notFound, errorHandler } = require("./middleware/errors");
const { participantsRouter } = require("./routes/participants");
const { adminRouter } = require("./routes/admin");
const { leaderboardRouter } = require("./routes/leaderboard");

// Builds the app without connecting to MongoDB or listening, so tests can use it directly.
// `crawlDeps` is passed through to startCrawl by the admin routes.
function createApp({ config, logger, crawlDeps = {} }) {
    const app = express();
    app.locals.config = config;
    app.locals.logger = logger;
    app.locals.crawlDeps = crawlDeps;

    app.disable("x-powered-by");
    app.set("trust proxy", config.TRUST_PROXY > 0 ? config.TRUST_PROXY : false);

    app.use(requestId);
    app.use(
        pinoHttp({
            logger,
            genReqId: (req) => req.id,
            customLogLevel: (req, res, err) => {
                if (err || res.statusCode >= 500) return "error";
                if (res.statusCode >= 400) return "warn";
                return "info";
            }
        })
    );

    // Bulk ingestion gets a larger body limit; express.json skips already-parsed bodies.
    app.use("/api/admin/participants", express.json({ limit: "1mb" }));
    app.use(express.json({ limit: "100kb" }));

    app.use("/api/admin/participants", participantsRouter);
    app.use("/api/admin", adminRouter);
    app.use("/api/leaderboard", leaderboardRouter);

    app.use(notFound);
    app.use(errorHandler());

    return app;
}

module.exports = { createApp };
