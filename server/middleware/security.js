const helmet = require("helmet");
const cors = require("cors");
const { rateLimit } = require("express-rate-limit");

const { AppError } = require("./errors");

// An empty CORS_ORIGINS allows any origin: the public routes are read-only GETs.
function securityMiddleware(config) {
    return [
        helmet(),
        cors({ origin: config.CORS_ORIGINS.length > 0 ? config.CORS_ORIGINS : "*" })
    ];
}

function limiter(limit) {
    return rateLimit({
        windowMs: 60 * 1000,
        limit,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        handler: (req, res, next) => {
            next(new AppError(429, "RATE_LIMITED", "Too many requests, please try again later"));
        }
    });
}

const publicLimiter = (config) => limiter(config.RATE_LIMIT_PUBLIC_PER_MIN);
// Mounted before requireAdmin, so wrong-key guesses are throttled too.
const adminLimiter = (config) => limiter(config.RATE_LIMIT_ADMIN_PER_MIN);

module.exports = { securityMiddleware, publicLimiter, adminLimiter };
