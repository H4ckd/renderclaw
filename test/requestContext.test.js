const assert = require("node:assert/strict");
const test = require("node:test");

const { requestContext } = require("../src/http/requestContext");

test("preserves incoming request id", () => {
  const req = { headers: { "x-request-id": "external-id" } };
  const headers = {};
  const res = { setHeader: (name, value) => { headers[name] = value; } };

  requestContext(req, res, () => {});

  assert.equal(req.requestId, "external-id");
  assert.equal(headers["X-Request-Id"], "external-id");
});

test("creates request id when missing", () => {
  const req = { headers: {} };
  const headers = {};
  const res = { setHeader: (name, value) => { headers[name] = value; } };

  requestContext(req, res, () => {});

  assert.match(req.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(headers["X-Request-Id"], req.requestId);
});
