const fs = require("node:fs");
const path = require("node:path");

// Runtime health checks used by /health.
// These checks are intentionally cheap: they validate that core local runtime
// resources are usable without triggering a render or an AI call.
function createHealthChecks({ browserManager, htmlCache, pageStore, paths, queue }) {
  function snapshot() {
    const checks = {
      database: check("database", () => pageStore.healthCheck()),
      cacheDir: check("cacheDir", () => htmlCache.healthCheck()),
      logDir: check("logDir", () => checkWritableDirectory(paths.logDir)),
      browser: {
        ok: true,
        connected: browserManager.isConnected(),
      },
      queue: {
        ok: true,
        ...queue.stats(),
      },
    };

    return {
      ok: Object.values(checks).every((item) => item.ok),
      checks,
    };
  }

  return { snapshot };
}

function check(name, fn) {
  try {
    fn();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `${name}: ${error.message}` };
  }
}

function checkWritableDirectory(dir) {
  const probePath = path.join(dir, `.renderclaw-health-${process.pid}-${Date.now()}`);
  fs.writeFileSync(probePath, "ok");
  fs.unlinkSync(probePath);
}

module.exports = { createHealthChecks };
