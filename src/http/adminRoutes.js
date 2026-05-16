// Read-only inspection endpoints for local operators and future dashboards.
// These routes are intentionally small wrappers around the storage component.
// Production deployments should protect /admin/* at the reverse proxy or add
// authentication middleware before registering these routes.
function registerAdminRoutes(app, pageStore) {
  app.get("/admin/sites", (req, res) => {
    res.json({ sites: pageStore.listSites() });
  });

  app.get("/admin/pages", (req, res) => {
    res.json({ pages: pageStore.listPages() });
  });
}

module.exports = { registerAdminRoutes };
