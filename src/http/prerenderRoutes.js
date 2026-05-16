const { buildTargetUrl, isCrawler, shouldIgnoreRequest } = require("./crawlerRules");
const { detectCrawlerProfile } = require("./crawlerProfiles");
const { setSeoHeaders } = require("./seoHeaders");

// Main RenderClaw gateway route.
// It handles four decisions:
// 1. validate and normalize the target URL;
// 2. redirect humans to the source site;
// 3. serve fresh/stale crawler cache when available;
// 4. enqueue a render when the cache is missing or expired.
function registerPrerenderRoutes(app, deps) {
  const {
    allowedDomains,
    htmlCache,
    logger,
    pageStore,
    queue,
    renderer,
  } = deps;

  const refreshesInFlight = new Set();

  // Stale cache should be fast: respond immediately, then refresh in the
  // background. The key includes crawlerProfile.id so social and Google
  // variants never collapse into one refresh job.
  function refreshInBackground(targetUrl, pageRecord, crawlerProfile) {
    const refreshKey = `${crawlerProfile.id}:${targetUrl.href}`;
    if (refreshesInFlight.has(refreshKey)) return;

    refreshesInFlight.add(refreshKey);
    queue.enqueue(() => renderer.renderPage(targetUrl, pageRecord, crawlerProfile))
      .catch((error) => logger.log("warn", "Background refresh failed", {
        url: targetUrl.href,
        error: error.message,
      }))
      .finally(() => refreshesInFlight.delete(refreshKey));
  }

  // Keep this route last in server.js. It is intentionally broad and treats
  // the first path segment as the target domain.
  app.get("/:domain/*?", async (req, res) => {
    let targetUrl;

    try {
      targetUrl = buildTargetUrl(req, allowedDomains);
    } catch (error) {
      res.status(400).send(error.message);
      return;
    }

    if (shouldIgnoreRequest(targetUrl.href)) {
      res.redirect(302, targetUrl.href);
      return;
    }

    // The page record is created for both humans and crawlers so the database
    // becomes a useful map of what RenderClaw has seen.
    const pageRecord = pageStore.ensurePageRecord(targetUrl);

    if (!isCrawler(req)) {
      res.redirect(302, targetUrl.href);
      return;
    }

    const crawlerProfile = detectCrawlerProfile(req);
    // Cache is scoped by crawler profile because each crawler can receive
    // different metadata, Open Graph tags, or JSON-LD recommendations.
    const pageCache = pageStore.getPageCache(pageRecord.id, crawlerProfile.id);
    const cached = htmlCache.read(pageCache);

    if (cached?.fresh) {
      setSeoHeaders(res, "HIT", pageCache || pageRecord);
      res.setHeader("X-Prerender-Crawler", crawlerProfile.id);
      res.send(cached.html);
      return;
    }

    if (cached?.stale) {
      setSeoHeaders(res, "STALE", pageCache || pageRecord);
      res.setHeader("X-Prerender-Crawler", crawlerProfile.id);
      refreshInBackground(targetUrl, pageRecord, crawlerProfile);
      res.send(cached.html);
      return;
    }

    try {
      const renderedPage = await queue.enqueue(() => renderer.renderPage(targetUrl, pageRecord, crawlerProfile));
      const renderedPageCache = pageStore.getPageCache(renderedPage.id, crawlerProfile.id);
      const renderedCache = htmlCache.read(renderedPageCache);

      if (!renderedCache) {
        res.status(500).send("Errore nel prerendering: cache non disponibile");
        return;
      }

      setSeoHeaders(res, "MISS", renderedPageCache || renderedPage);
      res.setHeader("X-Prerender-Crawler", crawlerProfile.id);
      res.send(renderedCache.html);
    } catch (error) {
      logger.log("error", "Render failed", { url: targetUrl.href, error: error.message });
      res.status(502).send("Errore nel prerendering");
    }
  });
}

module.exports = { registerPrerenderRoutes };
