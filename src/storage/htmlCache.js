const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createCachePolicy } = require("./cachePolicy");

// Filesystem HTML cache.
// The database stores metadata and points to html_path; this component only
// reads/writes snapshot files and evaluates fresh/stale windows. The variant is
// normally a crawler profile id such as "google" or "social".
function createHtmlCache({ cacheDir, cacheTtlMs, staleTtlMs, cacheRules = [] }) {
  const cachePolicy = createCachePolicy({
    defaultTtlMs: cacheTtlMs,
    defaultStaleTtlMs: staleTtlMs,
    rules: cacheRules,
  });

  function cacheKeyFor(url, variant) {
    return crypto.createHash("sha256").update(`${variant}:${url}`).digest("hex");
  }

  function cachePathFor(cacheKey) {
    return path.join(cacheDir, `${cacheKey}.html`);
  }

  function read(cacheRecord) {
    if (!cacheRecord || !cacheRecord.html_path || !fs.existsSync(cacheRecord.html_path)) return null;

    const html = fs.readFileSync(cacheRecord.html_path, "utf8");
    const status = inspect(cacheRecord);

    return {
      html,
      ...status,
    };
  }

  function inspect(cacheRecord) {
    if (!cacheRecord) return null;

    const policy = cachePolicy.resolve(cacheRecord.url || "");
    const expiresAt = cacheRecord.cache_expires_at ? Date.parse(cacheRecord.cache_expires_at) : 0;
    const staleUntil = expiresAt + policy.staleTtlMs;
    const now = Date.now();
    const htmlPath = cacheRecord.html_path || "";
    const fileExists = Boolean(htmlPath && fs.existsSync(htmlPath));
    const fresh = fileExists && now <= expiresAt;
    const stale = fileExists && !fresh && now <= staleUntil;

    // "stale" means the snapshot can still be served immediately while a
    // background refresh updates it for the next crawler request.
    return {
      byteSize: cacheRecord.byte_size || 0,
      cacheKey: cacheRecord.cache_key || "",
      crawlerProfile: cacheRecord.crawler_profile || "",
      exists: fileExists,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      fresh,
      htmlPath,
      lastRenderedAt: cacheRecord.last_rendered_at || null,
      policy,
      sourceCheckedAt: cacheRecord.source_checked_at || null,
      sourceEtag: cacheRecord.source_etag || "",
      sourceLastModified: cacheRecord.source_last_modified || "",
      sourceStatus: cacheRecord.source_status || null,
      stale,
      staleUntil: staleUntil ? new Date(staleUntil).toISOString() : null,
      status: cacheStatus({ fileExists, fresh, stale }),
      timingMs: cacheRecord.timing_ms || 0,
      url: cacheRecord.url || "",
      variant: cacheRecord.crawler_profile || "",
    };
  }

  function cacheStatus({ fileExists, fresh, stale }) {
    if (!fileExists) return "missing";
    if (fresh) return "fresh";
    if (stale) return "stale";
    return "expired";
  }

  function write(url, html, variant = "generic") {
    const now = Date.now();
    const policy = cachePolicy.resolve(url);
    const cacheKey = cacheKeyFor(url, variant);
    const htmlPath = cachePathFor(cacheKey);
    fs.writeFileSync(htmlPath, html, "utf8");

    return {
      cacheKey,
      htmlPath,
      variant,
      byteSize: Buffer.byteLength(html, "utf8"),
      expiresAt: new Date(now + policy.ttlMs).toISOString(),
      policy,
    };
  }

  function nextExpiry(url) {
    const policy = cachePolicy.resolve(url);
    return {
      expiresAt: new Date(Date.now() + policy.ttlMs).toISOString(),
      policy,
    };
  }

  function healthCheck() {
    const probePath = path.join(cacheDir, `.renderclaw-health-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probePath, "ok");
    fs.unlinkSync(probePath);
  }

  function purge(cacheRecords) {
    const results = [];

    for (const record of cacheRecords || []) {
      const htmlPath = record.html_path || record.htmlPath || "";
      if (!htmlPath) {
        results.push({ htmlPath, status: "missing_path" });
        continue;
      }

      if (!isInsideCacheDir(htmlPath)) {
        results.push({ htmlPath, status: "outside_cache_dir" });
        continue;
      }

      if (!fs.existsSync(htmlPath)) {
        results.push({ htmlPath, status: "missing_file" });
        continue;
      }

      fs.unlinkSync(htmlPath);
      results.push({ htmlPath, status: "deleted" });
    }

    return results;
  }

  function isInsideCacheDir(filePath) {
    const resolvedCacheDir = path.resolve(cacheDir);
    const resolvedFilePath = path.resolve(filePath);
    return resolvedFilePath.startsWith(`${resolvedCacheDir}${path.sep}`);
  }

  return { healthCheck, inspect, nextExpiry, purge, read, write };
}

module.exports = { createHtmlCache };
