function registerAdminRoutes(app, pageStore) {
  app.get("/admin/sites", (req, res) => {
    res.json({ sites: pageStore.listSites() });
  });

  app.get("/admin/pages", (req, res) => {
    res.json({ pages: pageStore.listPages() });
  });
}

module.exports = { registerAdminRoutes };
