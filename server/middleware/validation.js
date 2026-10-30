const { AppError } = require("./errors");

/** Parses `input` with a zod schema, or throws a 400 VALIDATION_ERROR listing each problem. */
function parse(schema, input) {
    const result = schema.safeParse(input);
    if (!result.success) {
        throw new AppError(
            400,
            "VALIDATION_ERROR",
            "Invalid request",
            result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
        );
    }
    return result.data;
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

module.exports = { parse, escapeRegex };
