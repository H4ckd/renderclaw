const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// Filesystem HTML cache.
// The database stores metadata and points to html_path; this component only
// reads/writes snapshot files and evaluates fresh/stale windows. The variant is
// normally a crawler profile id such as "google" or "social".
function createHtmlCache({ cacheDir, cacheTtlMs, staleTtlMs }) {
  function cacheKeyFor(url, variant) {
    return crypto.createHash("sha256").update(`${variant}:${url}`).digest("hex");
  }

  function cachePathFor(cacheKey) {
    return path.join(cacheDir, `${cacheKey}.html`);
  }

  function read(cacheRecord) {
    if (!cacheRecord || !cacheRecord.html_path || !fs.existsSync(cacheRecord.html_path)) return null;

    const html = fs.readFileSync(cacheRecord.html_path, "utf8");
    const expiresAt = cacheRecord.cache_expires_at ? Date.parse(cacheRecord.cache_expires_at) : 0;
    const staleUntil = expiresAt + staleTtlMs;
    const now = Date.now();

    // "stale" means the snapshot can still be served immediately while a
    // background refresh updates it for the next crawler request.
    return {
      html,
      fresh: now <= expiresAt,
      stale: now <= staleUntil,
      expiresAt,
    };
  }

  function write(url, html, variant = "generic") {
    const now = Date.now();
    const cacheKey = cacheKeyFor(url, variant);
    const htmlPath = cachePathFor(cacheKey);
    fs.writeFileSync(htmlPath, html, "utf8");

    return {
      cacheKey,
      htmlPath,
      variant,
      byteSize: Buffer.byteLength(html, "utf8"),
      expiresAt: new Date(now + cacheTtlMs).toISOString(),
    };
  }

  function healthCheck() {
    const probePath = path.join(cacheDir, `.renderclaw-health-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probePath, "ok");
    fs.unlinkSync(probePath);
  }

  return { healthCheck, read, write };
}

module.exports = { createHtmlCache };
