// Must be first: forces TZ=UTC before anything parses a date.
const { assertUtc } = require("./config/timezone");

const { loadEnv, loadEnvFile, EnvError } = require("./config/env");
const { createLogger } = require("./config/logger");
const { connectDb, waitForIndexes, disconnectDb } = require("./config/db");
const { createApp } = require("./app");
const { reconcileOrphanedRuns, activeRuns } = require("./services/crawlRunner");
const { startScheduler, stopScheduler } = require("./jobs/scheduler");

const RUNS_TIMEOUT_MS = 20000; // how long shutdown waits for in-flight crawls to finish
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

    // One process-wide signal: aborting it stops running crawls (manual or cron) at shutdown.
    const shutdownController = new AbortController();
    const crawlDeps = { signal: shutdownController.signal };

    const app = createApp({ config, logger, crawlDeps });
    const server = app.listen(config.PORT, (err) => {
        if (err) {
            logger.fatal({ err }, "HTTP server failed to start");
            process.exit(1);
        }
        logger.info({ port: server.address().port }, "server listening");
        startScheduler({ config, logger, deps: crawlDeps });
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
        await stopScheduler().catch((err) => logger.error({ err }, "stopping the scheduler failed"));
        // Abort running crawls and wait (capped) for them to write their log and release the lock.
        shutdownController.abort(new Error("server shutting down"));
        let capTimer;
        const cap = new Promise((resolve) => {
            capTimer = setTimeout(resolve, RUNS_TIMEOUT_MS, "timeout");
        });
        const outcome = await Promise.race([Promise.all([...activeRuns(), closed]), cap]);
        clearTimeout(capTimer);
        if (outcome === "timeout") logger.warn("in-flight crawls/requests did not finish in time");
        await disconnectDb().catch((err) => logger.error({ err }, "closing MongoDB failed"));
        logger.info("shutdown complete");
        process.exit(0);
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    // Windows can't deliver a catchable SIGTERM to a child process (child.kill() terminates it),
    // so the shutdown test sends this IPC message instead. Test-only: never active in production.
    if (config.NODE_ENV === "test" && process.send) {
        process.on("message", (msg) => {
            if (msg === "shutdown") shutdown("ipc:shutdown");
        });
    }
}

main().catch((err) => {
    process.stderr.write(`Fatal startup error: ${err.stack || err}\n`);
    process.exit(1);
});
