const mongoose = require("mongoose");

mongoose.set("strictQuery", true);

/** Connects or throws; callers decide whether a failure is fatal. */
async function connectDb(uri, { logger, serverSelectionTimeoutMS = 10000 } = {}) {
    await mongoose.connect(uri, { serverSelectionTimeoutMS });

    const { connection } = mongoose;
    logger?.info({ db: connection.name, host: connection.host }, "MongoDB connected");
    connection.on("disconnected", () => logger?.warn("MongoDB disconnected"));
    connection.on("reconnected", () => logger?.info("MongoDB reconnected"));
    return connection;
}

// Mongoose builds the schema indexes in the background after connecting. Waiting for them keeps
// the first requests on a fresh database from slipping past the unique indexes. Model.init()
// only creates missing indexes (it never drops any, unlike syncIndexes). A failed build, e.g.
// because of existing duplicates, is logged and the server still starts.
async function waitForIndexes(logger) {
    await Promise.all(
        Object.values(mongoose.models).map((model) =>
            model.init().catch((err) => logger?.error({ err, model: model.modelName }, "index build failed"))
        )
    );
}

async function disconnectDb() {
    await mongoose.disconnect();
}

module.exports = { connectDb, waitForIndexes, disconnectDb };
