// The protected scraper parses "Earned Oct 26, 2026 EDT" with new Date("Oct 26, 2026"),
// which uses the process timezone. Forcing UTC makes stored earnedAt values
// deterministic (UTC midnight of the displayed date) without touching the scraper.
// Must be required before anything parses a date. Node applies TZ changes at runtime.
process.env.TZ = "UTC";

function assertUtc() {
    const parsed = new Date("Oct 26, 2026").toISOString();
    if (parsed !== "2026-10-26T00:00:00.000Z") {
        throw new Error(`Timezone is not UTC: "Oct 26, 2026" parsed as ${parsed}`);
    }
}

module.exports = { assertUtc };
