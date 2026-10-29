const { createHash, timingSafeEqual } = require("node:crypto");

const { AppError } = require("./errors");

// Hashing first gives equal-length buffers, so neither the key nor its length leaks via timing.
const digest = (value) => createHash("sha256").update(String(value)).digest();

function requireAdmin(req, res, next) {
    const provided = req.get("x-admin-key");
    const expected = req.app.locals.config.ADMIN_API_KEY;
    if (!provided || !timingSafeEqual(digest(provided), digest(expected))) {
        return next(new AppError(401, "UNAUTHORIZED", "Missing or invalid admin key"));
    }
    next();
}

module.exports = { requireAdmin };
