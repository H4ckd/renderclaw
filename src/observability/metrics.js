// In-memory metrics collector.
// This intentionally avoids external dependencies. It is process-local and
// resets on restart, which is enough for the current alpha. Replace or wrap
// this module later if RenderClaw gains Prometheus or OpenTelemetry support.
function createMetrics() {
  const startedAt = new Date();
  const counters = {
    requestsTotal: 0,
    humanRedirects: 0,
    ignoredAssetRedirects: 0,
    crawlerRequests: 0,
    cacheHits: 0,
    cacheStaleHits: 0,
    cacheMisses: 0,
    backgroundRefreshes: 0,
    backgroundRefreshErrors: 0,
    renderSuccesses: 0,
    renderErrors: 0,
    rateLimitRejections: 0,
    queueFullRejections: 0,
    aiSuccesses: 0,
    aiFallbacks: 0,
  };
  const timings = {
    renderCount: 0,
    renderTotalMs: 0,
  };

  function increment(name, amount = 1) {
    if (!(name in counters)) counters[name] = 0;
    counters[name] += amount;
  }

  function recordRenderTime(ms) {
    timings.renderCount += 1;
    timings.renderTotalMs += ms;
  }

  function snapshot(extra = {}) {
    const uptimeMs = Date.now() - startedAt.getTime();
    return {
      startedAt: startedAt.toISOString(),
      uptimeMs,
      counters: { ...counters },
      timings: {
        ...timings,
        averageRenderMs: timings.renderCount ? Math.round(timings.renderTotalMs / timings.renderCount) : 0,
      },
      ...extra,
    };
  }

  return {
    increment,
    recordRenderTime,
    snapshot,
  };
}

module.exports = { createMetrics };
