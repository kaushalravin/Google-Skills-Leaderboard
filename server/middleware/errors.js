/** An error that maps directly onto the API error shape. */
class AppError extends Error {
    constructor(status, code, message, details) {
        super(message);
        this.name = "AppError";
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

function notFound(req, res, next) {
    next(new AppError(404, "NOT_FOUND", `Route ${req.method} ${req.path} not found`));
}

// body-parser errors carry a `type`; map the ones clients can cause.
const BODY_ERRORS = {
    "entity.parse.failed": [400, "INVALID_JSON", "Request body is not valid JSON"],
    "entity.too.large": [413, "PAYLOAD_TOO_LARGE", "Request body is too large"],
    "encoding.unsupported": [415, "UNSUPPORTED_ENCODING", "Unsupported content encoding"]
};

function toApiError(err) {
    if (err instanceof AppError) return err;
    const known = BODY_ERRORS[err?.type];
    if (known) return new AppError(...known);
    // Other client errors raised by Express (e.g. a malformed %-encoding in the URL). Their
    // messages can echo the input, so only the status is kept.
    if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 500) {
        return new AppError(err.status, "BAD_REQUEST", "Bad request");
    }
    return new AppError(500, "INTERNAL_ERROR", "Internal server error");
}

/** Central error handler: every error leaves as { error: { code, message, details?, requestId } }. */
function errorHandler() {
    // Express identifies error middleware by its four-argument signature.
    return (err, req, res, next) => {
        if (res.headersSent) return next(err);

        const apiError = toApiError(err);
        if (apiError.status >= 500) {
            req.log?.error({ err }, "unhandled error");
        }

        const body = { code: apiError.code, message: apiError.message };
        if (apiError.details !== undefined) body.details = apiError.details;
        body.requestId = req.id;

        res.status(apiError.status).json({ error: body });
    };
}

module.exports = { AppError, notFound, errorHandler };
