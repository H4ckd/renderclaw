// Lightweight health endpoint for uptime checks and orchestration probes.
// Keep this fast and dependency-light: it should not trigger renders, AI calls,
// or database scans.
function registerHealthRoutes(app, { healthChecks, metrics, queue }) {
  app.get("/health", (req, res) => {
    const health = healthChecks.snapshot();
    res.json({
      ok: health.ok,
      uptimeMs: metrics.snapshot().uptimeMs,
      ...queue.stats(),
      checks: health.checks,
    });
  });
}

module.exports = { registerHealthRoutes };
