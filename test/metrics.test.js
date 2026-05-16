const assert = require("node:assert/strict");
const test = require("node:test");

const { createMetrics } = require("../src/observability/metrics");

test("records counters and render timings", () => {
  const metrics = createMetrics();

  metrics.increment("cacheHits");
  metrics.increment("cacheHits");
  metrics.increment("renderSuccesses");
  metrics.recordRenderTime(100);
  metrics.recordRenderTime(300);

  const snapshot = metrics.snapshot();
  assert.equal(snapshot.counters.cacheHits, 2);
  assert.equal(snapshot.counters.renderSuccesses, 1);
  assert.equal(snapshot.timings.renderCount, 2);
  assert.equal(snapshot.timings.averageRenderMs, 200);
  assert.equal(typeof snapshot.uptimeMs, "number");
});
