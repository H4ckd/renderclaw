const assert = require("node:assert/strict");
const test = require("node:test");

const { createRedirectAnalyzer, isRedirectStatus } = require("../src/seo/redirectAnalyzer");

test("detects redirect chains with final status", async () => {
  const responses = new Map([
    ["https://example.com/a", { status: 301, location: "https://example.com/b" }],
    ["https://example.com/b", { status: 302, location: "/c" }],
    ["https://example.com/c", { status: 200, location: "" }],
  ]);
  const analyzer = createRedirectAnalyzer({
    fetchImpl: async (url) => {
      const response = responses.get(url);
      return {
        status: response.status,
        headers: { get: (name) => (name === "location" ? response.location : "") },
      };
    },
    maxHops: 5,
  });

  const result = await analyzer.analyze("https://example.com/a");

  assert.equal(result.hopCount, 2);
  assert.equal(result.finalUrl, "https://example.com/c");
  assert.equal(result.finalStatus, 200);
  assert.equal(result.error, "");
});

test("marks redirect chains that exceed the hop limit", async () => {
  const analyzer = createRedirectAnalyzer({
    fetchImpl: async (url) => ({
      status: 302,
      headers: { get: () => `${url}/next` },
    }),
    maxHops: 1,
  });

  const result = await analyzer.analyze("https://example.com/a");

  assert.equal(result.error, "redirect_chain_too_long");
  assert.equal(result.hopCount, 2);
});

test("classifies redirect status codes", () => {
  assert.equal(isRedirectStatus(301), true);
  assert.equal(isRedirectStatus(308), true);
  assert.equal(isRedirectStatus(200), false);
});
