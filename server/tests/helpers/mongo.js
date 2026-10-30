const { MongoMemoryReplSet } = require("mongodb-memory-server");

const { connectDb, disconnectDb } = require("../../config/db");

/**
 * Starts a single-node in-memory replica set (matching production semantics
 * for the crawl lock and write concerns) and connects Mongoose to it.
 * Call once per test file: node:test runs each file in its own process.
 */
async function startMongo() {
    const replSet = await MongoMemoryReplSet.create({
        replSet: { count: 1, storageEngine: "wiredTiger" }
    });
    await connectDb(replSet.getUri("leaderboard-test"));

    return {
        async stop() {
            await disconnectDb();
            await replSet.stop();
        }
    };
}

module.exports = { startMongo };
