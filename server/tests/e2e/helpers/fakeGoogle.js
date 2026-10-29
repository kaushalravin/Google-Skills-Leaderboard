// Preloaded with `node --require` into the real server (or a script) during e2e tests.
// Intercepts https://www.skills.google/public_profiles/<id> and serves pages shaped like real
// public profiles, driven by the JSON file at FAKE_GOOGLE_SCENARIO (re-read on every request,
// so a test can change a profile between crawls). Every request is appended to FAKE_GOOGLE_LOG.
// All other outbound HTTP is blocked; localhost stays reachable.
//
// Scenario: { "profiles": { "<id>": { "mode": "...", "badges": [{ "title", "earned" }], "delayMs": 0 } } }
// Modes: "badges" (default), "noBadges", "signin", "404", "500-then-200", "429-then-200".
// A badge's `earned` is the full text shown on the profile, e.g. "Earned Oct 27, 2026 EDT".
const fs = require("node:fs");
const nock = require("nock");

const SCENARIO = process.env.FAKE_GOOGLE_SCENARIO;
const LOG = process.env.FAKE_GOOGLE_LOG;
const seen = new Map(); // profile id -> requests served so far, for the "-then-200" modes

const escape = (text) =>
    String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function profilePage(id, badges) {
    const items = badges
        .map(
            (badge, i) => `
        <div class="profile-badge">
          <a class="badge-image" href="/public_profiles/${id}/badges/${id}-${i}">
            <img src="https://cdn.qwiklabs.com/${id}-${i}.png" alt="">
          </a>
          <span class="ql-title-medium l-mts">${escape(badge.title)}</span>
          <span class="ql-body-medium l-mbs">${escape(badge.earned)}</span>
        </div>`
        )
        .join("");
    return `<!doctype html><html><body><main class="public-profile">
      <h1 class="ql-display-small">Participant ${escape(id)}</h1>
      <div class="profile-badges">${items}</div>
    </main></body></html>`;
}

// Neither a sign-in wall nor a profile without badges renders the .profile-badges container.
const NO_BADGES_PAGE = `<!doctype html><html><body><main class="public-profile">
  <h1 class="ql-display-small">Participant</h1><p>This profile has not earned any badges yet.</p></main></body></html>`;
const SIGN_IN_PAGE = `<!doctype html><html><body><form action="/users/sign_in" method="post">
  <h1>Sign in</h1><input name="user[email]"><input name="user[password]" type="password"></form></body></html>`;

function readScenario() {
    return JSON.parse(fs.readFileSync(SCENARIO, "utf8"));
}

function respond(id) {
    const profile = readScenario().profiles?.[id];
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    if (!profile) return [404, "Not Found"];

    const html = { "Content-Type": "text/html; charset=utf-8" };
    switch (profile.mode ?? "badges") {
        case "badges":
            return [200, profilePage(id, profile.badges ?? []), html];
        case "noBadges":
            return [200, NO_BADGES_PAGE, html];
        case "signin":
            return [200, SIGN_IN_PAGE, html];
        case "404":
            return [404, "Not Found", html];
        case "500-then-200":
            return count === 1 ? [500, "Internal Server Error", html] : [200, profilePage(id, profile.badges ?? []), html];
        case "429-then-200":
            return count === 1
                ? [429, "Too Many Requests", { ...html, "Retry-After": "1" }]
                : [200, profilePage(id, profile.badges ?? []), html];
        default:
            throw new Error(`fakeGoogle: unknown mode ${profile.mode}`);
    }
}

nock.disableNetConnect();
nock.enableNetConnect((host) => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host));

nock("https://www.skills.google")
    .persist()
    .get(/^\/public_profiles\/[^/?#]+\/?(\?.*)?$/)
    .reply(async (uri) => {
        const t = Date.now(); // when the request arrived
        const id = uri.split("?")[0].split("/")[2];
        const [status, body, headers] = respond(id);
        if (LOG) fs.appendFileSync(LOG, `${JSON.stringify({ t, id, status })}\n`);
        const delayMs = readScenario().profiles?.[id]?.delayMs ?? 0;
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        return [status, body, headers];
    });
