const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

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

  return { read, write };
}

module.exports = { createHtmlCache };
