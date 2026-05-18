const assert = require("node:assert/strict");
const test = require("node:test");

const crypto = require("node:crypto");

const { createSourceProbe, didSourceChange, shouldHashCompare } = require("../src/seo/sourceProbe");

test("detects unchanged sources from conditional HEAD responses", async () => {
  const probe = createSourceProbe({
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers["If-None-Match"], '"abc"');
      return response(304, {});
    },
  });

  const result = await probe.probe(new URL("https://example.com/page"), { etag: '"abc"' });

  assert.equal(result.changed, false);
  assert.equal(result.status, 304);
});

test("detects changed sources from different validators", async () => {
  const probe = createSourceProbe({
    fetchImpl: async () => response(200, { etag: '"new"', "last-modified": "Sat, 16 May 2026 10:00:00 GMT" }),
  });

  const result = await probe.probe(new URL("https://example.com/page"), { etag: '"old"' });

  assert.equal(result.changed, true);
  assert.equal(result.etag, '"new"');
});

test("uses bounded source hashes when validators are unavailable", async () => {
  const hash = crypto.createHash("sha256").update("same content").digest("hex");
  const calls = [];
  const probe = createSourceProbe({
    fetchImpl: async (_url, options) => {
      calls.push(options.method);
      if (options.method === "HEAD") return response(200, {});
      return response(200, {}, "same content");
    },
  });

  const result = await probe.probe(new URL("https://example.com/page"), { hash });

  assert.deepEqual(calls, ["HEAD", "GET"]);
  assert.equal(result.changed, false);
  assert.equal(result.hash, hash);
});

test("detects changed source hashes when validators are unavailable", async () => {
  const oldHash = crypto.createHash("sha256").update("old content").digest("hex");
  const probe = createSourceProbe({
    fetchImpl: async (_url, options) => (
      options.method === "HEAD" ? response(200, {}) : response(200, {}, "new content")
    ),
  });

  const result = await probe.probe(new URL("https://example.com/page"), { hash: oldHash });

  assert.equal(result.changed, true);
  assert.notEqual(result.hash, oldHash);
});

test("classifies source validator comparisons", () => {
  assert.equal(didSourceChange(304, {}, { etag: '"a"' }), false);
  assert.equal(didSourceChange(200, { etag: '"a"' }, { etag: '"a"' }), false);
  assert.equal(didSourceChange(200, { etag: '"b"' }, { etag: '"a"' }), true);
  assert.equal(didSourceChange(500, { etag: '"a"' }, { etag: '"a"' }), true);
});

test("classifies source hash fallback comparisons", () => {
  assert.equal(shouldHashCompare(200, {}, { hash: "abc" }), true);
  assert.equal(shouldHashCompare(200, { etag: '"a"' }, { etag: '"a"', hash: "abc" }), false);
  assert.equal(shouldHashCompare(304, {}, { hash: "abc" }), false);
});

function response(status, headers, body = "") {
  return {
    async arrayBuffer() {
      return Buffer.from(body, "utf8");
    },
    body: null,
    status,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] || "";
      },
    },
  };
}
