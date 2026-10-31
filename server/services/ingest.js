const { z } = require("zod");

const { User } = require("../models/users");
const { rebuildLeaderboard } = require("./leaderboard");
const { escapeRegex } = require("../middleware/validation");

const PROFILE_HOSTS = new Set([
    "skills.google",
    "www.skills.google",
    "cloudskillsboost.google",
    "www.cloudskillsboost.google"
]);
// Same id charset as seeds/userSeed.js, which defines the canonical form.
const PROFILE_PATH = /^\/public_profiles\/([A-Za-z0-9-]+)\/?$/;

/**
 * Canonical `https://www.skills.google/public_profiles/<id>` (id case preserved), or null.
 * Only http(s) on the four known hosts, no credentials, no explicit port, and exactly
 * one id segment (SSRF guard: the crawler only ever fetches the canonical string).
 */
function normalizeProfileUrl(value) {
    if (typeof value !== "string") return null;
    let url;
    try {
        url = new URL(value.trim());
    } catch {
        return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || url.port) return null;
    if (!PROFILE_HOSTS.has(url.hostname)) return null;
    const match = PROFILE_PATH.exec(url.pathname);
    return match ? `https://www.skills.google/public_profiles/${match[1]}` : null;
}

// Emails are stored trimmed + lowercased, like the seed.
const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const rowSchema = z.object({
    username: z.string().trim().min(1).max(200),
    email,
    skillsEmail: email,
    profileUrl: z.string().max(2048)
});

/**
 * Inserts or updates one participant by profile id (case-insensitive).
 * Returns "inserted" | "updated" | "email_in_use_by_other_profile".
 */
async function upsertParticipant({ username, email, skillsEmail, skillsUrl }) {
    const sameProfile = new RegExp(`^${escapeRegex(skillsUrl)}$`, "i");
    const fields = { username, email, skillsEmail };
    for (let attempt = 0; ; attempt++) {
        try {
            const existing = await User.findOne({ skillsUrl: sameProfile }, { _id: 1 }).sort({ _id: 1 }).lean();
            if (existing) {
                // The stored skillsUrl (e.g. the seed's) stays as is; badgeCount/credits are never touched.
                await User.updateOne({ _id: existing._id }, { $set: fields });
                return "updated";
            }
            // New users get the schema defaults for badgeCount/credits (setDefaultsOnInsert).
            const result = await User.updateOne({ skillsUrl }, { $set: fields }, { upsert: true });
            return result.upsertedCount ? "inserted" : "updated";
        } catch (err) {
            if (err.code !== 11000) throw err;
            // Lost an insert race for the same URL: the retry finds the winner and updates it.
            if (err.keyPattern?.skillsUrl && attempt === 0) continue;
            return "email_in_use_by_other_profile";
        }
    }
}

// The app runs as a single instance: one batch at a time, so case-variant URLs can't race
// past the find (the unique index only catches exact-string duplicates).
let queue = Promise.resolve();
function serialized(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
}

/**
 * Validates and upserts `rows` (1–500 raw objects). Invalid rows are rejected per row;
 * within the batch the LAST row for a profile id wins and earlier ones count as duplicates.
 * After any write the leaderboard snapshot is rebuilt, keeping its lastSuccessfulUpdate.
 */
function ingestParticipants(rows, { startDate, endDate, logger }) {
    return serialized(async () => {
        const result = { received: rows.length, inserted: 0, updated: 0, duplicatesInBatch: 0, rejected: [] };

        const byProfile = new Map();
        rows.forEach((raw, index) => {
            const parsed = rowSchema.safeParse(raw);
            if (!parsed.success) {
                const field = parsed.error.issues[0]?.path[0];
                result.rejected.push({ index, reason: field === "profileUrl" ? "invalid_profile_url" : "invalid_row" });
                return;
            }
            const skillsUrl = normalizeProfileUrl(parsed.data.profileUrl);
            if (!skillsUrl) {
                result.rejected.push({ index, reason: "invalid_profile_url" });
                return;
            }
            const key = skillsUrl.toLowerCase();
            if (byProfile.has(key)) result.duplicatesInBatch++;
            byProfile.set(key, { index, ...parsed.data, skillsUrl });
        });

        for (const { index, username, email, skillsEmail, skillsUrl } of byProfile.values()) {
            const outcome = await upsertParticipant({ username, email, skillsEmail, skillsUrl });
            if (outcome === "inserted") result.inserted++;
            else if (outcome === "updated") result.updated++;
            else result.rejected.push({ index, reason: outcome });
        }
        result.rejected.sort((a, b) => a.index - b.index);

        if (result.inserted + result.updated > 0) {
            try {
                // No lastSuccessfulUpdate: the rebuild keeps the snapshot's current value.
                await rebuildLeaderboard({ startDate, endDate });
            } catch (err) {
                // The ingested rows are already stored; the next crawl rebuilds the snapshot.
                logger.error({ err }, "leaderboard rebuild after ingestion failed");
            }
        }

        logger.info(
            {
                received: result.received,
                inserted: result.inserted,
                updated: result.updated,
                duplicatesInBatch: result.duplicatesInBatch,
                rejected: result.rejected
            },
            "participants ingested"
        );
        return result;
    });
}

module.exports = { normalizeProfileUrl, ingestParticipants };
