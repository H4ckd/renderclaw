// Read-only inspection endpoints for local operators and future dashboards.
// These routes are intentionally small wrappers around the storage component.
// Production deployments should protect /admin/* at the reverse proxy or add
// authentication middleware before registering these routes.
const { getCrawlerProfileById } = require("./crawlerProfiles");
const { normalizeDomain } = require("../seo/siteDiscovery");

function registerAdminRoutes(
  app,
  pageStore,
  adminAuth,
  siteDiscovery,
  crawlConfig = {},
  crawlRunner = null,
  redirectAnalyzer = null,
  cacheMaintenance = null
) {
  app.get("/admin/sites", adminAuth, (req, res) => {
    res.json({ sites: pageStore.listSites() });
  });

  app.delete("/admin/cache", adminAuth, (req, res) => {
    if (!cacheMaintenance) {
      res.status(503).json({ error: "Cache maintenance is not available" });
      return;
    }

    try {
      const result = cacheMaintenance.purge({
        domain: req.query.domain ? normalizeDomain(req.query.domain) : "",
        url: req.query.url || "",
        crawlerProfile: req.query.crawler || "",
      });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: "Cache purge failed", message: error.message });
    }
  });

  app.post("/admin/cache/refresh", adminAuth, async (req, res) => {
    if (!crawlRunner) {
      res.status(503).json({ error: "Crawl renderer is not available" });
      return;
    }

    if (!req.query.url) {
      res.status(400).json({ error: "Missing url query parameter" });
      return;
    }

    let targetUrl;
    try {
      targetUrl = new URL(req.query.url);
    } catch (error) {
      res.status(400).json({ error: "Invalid url query parameter", message: error.message });
      return;
    }

    const crawlerProfile = getCrawlerProfileById(req.query.crawler || "google");

    try {
      const pageRecord = pageStore.ensurePageRecord(targetUrl);
      pageStore.updateSiteUrlStatus(targetUrl.hostname, targetUrl.href, "rendering");
      const page = await crawlRunner.render(targetUrl, pageRecord, crawlerProfile, req.requestId);
      pageStore.updateSiteUrlStatus(targetUrl.hostname, targetUrl.href, "rendered");

      res.json({
        url: targetUrl.href,
        crawlerProfile: crawlerProfile.id,
        status: "refreshed",
        page,
      });
    } catch (error) {
      pageStore.updateSiteUrlStatus(targetUrl.hostname, targetUrl.href, "error");
      res.status(502).json({ error: "Cache refresh failed", message: error.message });
    }
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

  app.get("/admin/sites/:domain/links", adminAuth, (req, res) => {
    const domain = normalizeDomain(req.params.domain);
    res.json(pageStore.getInternalLinkGraph(domain, {
      limit: req.query.limit,
      url: req.query.url,
    }));
  });

  app.get("/admin/sites/:domain/report", adminAuth, (req, res) => {
    const domain = normalizeDomain(req.params.domain);
    res.json(pageStore.getSiteReport(domain));
  });

  app.get("/admin/sites/:domain/redirects", adminAuth, (req, res) => {
    const domain = normalizeDomain(req.params.domain);
    res.json({ redirects: pageStore.listRedirectChecks(domain, req.query.limit) });
  });

  app.post("/admin/sites/:domain/redirects/analyze", adminAuth, async (req, res) => {
    if (!redirectAnalyzer) {
      res.status(503).json({ error: "Redirect analyzer is not available" });
      return;
    }

    const domain = normalizeDomain(req.params.domain);
    const requestedLimit = positiveNumber(req.query.limit, crawlConfig.maxRedirectBatch || 25);
    const limit = Math.min(requestedLimit, crawlConfig.maxRedirectBatch || 25);
    const urls = pageStore.listSiteUrls(domain, limit);
    const results = [];

    for (const entry of urls) {
      const check = await redirectAnalyzer.analyze(entry.url);
      pageStore.saveRedirectCheck(domain, check);
      results.push(check);
    }

    res.json({
      domain,
      requestedLimit,
      limit,
      checkedCount: results.length,
      results,
    });
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
    res.json({
      pages: pageStore.listPages().map((page) => ({
        ...page,
        cacheVariants: cacheMaintenance?.inspectPage ? cacheMaintenance.inspectPage(page.id) : [],
      })),
    });
  });

  app.get("/admin/pages/:id/cache", adminAuth, (req, res) => {
    if (!cacheMaintenance?.inspectPage) {
      res.status(503).json({ error: "Cache inspection is not available" });
      return;
    }

    res.json({
      pageId: Number(req.params.id),
      cacheVariants: cacheMaintenance.inspectPage(Number(req.params.id)),
    });
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
