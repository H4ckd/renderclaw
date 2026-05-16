const { extractPageData } = require("./pageExtractor");
const { shouldAbortRequest } = require("./requestPolicy");
const { normalizeAbsolute, optimizeHtml } = require("./seoOptimizer");

// Coordinates the complete render pipeline for one URL and one crawler profile.
// Route handlers should not call Puppeteer directly; they enqueue this method
// through renderQueue so concurrency stays controlled.
function createRenderer({ aiSeoClient, browserManager, config, htmlCache, pageStore }) {
  async function renderPage(targetUrl, pageRecord, crawlerProfile) {
    const started = Date.now();
    let tab;

    try {
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

      pageStore.markCached(
        pageRecord.id,
        cacheData,
        extracted,
        timingMs,
        response ? response.status() : null
      );
      pageStore.saveLinks(pageRecord.id, extracted.links);
      pageStore.recordEvent(pageRecord.id, "rendered", { byteSize: cacheData.byteSize, timingMs });

      return pageStore.getPage(targetUrl.href);
    } catch (error) {
      const timingMs = Date.now() - started;
      pageStore.markError(pageRecord.id, error, timingMs);
      pageStore.recordEvent(pageRecord.id, "error", { message: error.message });
      throw error;
    } finally {
      if (tab) await tab.close().catch(() => {});
    }
  }

  return { renderPage };
}

module.exports = { createRenderer };
