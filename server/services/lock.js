const { randomUUID } = require("node:crypto");
const { JobLock } = require("../models/jobLock");

/** Makes sure the lock doc exists; MongoDB rejects $expr in an upsert filter, so this is separate. */
async function ensureLockDoc(name) {
    try {
        await JobLock.collection.updateOne(
            { _id: name },
            { $setOnInsert: { owner: null, meta: null, acquiredAt: null, heartbeatAt: null, expiresAt: new Date(0) } },
            { upsert: true }
        );
    } catch (err) {
        if (err.code !== 11000) throw err; // a concurrent upsert created it
    }
}

/**
 * Takes the lock if it is free or expired. Returns a lease, or null if someone holds it.
 * lease.signal aborts when the lease is lost (taken over, or renewal not confirmed in time).
 */
async function tryAcquire(name, { ttlMs, meta = null }) {
    await ensureLockDoc(name);
    const owner = randomUUID();
    const doc = await JobLock.collection.findOneAndUpdate(
        { _id: name, $expr: { $lte: ["$expiresAt", "$$NOW"] } },
        [
            {
                $set: {
                    owner,
                    meta: { $literal: meta },
                    acquiredAt: "$$NOW",
                    heartbeatAt: "$$NOW",
                    expiresAt: { $add: ["$$NOW", ttlMs] }
                }
            }
        ],
        { returnDocument: "after" }
    );
    if (!doc) return null;

    const controller = new AbortController();
    let released = false;
    let renewing = false;
    let expiryTimer;

    const lose = (reason) => {
        clearInterval(heartbeat);
        clearTimeout(expiryTimer);
        if (!controller.signal.aborted) controller.abort(new Error(`lock "${name}" lost: ${reason}`));
    };

    // The lease is only trusted until ttl after the last renewal we *sent* was confirmed.
    const armExpiry = (sentAt) => {
        clearTimeout(expiryTimer);
        expiryTimer = setTimeout(() => lose("renewal not confirmed before expiry"), sentAt + ttlMs - Date.now());
        expiryTimer.unref();
    };
    armExpiry(Date.now());

    const heartbeat = setInterval(async () => {
        if (renewing || released || controller.signal.aborted) return;
        renewing = true;
        const sentAt = Date.now();
        try {
            const res = await JobLock.collection.updateOne({ _id: name, owner }, [
                { $set: { heartbeatAt: "$$NOW", expiresAt: { $add: ["$$NOW", ttlMs] } } }
            ]);
            if (released) return;
            if (res.matchedCount === 0) lose("owner changed");
            else armExpiry(sentAt);
        } catch {
            // Transient DB error: the expiry timer aborts if no renewal succeeds in time.
        } finally {
            renewing = false;
        }
    }, Math.max(1, Math.floor(ttlMs / 3)));
    heartbeat.unref();

    return {
        meta,
        expiresAt: doc.expiresAt,
        signal: controller.signal,
        /** Idempotent; only clears the lock if we still own it. */
        async release() {
            if (released) return;
            released = true;
            clearInterval(heartbeat);
            clearTimeout(expiryTimer);
            await JobLock.collection.updateOne(
                { _id: name, owner },
                { $set: { owner: null, expiresAt: new Date(0) } }
            );
        }
    };
}

/** Current holder as seen by the DB clock. */
async function getLockState(name) {
    const [doc] = await JobLock.collection
        .aggregate([
            { $match: { _id: name } },
            {
                $project: {
                    acquiredAt: 1,
                    expiresAt: 1,
                    meta: 1,
                    held: { $and: [{ $ne: [{ $ifNull: ["$owner", null] }, null] }, { $gt: ["$expiresAt", "$$NOW"] }] }
                }
            }
        ])
        .toArray();
    if (!doc || !doc.held) return { held: false, acquiredAt: null, expiresAt: null, meta: null };
    return { held: true, acquiredAt: doc.acquiredAt, expiresAt: doc.expiresAt, meta: doc.meta ?? null };
}

module.exports = { tryAcquire, getLockState };
