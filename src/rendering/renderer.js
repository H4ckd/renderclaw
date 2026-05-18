const crypto = require("node:crypto");

const { extractPageData } = require("./pageExtractor");
const { shouldAbortRequest } = require("./requestPolicy");
const { normalizeAbsolute, optimizeHtml } = require("./seoOptimizer");
const { analyzePageSeo } = require("../seo/pageAnalyzer");

// Coordinates the complete render pipeline for one URL and one crawler profile.
// Route handlers should not call Puppeteer directly; they enqueue this method
// through renderQueue so concurrency stays controlled.
function createRenderer({ aiSeoClient, browserManager, config, htmlCache, metrics, pageStore, sourceProbe = null }) {
  async function renderPage(targetUrl, pageRecord, crawlerProfile, context = {}) {
    const started = Date.now();
    const renderId = crypto.randomUUID();
    let tab;

    try {
      const existingCache = pageStore.getPageCache(pageRecord.id, crawlerProfile.id);
      const existingCacheStatus = htmlCache.inspect(existingCache);
      const canProbe = sourceProbe && existingCacheStatus?.exists && context.probeSource !== false;

      if (canProbe) {
        const probe = await sourceProbe.probe(targetUrl, {
          etag: existingCache.source_etag || pageRecord.source_etag || "",
          hash: existingCache.source_hash || pageRecord.source_hash || "",
          lastModified: existingCache.source_last_modified || pageRecord.source_last_modified || "",
        });
        pageStore.markSourceProbe(pageRecord.id, probe);

        if (!probe.changed) {
          const cacheData = htmlCache.nextExpiry(targetUrl.href);
          pageStore.refreshCacheVariant(pageRecord.id, crawlerProfile.id, cacheData, probe);
          pageStore.recordEvent(pageRecord.id, "source_unchanged", {
            crawlerProfile: crawlerProfile.id,
            renderId,
            requestId: context.requestId || "",
            sourceStatus: probe.status,
          });
          metrics.increment("sourceProbeUnchanged");
          return pageStore.getPage(targetUrl.href);
        }

        metrics.increment(probe.error ? "sourceProbeErrors" : "sourceProbeChanged");
      }

      const activeBrowser = await browserManager.getBrowser();
      tab = await activeBrowser.newPage();
      await tab.setCacheEnabled(true);
      await tab.setUserAgent(`Mozilla/5.0 (compatible; ${config.appName}/1.0; +https://${config.appSlug}.local)`);
      await tab.setViewport({ width: 1365, height: 768, deviceScaleFactor: 1 });
      await tab.setRequestInterception(true);

      tab.on("request", (request) => {
        if (shouldAbortRequest(request)) {
          request.abort();
          return;
        }

        request.continue();
      });

      const response = await tab.goto(targetUrl.href, {
        waitUntil: "networkidle2",
        timeout: config.pageTimeoutMs,
      });

      await tab.waitForFunction(() => document.readyState === "complete", { timeout: 5000 }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, config.extraWaitMs));

      // Extract first, then ask the AI layer for conservative recommendations
      // based only on the content actually found in the rendered page.
      const extracted = await extractPageData(tab);
      extracted.canonical = normalizeAbsolute(targetUrl, extracted.canonical);
      const seoReport = analyzePageSeo(targetUrl, extracted);
      pageStore.saveSeoReport(pageRecord.id, seoReport);

      const aiAnalysis = await aiSeoClient.analyze({ targetUrl, crawlerProfile, extracted });
      pageStore.saveAiAnalysis(pageRecord.id, crawlerProfile.id, aiAnalysis);

      // Optimization happens before cache writes, so every crawler-specific
      // variant is stored as a ready-to-serve HTML snapshot.
      let html = await tab.content();
      html = optimizeHtml(html, targetUrl, extracted, aiAnalysis.recommendations);

      if (Buffer.byteLength(html, "utf8") > config.maxHtmlBytes) {
        throw new Error(`HTML troppo grande oltre ${config.maxHtmlBytes} byte`);
      }

      const cacheData = htmlCache.write(targetUrl.href, html, crawlerProfile.id);
      const timingMs = Date.now() - started;
      const responseProbe = await sourceProbeFromResponse(sourceProbe, targetUrl, response);

      pageStore.markCached(
        pageRecord.id,
        cacheData,
        extracted,
        timingMs,
        response ? response.status() : null,
        responseProbe
      );
      pageStore.saveLinks(pageRecord.id, extracted.links);
      pageStore.saveInternalSiteUrls(pageRecord, extracted.links, config.crawl.maxDepth);
      pageStore.recordEvent(pageRecord.id, "rendered", {
        byteSize: cacheData.byteSize,
        crawlerProfile: crawlerProfile.id,
        renderId,
        requestId: context.requestId || "",
        timingMs,
      });
      metrics.increment("renderSuccesses");
      metrics.recordRenderTime(timingMs);

      return pageStore.getPage(targetUrl.href);
    } catch (error) {
      const timingMs = Date.now() - started;
      pageStore.markError(pageRecord.id, error, timingMs);
      pageStore.recordEvent(pageRecord.id, "error", {
        crawlerProfile: crawlerProfile.id,
        message: error.message,
        renderId,
        requestId: context.requestId || "",
      });
      metrics.increment("renderErrors");
      metrics.recordRenderTime(timingMs);
      throw error;
    } finally {
      if (tab) await tab.close().catch(() => {});
    }
  }

  return { renderPage };
}

async function sourceProbeFromResponse(sourceProbe, targetUrl, response) {
  if (!response) return {};
  const headers = response.headers();
  if (sourceProbe?.snapshotSource) {
    const snapshot = await sourceProbe.snapshotSource(targetUrl);
    return {
      ...snapshot,
      etag: snapshot.etag || headers.etag || "",
      lastModified: snapshot.lastModified || headers["last-modified"] || "",
      status: snapshot.status || response.status(),
    };
  }

  return {
    checkedAt: new Date().toISOString(),
    etag: headers.etag || "",
    hash: "",
    lastModified: headers["last-modified"] || "",
    status: response.status(),
  };
}

module.exports = { createRenderer };
