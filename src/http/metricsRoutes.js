// Operational metrics endpoint.
// It is protected with the same adminAuth middleware as /admin/* because it can
// reveal traffic volume, domains, and queue behavior.
function registerMetricsRoutes(app, { adminAuth, browserManager, metrics, queue }) {
  app.get("/metrics", adminAuth, (req, res) => {
    res.json(metrics.snapshot({
      queue: queue.stats(),
      browserConnected: browserManager.isConnected(),
    }));
  });
}

module.exports = { registerMetricsRoutes };
