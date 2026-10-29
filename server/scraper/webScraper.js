
const axios = require("axios");
const cheerio = require("cheerio");

const { User } = require("../models/users");
const { Badge } = require("../models/badges");
const { UserBadge } = require("../models/userBadges");

const sleep = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

async function scrapeProfile(skillsUrl) {
    const response = await axios.get(skillsUrl, {
        timeout: 15000
    });

    const $ = cheerio.load(response.data);

    // Profiles without badges do not render the badge container.
    if ($(".profile-badges").length === 0) {
        return [];
    }

    return $(".profile-badges .profile-badge")
        .map((_, element) => {
            const badgeElement = $(element);

            const badgeUrl = badgeElement
                .find("a.badge-image")
                .attr("href");

            const name = badgeElement
                .find("span.ql-title-medium.l-mts")
                .text()
                .trim();

            const imageUrl = badgeElement
                .find("a.badge-image img")
                .attr("src");

            const earnedText = badgeElement
                .find("span.ql-body-medium.l-mbs")
                .text()
                .trim();

            const match = badgeUrl?.match(/\/badges\/([^/?#]+)/);

            if (!match || !name) {
                return null;
            }

            const dateText = earnedText
                .replace(/^Earned\s+/i, "")
                .replace(/\s+[A-Z]{2,5}$/, "")
                .trim();

            const parsedDate = dateText
                ? new Date(dateText)
                : null;

            return {
                externalId: match[1],
                name,
                badgeUrl,
                imageUrl: imageUrl || null,
                earnedAt:
                    parsedDate &&
                    !Number.isNaN(parsedDate.getTime())
                        ? parsedDate
                        : null
            };
        })
        .get()
        .filter(Boolean);
}

async function syncUserBadges(user, badges) {
    if (badges.length === 0) {
        await UserBadge.deleteMany({ user: user._id });
        user.badgeCount = 0;
        await user.save();
        return;
    }

    for (const scrapedBadge of badges) {
        // 1. Find the badge globally.
        let badge = await Badge.findOne({
            $or: [
                { externalId: scrapedBadge.externalId },
                { badgeUrl: scrapedBadge.badgeUrl },
                { name: scrapedBadge.name },
                ...(scrapedBadge.imageUrl
                    ? [{ imageUrl: scrapedBadge.imageUrl }]
                    : [])
            ]
        });

        // 2. Create the badge if it does not exist.
        if (!badge) {
            try {
                badge = await Badge.create({
                    externalId: scrapedBadge.externalId,
                    name: scrapedBadge.name,
                    badgeUrl: scrapedBadge.badgeUrl,
                    imageUrl: scrapedBadge.imageUrl
                });

                console.log(`Created badge: ${badge.name}`);
            } catch (error) {
                // Another request may have created this badge concurrently.
                if (error.code !== 11000) {
                    throw error;
                }

                badge = await Badge.findOne({
                    $or: [
                        { externalId: scrapedBadge.externalId },
                        { badgeUrl: scrapedBadge.badgeUrl },
                        { name: scrapedBadge.name },
                        ...(scrapedBadge.imageUrl
                            ? [{ imageUrl: scrapedBadge.imageUrl }]
                            : [])
                    ]
                });

                if (!badge) {
                    throw error;
                }
            }
        }

        // Complete records created before badgeUrl/externalId were stored.
        if (
            !badge.externalId ||
            !badge.badgeUrl ||
            (!badge.imageUrl && scrapedBadge.imageUrl)
        ) {
            badge.externalId = scrapedBadge.externalId;
            badge.badgeUrl = scrapedBadge.badgeUrl;
            if (!badge.imageUrl && scrapedBadge.imageUrl) {
                badge.imageUrl = scrapedBadge.imageUrl;
            }
            await badge.save();
        }

        // 3. Use the actual UserBadge schema field names: user and badge.
        const existingMapping = await UserBadge.findOne({
            user: user._id,
            badge: badge._id
        });

        if (existingMapping) {
            // This user already has this badge mapped.
            continue;
        }

        // 4. Create the missing user-to-badge relationship.
        try {
            await UserBadge.create({
                user: user._id,
                badge: badge._id,
                earnedAt: scrapedBadge.earnedAt || new Date()
            });

            console.log(
                `Mapped badge "${badge.name}" to ${user.username}`
            );
        } catch (error) {
            // Ignore duplicate-key errors, but propagate other failures.
            if (error.code !== 11000) {
                throw error;
            }
        }
    }

    // 5. Count persisted relationships, not scraped HTML elements.
    user.badgeCount = await UserBadge.countDocuments({
        user: user._id
    });

    await user.save();
}

async function scrape() {
    const users = await User.find({});

    let skipped = 0;
    let scraped = 0;
    let failed = 0;

    console.log(`Number of users: ${users.length}`);

    for (const user of users) {
        if (!user.skillsUrl) {
            console.log(
                `Skipping ${user.username}: missing profile URL`
            );
            skipped++;
            continue;
        }

        try {
            const badges = await scrapeProfile(user.skillsUrl);

            await syncUserBadges(user, badges);

            console.log(
                `${user.username}: ${badges.length} badges extracted, ` +
                `${user.badgeCount} mapped badges in database`
            );

            scraped++;
        } catch (error) {
            console.error(
                `Failed to scrape ${user.username}:`,
                error.response?.status ?? error.message
            );

            failed++;
        }

        // Space out requests to avoid sending a rapid burst.
        await sleep(2000);
    }

    console.log("\nScraping summary");
    console.log("Successfully scraped:", scraped);
    console.log("Skipped:", skipped);
    console.log("Failed:", failed);
}

if (require.main === module) {
    scrape().catch(console.error);
}

module.exports = {
    scrapeProfile,
    syncUserBadges,
    scrape
};
