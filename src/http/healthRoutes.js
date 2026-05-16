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
