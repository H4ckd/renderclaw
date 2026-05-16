const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createHtmlCache } = require("../src/storage/htmlCache");

test("applies domain and path cache freshness rules", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "renderclaw-cache-"));

  try {
    const htmlCache = createHtmlCache({
      cacheDir: tmp,
      cacheTtlMs: 60_000,
      staleTtlMs: 120_000,
      cacheRules: [
        {
          id: "blog",
          domain: "example.com",
          pathPattern: "^/blog/",
          ttlSeconds: 1,
          staleTtlSeconds: 3,
        },
      ],
    });

    const written = htmlCache.write("https://example.com/blog/post", "<html></html>", "google");
    const expiresAt = Date.parse(written.expiresAt);

    assert.equal(written.policy.ruleId, "blog");
    assert.ok(expiresAt - Date.now() <= 1000);

    const cached = htmlCache.read({
      html_path: written.htmlPath,
      cache_expires_at: new Date(Date.now() - 2000).toISOString(),
      url: "https://example.com/blog/post",
    });

    assert.equal(cached.fresh, false);
    assert.equal(cached.stale, true);
    assert.equal(cached.status, "stale");
    assert.equal(cached.policy.ruleId, "blog");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("inspects cache status without reading snapshot HTML", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "renderclaw-cache-"));

  try {
    const htmlCache = createHtmlCache({
      cacheDir: tmp,
      cacheTtlMs: 1000,
      staleTtlMs: 1000,
    });
    const written = htmlCache.write("https://example.com/page", "<html>large snapshot</html>", "google");
    const fresh = htmlCache.inspect({
      html_path: written.htmlPath,
      cache_key: written.cacheKey,
      cache_expires_at: new Date(Date.now() + 1000).toISOString(),
      crawler_profile: "google",
      url: "https://example.com/page",
    });
    const expired = htmlCache.inspect({
      html_path: written.htmlPath,
      cache_expires_at: new Date(Date.now() - 3000).toISOString(),
      crawler_profile: "google",
      url: "https://example.com/page",
    });
    const missing = htmlCache.inspect({
      html_path: path.join(tmp, "missing.html"),
      cache_expires_at: new Date(Date.now() + 1000).toISOString(),
      crawler_profile: "bing",
      url: "https://example.com/page",
    });

    assert.equal(fresh.status, "fresh");
    assert.equal(fresh.exists, true);
    assert.equal(expired.status, "expired");
    assert.equal(missing.status, "missing");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("purges cache files only inside the cache directory", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "renderclaw-cache-"));
  const outside = path.join(os.tmpdir(), `renderclaw-outside-${Date.now()}.html`);

  try {
    const htmlCache = createHtmlCache({
      cacheDir: tmp,
      cacheTtlMs: 1000,
      staleTtlMs: 1000,
    });
    const written = htmlCache.write("https://example.com/page", "<html></html>", "google");
    fs.writeFileSync(outside, "outside", "utf8");

    const results = htmlCache.purge([
      { html_path: written.htmlPath },
      { html_path: outside },
      { html_path: path.join(tmp, "missing.html") },
    ]);

    assert.equal(results[0].status, "deleted");
    assert.equal(results[1].status, "outside_cache_dir");
    assert.equal(results[2].status, "missing_file");
    assert.equal(fs.existsSync(written.htmlPath), false);
    assert.equal(fs.existsSync(outside), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  }
});
