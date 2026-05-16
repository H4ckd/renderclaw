const assert = require("node:assert/strict");
const test = require("node:test");

const { createSourceProbe, didSourceChange } = require("../src/seo/sourceProbe");

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

test("classifies source validator comparisons", () => {
  assert.equal(didSourceChange(304, {}, { etag: '"a"' }), false);
  assert.equal(didSourceChange(200, { etag: '"a"' }, { etag: '"a"' }), false);
  assert.equal(didSourceChange(200, { etag: '"b"' }, { etag: '"a"' }), true);
  assert.equal(didSourceChange(500, { etag: '"a"' }, { etag: '"a"' }), true);
});

function response(status, headers) {
  return {
    status,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] || "";
      },
    },
  };
}
