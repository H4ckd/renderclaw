const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createHealthChecks } = require("../src/observability/healthChecks");

test("reports healthy writable runtime resources", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "renderclaw-health-"));

  try {
    const healthChecks = createHealthChecks({
      browserManager: { isConnected: () => false },
      htmlCache: { healthCheck: () => true },
      pageStore: { healthCheck: () => true },
      paths: { logDir: tmp },
      queue: { stats: () => ({ activeRenders: 0, queuedRenders: 0 }) },
    });

    const snapshot = healthChecks.snapshot();
    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.checks.database.ok, true);
    assert.equal(snapshot.checks.cacheDir.ok, true);
    assert.equal(snapshot.checks.logDir.ok, true);
    assert.equal(snapshot.checks.browser.connected, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
