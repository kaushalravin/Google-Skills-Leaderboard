
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const path = require("path");

require("dotenv").config({
  path: path.join(__dirname, "..", ".env")
});

const { User } = require("../models/users");

const EXCEL_PATH = path.join(
  __dirname,
  "..",
  "data",
  "participants.xlsx"
);

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function getValue(row, header) {
  return String(row[header] ?? "").trim();
}

function normalizeProfileUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());

    if (
      url.protocol !== "https:" ||
      !["skills.google", "www.skills.google"].includes(
        url.hostname
      ) ||
      !/^\/public_profiles\/[A-Za-z0-9-]+\/?$/.test(
        url.pathname
      )
    ) {
      return null;
    }

    return `https://www.skills.google${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

async function seedUsers() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing from server/.env");
  }

  const workbook = XLSX.readFile(EXCEL_PATH);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  if (!sheet) {
    throw new Error("No worksheet found in the Excel file");
  }

  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: ""
  });

  if (rows.length === 0) {
    throw new Error("The Excel worksheet contains no records");
  }

  const headers = Object.keys(rows[0]);

  const findHeader = (text) =>
    headers.find((header) => header.includes(text));

  const nameHeader = findHeader("Your Full Name");
  const emailHeader = findHeader("Email address");

  const skillsEmailHeader = findHeader(
    "Confirm your email address linked to your Google Skills Profile"
  );

  const profileUrlHeader = findHeader(
    "Google Skills Public Profile URL"
  );

  if (
    !nameHeader ||
    !emailHeader ||
    !skillsEmailHeader ||
    !profileUrlHeader
  ) {
    throw new Error(
      "Could not identify all required Excel columns. Check the header names."
    );
  }

  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 10000
  });

  await User.deleteMany({});
  console.log("Existing users deleted");

  console.log("Connected to MongoDB:", mongoose.connection.name);

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let failed = 0;

  const seenProfiles = new Set();

  try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const username = getValue(row, nameHeader);
      const email = normalizeEmail(getValue(row, emailHeader));
      const skillsEmail = normalizeEmail(
        getValue(row, skillsEmailHeader)
      );

      const skillsUrl = normalizeProfileUrl(
        getValue(row, profileUrlHeader)
      );

      if (!username || !email || !skillsEmail || !skillsUrl) {
        const reasons = [];

        if (!username) reasons.push("missing name");
        if (!email) reasons.push("missing email");
        if (!skillsEmail) reasons.push("missing Google Skills email");
        if (!skillsUrl) reasons.push("invalid profile URL");

        console.warn(
          `Row ${i + 2}: ${reasons.join(", ")}; skipped`
        );
        skipped++;
        continue;
      }

      if (seenProfiles.has(skillsUrl)) {
        console.warn(
          `Row ${i + 2}: duplicate profile URL in Excel; skipped`
        );
        skipped++;
        continue;
      }

      seenProfiles.add(skillsUrl);

      try {
        // Match by profile URL. Do not reset badgeCount on existing users.
        const result = await User.updateOne(
          { skillsUrl },
          {
            $set: {
              username,
              email,
              skillsEmail,
              skillsUrl
            },
            $setOnInsert: {
              badgeCount: 0
            }
          },
          {
            upsert: true,
            runValidators: true
          }
        );

        if (result.upsertedCount > 0) {
          inserted++;
        } else if (result.modifiedCount > 0) {
          updated++;
        } else {
          unchanged++;
        }
      } catch (error) {
        console.error(`Row ${i + 2}: database write failed`);
        console.error("Error:", error.message);
        failed++;
      }
    }

    console.log("\nSeed completed");
    console.log({
      totalRows: rows.length,
      inserted,
      updated,
      unchanged,
      skipped,
      failed
    });
  } finally {
    await mongoose.disconnect();
    console.log("MongoDB disconnected");
  }
}

seedUsers().catch((error) => {
  console.error("Seeding failed:", error.message);
  mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
