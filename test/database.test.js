const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createDatabase } = require("../src/storage/database");

test("stores discovered site URLs as queryable inventory", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "renderclaw-db-"));
  const dbPath = path.join(tmp, "renderclaw.sqlite");
  const pageStore = createDatabase(dbPath);

  try {
    pageStore.saveSiteDiscovery("example.com", {
      domain: "example.com",
      robots: { url: "https://example.com/robots.txt", status: 200, ok: true, sitemapCount: 1 },
      sitemaps: [{ url: "https://example.com/sitemap.xml", status: 200, ok: true, type: "urlset" }],
      urls: ["https://example.com/a", "https://example.com/b?x=1"],
      urlEntries: [
        { url: "https://example.com/a", source: "sitemap", sitemapUrl: "https://example.com/sitemap.xml" },
        { url: "https://example.com/b?x=1", source: "sitemap", sitemapUrl: "https://example.com/sitemap.xml" },
      ],
      discoveredAt: new Date().toISOString(),
    });

    const urls = pageStore.listSiteUrls("example.com");
    assert.equal(urls.length, 2);
    assert.equal(urls[0].status, "discovered");
    assert.equal(urls[0].depth, 0);
    assert.ok(urls.some((entry) => entry.url === "https://example.com/a"));
    assert.ok(urls.some((entry) => entry.path === "/b" && entry.query === "?x=1"));
  } finally {
    pageStore.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("stores same-domain rendered links as internal crawl candidates with depth", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "renderclaw-db-"));
  const dbPath = path.join(tmp, "renderclaw.sqlite");
  const pageStore = createDatabase(dbPath);

  try {
    const pageRecord = pageStore.ensurePageRecord(new URL("https://example.com/root"));
    pageStore.saveSiteDiscovery("example.com", {
      domain: "example.com",
      robots: { url: "https://example.com/robots.txt", status: 200, ok: true, sitemapCount: 1 },
      sitemaps: [],
      urls: ["https://example.com/root"],
      urlEntries: [{ url: "https://example.com/root", source: "sitemap", sitemapUrl: "", depth: 0 }],
      discoveredAt: new Date().toISOString(),
    });

    const saved = pageStore.saveInternalSiteUrls(pageRecord, [
      { href: "https://example.com/a", text: "A", rel: "" },
      { href: "https://other.example/b", text: "B", rel: "" },
    ], 2);
    const urls = pageStore.listSiteUrls("example.com", 10);

    assert.equal(saved, 1);
    assert.ok(urls.some((entry) => (
      entry.url === "https://example.com/a" &&
      entry.source === "internal_link" &&
      entry.depth === 1
    )));
    assert.ok(!urls.some((entry) => entry.url === "https://other.example/b"));
  } finally {
    pageStore.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("respects crawl depth limit when storing rendered links", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "renderclaw-db-"));
  const dbPath = path.join(tmp, "renderclaw.sqlite");
  const pageStore = createDatabase(dbPath);

  try {
    pageStore.saveSiteDiscovery("example.com", {
      domain: "example.com",
      robots: { url: "https://example.com/robots.txt", status: 200, ok: true, sitemapCount: 1 },
      sitemaps: [],
      urls: ["https://example.com/root"],
      urlEntries: [{ url: "https://example.com/root", source: "sitemap", sitemapUrl: "", depth: 0 }],
      discoveredAt: new Date().toISOString(),
    });
    const pageRecord = pageStore.ensurePageRecord(new URL("https://example.com/root"));
    const saved = pageStore.saveInternalSiteUrls(pageRecord, [
      { href: "https://example.com/a", text: "A", rel: "" },
    ], 0);

    assert.equal(saved, 0);
    assert.equal(pageStore.listSiteUrls("example.com", 10).length, 1);
  } finally {
    pageStore.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("promotes discovered site URLs into a controlled crawl queue", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "renderclaw-db-"));
  const dbPath = path.join(tmp, "renderclaw.sqlite");
  const pageStore = createDatabase(dbPath);

  try {
    pageStore.saveSiteDiscovery("example.com", {
      domain: "example.com",
      robots: { url: "https://example.com/robots.txt", status: 200, ok: true, sitemapCount: 1 },
      sitemaps: [{ url: "https://example.com/sitemap.xml", status: 200, ok: true, type: "urlset" }],
      urls: ["https://example.com/a", "https://example.com/b", "https://example.com/c"],
      urlEntries: [
        { url: "https://example.com/a", source: "sitemap", sitemapUrl: "https://example.com/sitemap.xml" },
        { url: "https://example.com/b", source: "sitemap", sitemapUrl: "https://example.com/sitemap.xml" },
        { url: "https://example.com/c", source: "sitemap", sitemapUrl: "https://example.com/sitemap.xml" },
      ],
      discoveredAt: new Date().toISOString(),
    });

    const queued = pageStore.queueDiscoveredSiteUrls("example.com", 2);
    const urls = pageStore.listSiteUrls("example.com", 10);

    assert.equal(queued.length, 2);
    assert.equal(urls.filter((entry) => entry.status === "queued").length, 2);
    assert.equal(urls.filter((entry) => entry.status === "discovered").length, 1);
    assert.equal(pageStore.getPage("https://example.com/a").status, "queued");
    assert.equal(pageStore.getPage("https://example.com/b").status, "queued");
    assert.equal(pageStore.listQueuedSiteUrls("example.com", 10).length, 2);

    pageStore.updateSiteUrlStatus("example.com", "https://example.com/a", "rendered");
    assert.equal(pageStore.listQueuedSiteUrls("example.com", 10).length, 1);
  } finally {
    pageStore.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("builds a site intelligence report from inventory and internal links", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "renderclaw-db-"));
  const dbPath = path.join(tmp, "renderclaw.sqlite");
  const pageStore = createDatabase(dbPath);

  try {
    const root = pageStore.ensurePageRecord(new URL("https://example.com/"));
    pageStore.saveSiteDiscovery("example.com", {
      domain: "example.com",
      robots: { url: "https://example.com/robots.txt", status: 200, ok: true, sitemapCount: 1 },
      sitemaps: [],
      urls: [
        "https://example.com/",
        "https://example.com/linked",
        "https://example.com/orphan",
        "https://example.com/broken",
      ],
      urlEntries: [
        { url: "https://example.com/", source: "sitemap", sitemapUrl: "", depth: 0 },
        { url: "https://example.com/linked", source: "sitemap", sitemapUrl: "", depth: 0 },
        { url: "https://example.com/orphan", source: "sitemap", sitemapUrl: "", depth: 0 },
        { url: "https://example.com/broken", source: "sitemap", sitemapUrl: "", depth: 0 },
      ],
      discoveredAt: new Date().toISOString(),
    });
    pageStore.saveLinks(root.id, [
      { href: "https://example.com/linked", text: "Linked", rel: "" },
      { href: "https://example.com/broken", text: "Broken", rel: "" },
    ]);

    const broken = pageStore.ensurePageRecord(new URL("https://example.com/broken"));
    pageStore.markCached(
      broken.id,
      {
        htmlPath: "broken.html",
        cacheKey: "broken",
        byteSize: 12,
        expiresAt: new Date(Date.now() + 1000).toISOString(),
        variant: "google",
      },
      { title: "Broken", description: "", canonical: "", robots: "" },
      10,
      404
    );
    pageStore.updateSiteUrlStatus("example.com", "https://example.com/broken", "rendered");

    const report = pageStore.getSiteReport("example.com");

    assert.equal(report.summary.urlCount, 4);
    assert.equal(report.summary.brokenCount, 1);
    assert.ok(report.orphanUrls.some((entry) => entry.url === "https://example.com/orphan"));
    assert.ok(!report.orphanUrls.some((entry) => entry.url === "https://example.com/"));
    assert.ok(report.brokenPages.some((entry) => entry.url === "https://example.com/broken"));
    assert.ok(report.unrenderedUrls.some((entry) => entry.url === "https://example.com/linked"));
  } finally {
    pageStore.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
