const assert = require("node:assert/strict");
const test = require("node:test");

const { RateLimitExceededError, createRateLimiter } = require("../src/http/rateLimiter");

test("limits requests per IP", () => {
  const limiter = createRateLimiter({
    enabled: true,
    windowMs: 60000,
    maxRequestsPerIp: 2,
    maxRequestsPerDomain: 99,
  });

  limiter.check({ ip: "127.0.0.1", domain: "example.com" });
  limiter.check({ ip: "127.0.0.1", domain: "example.com" });
  assert.throws(() => {
    limiter.check({ ip: "127.0.0.1", domain: "example.com" });
  }, RateLimitExceededError);
});

test("limits requests per target domain", () => {
  const limiter = createRateLimiter({
    enabled: true,
    windowMs: 60000,
    maxRequestsPerIp: 99,
    maxRequestsPerDomain: 1,
  });

  limiter.check({ ip: "127.0.0.1", domain: "example.com" });
  assert.throws(() => {
    limiter.check({ ip: "127.0.0.2", domain: "example.com" });
  }, RateLimitExceededError);
});

test("does nothing when disabled", () => {
  const limiter = createRateLimiter({
    enabled: false,
    windowMs: 60000,
    maxRequestsPerIp: 1,
    maxRequestsPerDomain: 1,
  });

  limiter.check({ ip: "127.0.0.1", domain: "example.com" });
  limiter.check({ ip: "127.0.0.1", domain: "example.com" });
});
