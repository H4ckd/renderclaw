// Lightweight health endpoint for uptime checks and orchestration probes.
// Keep this fast and dependency-light: it should not trigger renders, AI calls,
// or database scans.
function registerHealthRoutes(app, { browserManager, queue }) {
  app.get("/health", (req, res) => {
    res.json({
      ok: true,
      ...queue.stats(),
      browserConnected: browserManager.isConnected(),
    });
  });
}

module.exports = { registerHealthRoutes };
