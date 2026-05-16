class RateLimitExceededError extends Error {
  constructor(scope, retryAfterSeconds) {
    super(`Rate limit exceeded for ${scope}`);
    this.name = "RateLimitExceededError";
    this.statusCode = 429;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// Tiny in-memory fixed-window rate limiter.
// It is process-local by design. Replace this module with a Redis-backed
// limiter if RenderClaw runs across multiple API nodes.
function createRateLimiter(config) {
  const buckets = new Map();

  function check({ ip, domain }) {
    if (!config.enabled) return;

    consume(`ip:${ip || "unknown"}`, config.maxRequestsPerIp);
    consume(`domain:${domain}`, config.maxRequestsPerDomain);
  }

  function consume(key, maxRequests) {
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + config.windowMs });
      return;
    }

    bucket.count++;
    if (bucket.count > maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      throw new RateLimitExceededError(key, retryAfterSeconds);
    }
  }

  return { check };
}

function getClientIp(req) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwardedFor || req.ip || req.socket?.remoteAddress || "unknown";
}

module.exports = {
  RateLimitExceededError,
  createRateLimiter,
  getClientIp,
};
