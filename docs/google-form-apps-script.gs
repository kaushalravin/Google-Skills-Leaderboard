/**
 * Google Form -> leaderboard participant ingestion (POST /api/admin/participants).
 *
 * Setup (in the Apps Script project bound to the form's response spreadsheet):
 *   1. Extensions > Apps Script, paste this file.
 *   2. Project Settings > Script Properties:
 *        INGEST_URL     = https://<host>/api/admin/participants
 *        ADMIN_API_KEY  = the server's ADMIN_API_KEY
 *   3. Triggers > Add Trigger: function onFormSubmit, event source "From spreadsheet",
 *      event type "On form submit". Authorize when asked.
 *   4. Optional backfill of existing responses: run syncAllRows() once from the editor.
 *      Re-running is safe: the endpoint upserts by profile URL.
 *
 * The key and participants' emails are never logged.
 */

var HEADER_MAP = {
  "Your Full Name": "username",
  "Email address": "email",
  "Confirm your email address linked to your Google Skills Profile": "skillsEmail",
  "Google Skills Public Profile URL": "profileUrl"
};
var BATCH_SIZE = 500;
var MAX_ATTEMPTS = 5;

function onFormSubmit(e) {
  var row = mapRow_(e.namedValues);
  var result = postWithRetry_(row);
  console.log("ingest: received=%s inserted=%s updated=%s rejected=%s",
    result.received, result.inserted, result.updated, JSON.stringify(result.rejected || []));
}

function syncAllRows() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = values.slice(1).map(function (cells) {
    var named = {};
    headers.forEach(function (h, i) { named[h] = [cells[i]]; });
    return mapRow_(named);
  });
  for (var start = 0; start < rows.length; start += BATCH_SIZE) {
    var result = postWithRetry_({ participants: rows.slice(start, start + BATCH_SIZE) });
    // Rejected indexes are relative to this batch; sheet row = start + index + 2.
    console.log("batch from sheet row %s: inserted=%s updated=%s duplicates=%s rejected=%s",
      start + 2, result.inserted, result.updated, result.duplicatesInBatch,
      JSON.stringify(result.rejected || []));
  }
}

/** namedValues ({ header: [value] }) -> { username, email, skillsEmail, profileUrl }. */
function mapRow_(namedValues) {
  var row = {};
  Object.keys(HEADER_MAP).forEach(function (header) {
    var value = namedValues[header];
    row[HEADER_MAP[header]] = String((value && value[0]) || "").trim();
  });
  return row;
}

/** Retries network errors, 429 and 5xx with exponential backoff and jitter. */
function postWithRetry_(payload) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("INGEST_URL");
  var key = props.getProperty("ADMIN_API_KEY");
  if (!url || !key) throw new Error("Set INGEST_URL and ADMIN_API_KEY in Script Properties");

  for (var attempt = 1; ; attempt++) {
    var status = 0;
    var body = null;
    try {
      var response = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        headers: { "x-admin-key": key },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
        followRedirects: false
      });
      status = response.getResponseCode();
      body = response.getContentText();
    } catch (err) {
      status = 0; // network error / timeout
    }

    if (status === 200) return JSON.parse(body);
    if (status === 422) return JSON.parse(body).error.details; // every row rejected: not retryable
    var retryable = status === 0 || status === 429 || status >= 500;
    if (!retryable || attempt >= MAX_ATTEMPTS) {
      throw new Error("ingest failed: HTTP " + status + " after " + attempt + " attempt(s)");
    }
    Utilities.sleep(Math.min(60000, 1000 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 1000));
  }
}
