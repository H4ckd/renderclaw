const express = require("express");

const { createOpenAiSeoClient } = require("./ai/openaiSeoClient");
const { ensureRuntimeDirectories } = require("./bootstrap/filesystem");
const { config, paths } = require("./config");
const { registerAdminRoutes } = require("./http/adminRoutes");
const { registerHealthRoutes } = require("./http/healthRoutes");
const { registerPrerenderRoutes } = require("./http/prerenderRoutes");
const { createLogger } = require("./logger");
const { createBrowserManager } = require("./rendering/browserManager");
const { createRenderQueue } = require("./rendering/renderQueue");
const { createRenderer } = require("./rendering/renderer");
const { createDatabase } = require("./storage/database");
const { createHtmlCache } = require("./storage/htmlCache");

function createServer() {
  ensureRuntimeDirectories(paths);

  const app = express();
  const logger = createLogger(paths.logDir);
  const pageStore = createDatabase(paths.db);
  const htmlCache = createHtmlCache({
    cacheDir: paths.cacheDir,
    cacheTtlMs: config.cacheTtlMs,
    staleTtlMs: config.staleTtlMs,
  });
  const queue = createRenderQueue(config.concurrency);
  const browserManager = createBrowserManager(config);
  const aiSeoClient = createOpenAiSeoClient(config.ai, logger);
  const renderer = createRenderer({
    aiSeoClient,
    browserManager,
    config,
    htmlCache,
    pageStore,
  });

  registerHealthRoutes(app, { browserManager, queue });
  registerAdminRoutes(app, pageStore);
  registerPrerenderRoutes(app, {
    allowedDomains: config.allowedDomains,
    htmlCache,
    logger,
    pageStore,
    queue,
    renderer,
  });

  async function shutdown(signal) {
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
      });
    });
  }

  return { app, start };
}

module.exports = { createServer };
