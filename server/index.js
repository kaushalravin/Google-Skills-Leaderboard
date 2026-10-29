// Must be first: forces TZ=UTC before anything parses a date.
const { assertUtc } = require("./config/timezone");

const { loadEnv, loadEnvFile, EnvError } = require("./config/env");
const { createLogger } = require("./config/logger");
const { connectDb, waitForIndexes, disconnectDb } = require("./config/db");
const { createApp } = require("./app");
const { reconcileOrphanedRuns } = require("./services/crawlRunner");

const FORCE_EXIT_MS = 25000;

async function main() {
    assertUtc();
    loadEnvFile();

    let config;
    try {
        config = loadEnv();
    } catch (err) {
        if (!(err instanceof EnvError)) throw err;
        process.stderr.write(`Invalid environment configuration:\n${err.message}\n`);
        process.exit(1);
    }

    const logger = createLogger({ level: config.LOG_LEVEL });

    process.on("unhandledRejection", (err) => {
        logger.fatal({ err }, "unhandled promise rejection");
        process.exit(1);
    });

    try {
        await connectDb(config.MONGO_URI, {
            logger,
            serverSelectionTimeoutMS: config.MONGO_SERVER_SELECTION_TIMEOUT_MS
        });
    } catch (err) {
        logger.fatal({ err }, "MongoDB connection failed");
        process.exit(1);
    }
    await waitForIndexes(logger);

    const orphaned = await reconcileOrphanedRuns();
    if (orphaned > 0) logger.warn({ orphaned }, "marked orphaned crawl runs as failed");

    const app = createApp({ config, logger });
    const server = app.listen(config.PORT, (err) => {
        if (err) {
            logger.fatal({ err }, "HTTP server failed to start");
            process.exit(1);
        }
        logger.info({ port: server.address().port }, "server listening");
    });

    let shuttingDown = false;
    const shutdown = async (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info({ signal }, "shutting down");
        setTimeout(() => {
            logger.error("graceful shutdown timed out; forcing exit");
            process.exit(1);
        }, FORCE_EXIT_MS).unref();

        // Stop accepting connections; idle keep-alive sockets would otherwise hold close() up.
        const closed = new Promise((resolve) => server.close(resolve));
        server.closeIdleConnections();
        await closed;
        await disconnectDb().catch((err) => logger.error({ err }, "closing MongoDB failed"));
        logger.info("shutdown complete");
        process.exit(0);
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
    process.stderr.write(`Fatal startup error: ${err.stack || err}\n`);
    process.exit(1);
});
