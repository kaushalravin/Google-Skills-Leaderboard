const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const mongoose = require("mongoose");
const request = require("supertest");

const { buildTestApp } = require("../helpers/app");
const { startMongo } = require("../helpers/mongo");
const { notFound, errorHandler } = require("../../middleware/errors");
const { requestId } = require("../../middleware/requestId");
const { AppError } = require("../../middleware/errors");

let mongo;
let app;

before(async () => {
    mongo = await startMongo();
    ({ app } = buildTestApp());
});

after(async () => {
    await mongo?.stop();
});

function assertErrorShape(res, status, code) {
    assert.equal(res.status, status);
    assert.match(res.headers["content-type"], /application\/json/);
    assert.equal(res.body.error.code, code);
    assert.equal(typeof res.body.error.message, "string");
    assert.equal(res.body.error.requestId, res.headers["x-request-id"]);
    assert.equal(res.body.error.stack, undefined);
}

test("app boots against the in-memory replica set", async () => {
    assert.equal(mongoose.connection.readyState, 1);
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    assert.ok(hello.setName, "expected a replica set");
});

test("unknown route returns the 404 error shape", async () => {
    const res = await request(app).get("/api/does-not-exist");
    assertErrorShape(res, 404, "NOT_FOUND");
    assert.equal(res.body.error.message, "Route GET /api/does-not-exist not found");
});

test("GET / is not served; only /api routes exist", async () => {
    const res = await request(app).get("/");
    assertErrorShape(res, 404, "NOT_FOUND");
});

test("a well-formed incoming x-request-id is echoed; a malformed one is replaced", async () => {
    const ok = await request(app).get("/nope").set("x-request-id", "abc-123");
    assert.equal(ok.headers["x-request-id"], "abc-123");
    assert.equal(ok.body.error.requestId, "abc-123");

    const bad = await request(app).get("/nope").set("x-request-id", "bad id with spaces");
    assert.notEqual(bad.headers["x-request-id"], "bad id with spaces");
    assert.match(bad.headers["x-request-id"], /^[0-9a-f-]{36}$/);
});

test("malformed JSON returns 400 INVALID_JSON", async () => {
    const res = await request(app)
        .post("/api/anything")
        .set("content-type", "application/json")
        .send("{not json");
    assertErrorShape(res, 400, "INVALID_JSON");
});

test("oversized JSON returns 413 PAYLOAD_TOO_LARGE", async () => {
    const res = await request(app)
        .post("/api/anything")
        .set("content-type", "application/json")
        .send(JSON.stringify({ blob: "x".repeat(200 * 1024) }));
    assertErrorShape(res, 413, "PAYLOAD_TOO_LARGE");
});

test("error handler: AppError keeps code/details; unknown errors become an opaque 500", async () => {
    const mini = express();
    mini.use(requestId);
    mini.get("/app-error", () => {
        throw new AppError(422, "SOMETHING_WRONG", "nope", { field: "x" });
    });
    mini.get("/boom", () => {
        throw new Error("database password is hunter2");
    });
    mini.use(notFound);
    mini.use(errorHandler());

    const appErr = await request(mini).get("/app-error");
    assertErrorShape(appErr, 422, "SOMETHING_WRONG");
    assert.deepEqual(appErr.body.error.details, { field: "x" });

    const boom = await request(mini).get("/boom");
    assertErrorShape(boom, 500, "INTERNAL_ERROR");
    assert.equal(boom.body.error.message, "Internal server error");
    assert.doesNotMatch(JSON.stringify(boom.body), /hunter2/);
});

test("x-powered-by is disabled", async () => {
    const res = await request(app).get("/nope");
    assert.equal(res.headers["x-powered-by"], undefined);
});
