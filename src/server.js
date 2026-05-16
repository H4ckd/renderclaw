const express = require("express");

// Server composition root.
// All long-lived components are created here and passed into route modules as
// dependencies. Keep business logic out of this file; put it in the component
// that owns the responsibility instead.
const { createOpenAiSeoClient } = require("./ai/openaiSeoClient");
const { ensureRuntimeDirectories } = require("./bootstrap/filesystem");
const { config, paths } = require("./config");
const { createAdminAuth } = require("./http/adminAuth");
const { registerAdminRoutes } = require("./http/adminRoutes");
const { registerHealthRoutes } = require("./http/healthRoutes");
const { registerMetricsRoutes } = require("./http/metricsRoutes");
const { registerPrerenderRoutes } = require("./http/prerenderRoutes");
const { createRateLimiter } = require("./http/rateLimiter");
const { requestContext } = require("./http/requestContext");
const { createLogger } = require("./logger");
const { createHealthChecks } = require("./observability/healthChecks");
const { createMetrics } = require("./observability/metrics");
const { createBrowserManager } = require("./rendering/browserManager");
const { createRenderQueue } = require("./rendering/renderQueue");
const { createRenderer } = require("./rendering/renderer");
const { createSiteDiscovery } = require("./seo/siteDiscovery");
const { createDatabase } = require("./storage/database");
const { createHtmlCache } = require("./storage/htmlCache");

function createServer() {
  ensureRuntimeDirectories(paths);

  // Core infrastructure shared by routes and render workers.
  const app = express();
  const logger = createLogger(paths.logDir);
  const metrics = createMetrics();
  const pageStore = createDatabase(paths.db);
  const htmlCache = createHtmlCache({
    cacheDir: paths.cacheDir,
    cacheTtlMs: config.cacheTtlMs,
    staleTtlMs: config.staleTtlMs,
  });
  const queue = createRenderQueue(config.concurrency, config.maxQueueSize);
  const browserManager = createBrowserManager(config);
  const aiSeoClient = createOpenAiSeoClient(config.ai, logger, metrics);
  const adminAuth = createAdminAuth(config.adminToken);
  const rateLimiter = createRateLimiter(config.rateLimit);
  const siteDiscovery = createSiteDiscovery();
  const healthChecks = createHealthChecks({
    browserManager,
    htmlCache,
    pageStore,
    paths,
    queue,
  });

  // Renderer coordinates browser rendering, AI analysis, SEO optimization,
  // cache writes, and DB updates. Routes should call it through the queue.
  const renderer = createRenderer({
    aiSeoClient,
    browserManager,
    config,
    htmlCache,
    metrics,
    pageStore,
  });

  app.use(requestContext);

  registerHealthRoutes(app, { healthChecks, metrics, queue });
  registerAdminRoutes(app, pageStore, adminAuth, siteDiscovery, config.crawl, {
    render: (targetUrl, pageRecord, crawlerProfile, requestId) => (
      queue.enqueue(() => renderer.renderPage(targetUrl, pageRecord, crawlerProfile, { requestId }))
    ),
  });
  registerMetricsRoutes(app, { adminAuth, browserManager, metrics, queue });

  // This catch-all route must be registered after fixed routes such as
  // /health and /admin/* because it accepts arbitrary domain-like paths.
  registerPrerenderRoutes(app, {
    allowedDomains: config.allowedDomains,
    htmlCache,
    logger,
    metrics,
    pageStore,
    queue,
    rateLimiter,
    renderer,
  });

  async function shutdown(signal) {
    // Close browser and SQLite handles so restarts do not leave orphaned
    // Chromium processes or locked database files behind.
    logger.log("info", "Shutting down", { signal });
    await browserManager.close();
    pageStore.close();
    logger.close();
    process.exit(0);
  }

  function start() {
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("unhandledRejection", (reason) => {
      logger.log("error", "Unhandled rejection", { error: String(reason) });
    });
    process.on("uncaughtException", (error) => {
      logger.log("error", "Uncaught exception", { error: error.stack || error.message });
    });

    app.listen(config.port, () => {
      logger.log("info", `${config.appName} server started`, {
        app: config.appSlug,
        port: config.port,
        dataDir: config.dataDir,
        concurrency: config.concurrency,
        maxQueueSize: config.maxQueueSize,
      });
    });
  }

  return { app, start };
}

module.exports = { createServer };
