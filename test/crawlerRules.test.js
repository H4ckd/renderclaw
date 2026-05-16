const assert = require("node:assert/strict");
const test = require("node:test");

const { isCrawler, shouldIgnoreRequest, validateDomain } = require("../src/http/crawlerRules");

test("detects known crawler user agents", () => {
  const req = { headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" } };
  assert.equal(isCrawler(req), true);
});

test("does not classify regular browsers as crawlers", () => {
  const req = { headers: { "user-agent": "Mozilla/5.0 Chrome Safari" } };
  assert.equal(isCrawler(req), false);
});

test("ignores static asset requests", () => {
  assert.equal(shouldIgnoreRequest("https://example.com/app.js"), true);
  assert.equal(shouldIgnoreRequest("https://example.com/products/item"), false);
});

test("validates allowed domains", () => {
  assert.equal(validateDomain("Example.COM", ["example.com"]), "example.com");
  assert.throws(() => validateDomain("example.com", ["other.com"]), /Dominio non autorizzato/);
  assert.throws(() => validateDomain("localhost", []), /Dominio non valido/);
});
