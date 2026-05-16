// Read-only inspection endpoints for local operators and future dashboards.
// These routes are intentionally small wrappers around the storage component.
// Production deployments should protect /admin/* at the reverse proxy or add
// authentication middleware before registering these routes.
const { getCrawlerProfileById } = require("./crawlerProfiles");
const { normalizeDomain } = require("../seo/siteDiscovery");

function registerAdminRoutes(app, pageStore, adminAuth, siteDiscovery, crawlConfig = {}, crawlRunner = null) {
  app.get("/admin/sites", adminAuth, (req, res) => {
    res.json({ sites: pageStore.listSites() });
  });

  app.get("/admin/sites/:domain/discovery", adminAuth, (req, res) => {
    const domain = normalizeDomain(req.params.domain);
    const discovery = pageStore.getSiteDiscovery(domain);
    if (!discovery) {
      res.status(404).json({ error: "Site discovery not found" });
      return;
    }

    res.json(discovery);
  });

  app.get("/admin/sites/:domain/urls", adminAuth, (req, res) => {
    const domain = normalizeDomain(req.params.domain);
    res.json({ urls: pageStore.listSiteUrls(domain, req.query.limit) });
  });

  app.get("/admin/sites/:domain/report", adminAuth, (req, res) => {
    const domain = normalizeDomain(req.params.domain);
    res.json(pageStore.getSiteReport(domain));
  });

  app.post("/admin/sites/:domain/crawl/queue", adminAuth, (req, res) => {
    const domain = normalizeDomain(req.params.domain);
    const requestedLimit = positiveNumber(req.query.limit, crawlConfig.maxQueueBatch || 50);
    const limit = Math.min(requestedLimit, crawlConfig.maxQueueBatch || 50);
    const queued = pageStore.queueDiscoveredSiteUrls(domain, limit);

    res.json({
      domain,
      requestedLimit,
      limit,
      queuedCount: queued.length,
      queued,
    });
  });

  app.post("/admin/sites/:domain/crawl/render", adminAuth, async (req, res) => {
    if (!crawlRunner) {
      res.status(503).json({ error: "Crawl renderer is not available" });
      return;
    }

    const domain = normalizeDomain(req.params.domain);
    const requestedLimit = positiveNumber(req.query.limit, crawlConfig.maxRenderBatch || 5);
    const limit = Math.min(requestedLimit, crawlConfig.maxRenderBatch || 5);
    const crawlerProfile = getCrawlerProfileById(req.query.crawler || "google");
    const queued = pageStore.listQueuedSiteUrls(domain, limit);
    const results = [];

    for (const entry of queued) {
      try {
        pageStore.updateSiteUrlStatus(domain, entry.url, "rendering");
        const targetUrl = new URL(entry.url);
        const pageRecord = pageStore.ensurePageRecord(targetUrl);
        await crawlRunner.render(targetUrl, pageRecord, crawlerProfile, req.requestId);
        pageStore.updateSiteUrlStatus(domain, entry.url, "rendered");
        results.push({ url: entry.url, status: "rendered" });
      } catch (error) {
        pageStore.updateSiteUrlStatus(domain, entry.url, "error");
        results.push({ url: entry.url, status: "error", error: error.message });
      }
    }

    res.json({
      domain,
      crawlerProfile: crawlerProfile.id,
      requestedLimit,
      limit,
      processedCount: results.length,
      results,
    });
  });

  app.post("/admin/sites/:domain/discovery", adminAuth, async (req, res) => {
    try {
      const report = await siteDiscovery.discover(req.params.domain);
      res.json(pageStore.saveSiteDiscovery(report.domain, report));
    } catch (error) {
      res.status(400).json({ error: "Site discovery failed", message: error.message });
    }
  });

  app.get("/admin/pages", adminAuth, (req, res) => {
    res.json({ pages: pageStore.listPages() });
  });

  app.get("/admin/pages/:id/report", adminAuth, (req, res) => {
    const report = pageStore.getSeoReport(Number(req.params.id));
    if (!report) {
      res.status(404).json({ error: "SEO report not found" });
      return;
    }

    res.json(report);
  });
}

function positiveNumber(value, fallback) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

module.exports = { registerAdminRoutes };
