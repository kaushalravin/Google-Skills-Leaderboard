const { randomUUID } = require("node:crypto");

const VALID_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Reuses a well-formed incoming x-request-id, otherwise generates one. */
function requestId(req, res, next) {
    const incoming = req.get("x-request-id");
    req.id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
    res.set("x-request-id", req.id);
    next();
}

module.exports = { requestId };
