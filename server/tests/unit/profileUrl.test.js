require("../../config/timezone");

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { normalizeProfileUrl } = require("../../services/ingest");

const CANONICAL = "https://www.skills.google/public_profiles/aB12-cd34";

test("accepted variants map to exactly the seed's canonical form, id case preserved", () => {
    for (const input of [
        CANONICAL,
        "https://skills.google/public_profiles/aB12-cd34",
        "http://www.skills.google/public_profiles/aB12-cd34",
        "http://skills.google/public_profiles/aB12-cd34",
        "https://www.cloudskillsboost.google/public_profiles/aB12-cd34",
        "https://cloudskillsboost.google/public_profiles/aB12-cd34",
        "https://www.skills.google/public_profiles/aB12-cd34/",
        "https://www.skills.google/public_profiles/aB12-cd34?utm_source=form",
        "https://www.skills.google/public_profiles/aB12-cd34#badges",
        "https://www.skills.google/public_profiles/aB12-cd34/?x=1#y",
        "HTTPS://WWW.SKILLS.GOOGLE/public_profiles/aB12-cd34",
        "  https://www.skills.google/public_profiles/aB12-cd34  "
    ]) {
        assert.equal(normalizeProfileUrl(input), CANONICAL, input);
    }
    assert.equal(
        normalizeProfileUrl("https://www.skills.google/public_profiles/AB12-CD34"),
        "https://www.skills.google/public_profiles/AB12-CD34"
    );
});

test("everything else is rejected (SSRF guard)", () => {
    for (const input of [
        "https://evil.com/public_profiles/abc",
        "https://skills.google.evil.com/public_profiles/abc",
        "https://evilskills.google/public_profiles/abc",
        "https://www.skills.google.evil.com/public_profiles/abc",
        "https://skills.google./public_profiles/abc",
        "https://sub.skills.google/public_profiles/abc",
        "https://127.0.0.1/public_profiles/abc",
        "https://www.skills.google/profiles/abc",
        "https://www.skills.google/public_profiles/",
        "https://www.skills.google/public_profiles",
        "https://www.skills.google/",
        "https://www.skills.google/public_profiles/abc/badges",
        "https://www.skills.google/public_profiles/abc/def",
        "https://www.skills.google/public_profiles//abc",
        "https://www.skills.google/public_profiles/a%2Fb",
        "https://www.skills.google/public_profiles/../admin",
        "https://user:pass@www.skills.google/public_profiles/abc",
        "https://user@www.skills.google/public_profiles/abc",
        "https://www.skills.google@evil.com/public_profiles/abc",
        "https://www.skills.google:8443/public_profiles/abc",
        "http://www.skills.google:8080/public_profiles/abc",
        "ftp://www.skills.google/public_profiles/abc",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "//www.skills.google/public_profiles/abc",
        "www.skills.google/public_profiles/abc",
        "not a url",
        "",
        null,
        undefined,
        42,
        {}
    ]) {
        assert.equal(normalizeProfileUrl(input), null, String(input));
    }
});
