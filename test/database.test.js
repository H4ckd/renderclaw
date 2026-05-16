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

test("prioritizes sitemap and internally linked URLs for crawl queue", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "renderclaw-db-"));
  const dbPath = path.join(tmp, "renderclaw.sqlite");
  const pageStore = createDatabase(dbPath);

  try {
    const root = pageStore.ensurePageRecord(new URL("https://example.com/"));
    pageStore.saveSiteDiscovery("example.com", {
      domain: "example.com",
      robots: { url: "https://example.com/robots.txt", status: 200, ok: true, sitemapCount: 1 },
      sitemaps: [{ url: "https://example.com/sitemap.xml", status: 200, ok: true, type: "urlset" }],
      urls: [
        "https://example.com/important",
        "https://example.com/ordinary",
      ],
      urlEntries: [
        {
          url: "https://example.com/important",
          source: "sitemap",
          sitemapUrl: "https://example.com/sitemap.xml",
          depth: 0,
        },
        {
          url: "https://example.com/ordinary",
          source: "internal_link",
          sitemapUrl: "",
          depth: 2,
        },
      ],
      discoveredAt: new Date().toISOString(),
    });
    pageStore.saveLinks(root.id, [
      { href: "https://example.com/important", text: "Important", rel: "" },
    ]);

    const queued = pageStore.queueDiscoveredSiteUrls("example.com", 2);
    const report = pageStore.getSiteReport("example.com");

    assert.equal(queued[0].url, "https://example.com/important");
    assert.ok(queued[0].refreshPriority > queued[1].refreshPriority);
    assert.equal(report.priorityUrls[0].url, "https://example.com/important");
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

test("reports duplicate canonical groups across rendered pages", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "renderclaw-db-"));
  const dbPath = path.join(tmp, "renderclaw.sqlite");
  const pageStore = createDatabase(dbPath);

  try {
    pageStore.saveSiteDiscovery("example.com", {
      domain: "example.com",
      robots: { url: "https://example.com/robots.txt", status: 200, ok: true, sitemapCount: 1 },
      sitemaps: [],
      urls: [
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/c",
      ],
      urlEntries: [
        { url: "https://example.com/a", source: "sitemap", sitemapUrl: "", depth: 0 },
        { url: "https://example.com/b", source: "sitemap", sitemapUrl: "", depth: 0 },
        { url: "https://example.com/c", source: "sitemap", sitemapUrl: "", depth: 0 },
      ],
      discoveredAt: new Date().toISOString(),
    });

    for (const url of ["https://example.com/a", "https://example.com/b"]) {
      const page = pageStore.ensurePageRecord(new URL(url));
      pageStore.markCached(
        page.id,
        {
          htmlPath: `${page.id}.html`,
          cacheKey: String(page.id),
          byteSize: 12,
          expiresAt: new Date(Date.now() + 1000).toISOString(),
          variant: "google",
        },
        {
          title: "Duplicate canonical",
          description: "",
          canonical: "https://example.com/canonical",
          robots: "",
        },
        10,
        200
      );
      pageStore.updateSiteUrlStatus("example.com", url, "rendered");
    }

    const unique = pageStore.ensurePageRecord(new URL("https://example.com/c"));
    pageStore.markCached(
      unique.id,
      {
        htmlPath: "unique.html",
        cacheKey: "unique",
        byteSize: 12,
        expiresAt: new Date(Date.now() + 1000).toISOString(),
        variant: "google",
      },
      {
        title: "Unique canonical",
        description: "",
        canonical: "https://example.com/c",
        robots: "",
      },
      10,
      200
    );
    pageStore.updateSiteUrlStatus("example.com", "https://example.com/c", "rendered");

    const report = pageStore.getSiteReport("example.com");

    assert.equal(report.summary.duplicateCanonicalGroupCount, 1);
    assert.equal(report.duplicateCanonicalGroups[0].canonical, "https://example.com/canonical");
    assert.deepEqual(report.duplicateCanonicalGroups[0].urls.sort(), [
      "https://example.com/a",
      "https://example.com/b",
    ]);
  } finally {
    pageStore.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("stores redirect checks and includes chains in the site report", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "renderclaw-db-"));
  const dbPath = path.join(tmp, "renderclaw.sqlite");
  const pageStore = createDatabase(dbPath);

  try {
    pageStore.saveSiteDiscovery("example.com", {
      domain: "example.com",
      robots: { url: "https://example.com/robots.txt", status: 200, ok: true, sitemapCount: 1 },
      sitemaps: [],
      urls: ["https://example.com/a"],
      urlEntries: [{ url: "https://example.com/a", source: "sitemap", sitemapUrl: "", depth: 0 }],
      discoveredAt: new Date().toISOString(),
    });
    pageStore.saveRedirectCheck("example.com", {
      url: "https://example.com/a",
      finalUrl: "https://example.com/b",
      finalStatus: 200,
      hopCount: 1,
      chain: [
        { url: "https://example.com/a", status: 301, location: "https://example.com/b" },
        { url: "https://example.com/b", status: 200, location: "" },
      ],
      error: "",
      checkedAt: new Date().toISOString(),
    });

    const checks = pageStore.listRedirectChecks("example.com");
    const report = pageStore.getSiteReport("example.com");

    assert.equal(checks.length, 1);
    assert.equal(checks[0].chain.length, 2);
    assert.equal(report.summary.redirectChainCount, 1);
    assert.equal(report.redirectChains[0].final_url, "https://example.com/b");
  } finally {
    pageStore.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("reports redirect final errors as broken links", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "renderclaw-db-"));
  const dbPath = path.join(tmp, "renderclaw.sqlite");
  const pageStore = createDatabase(dbPath);

  try {
    pageStore.saveSiteDiscovery("example.com", {
      domain: "example.com",
      robots: { url: "https://example.com/robots.txt", status: 200, ok: true, sitemapCount: 1 },
      sitemaps: [],
      urls: ["https://example.com/missing"],
      urlEntries: [{ url: "https://example.com/missing", source: "sitemap", sitemapUrl: "", depth: 0 }],
      discoveredAt: new Date().toISOString(),
    });
    pageStore.saveRedirectCheck("example.com", {
      url: "https://example.com/missing",
      finalUrl: "https://example.com/missing",
      finalStatus: 404,
      hopCount: 0,
      chain: [{ url: "https://example.com/missing", status: 404, location: "" }],
      error: "",
      checkedAt: new Date().toISOString(),
    });

    const report = pageStore.getSiteReport("example.com");

    assert.equal(report.summary.brokenLinkCount, 1);
    assert.equal(report.summary.brokenCount, 1);
    assert.equal(report.brokenLinks[0].final_status, 404);
  } finally {
    pageStore.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("returns internal link graph with inbound and outbound links", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "renderclaw-db-"));
  const dbPath = path.join(tmp, "renderclaw.sqlite");
  const pageStore = createDatabase(dbPath);

  try {
    const root = pageStore.ensurePageRecord(new URL("https://example.com/"));
    const child = pageStore.ensurePageRecord(new URL("https://example.com/child"));
    pageStore.saveLinks(root.id, [
      { href: "https://example.com/child", text: "Child", rel: "" },
      { href: "https://other.example/out", text: "External", rel: "nofollow" },
    ]);
    pageStore.saveLinks(child.id, [
      { href: "https://example.com/", text: "Home", rel: "" },
    ]);

    const graph = pageStore.getInternalLinkGraph("example.com", {
      url: "https://example.com/child",
      limit: 10,
    });

    assert.ok(graph.links.some((entry) => (
      entry.source_url === "https://example.com/" &&
      entry.target_url === "https://example.com/child"
    )));
    assert.equal(graph.inboundLinks.length, 1);
    assert.equal(graph.inboundLinks[0].source_url, "https://example.com/");
    assert.equal(graph.outboundLinks.length, 1);
    assert.equal(graph.outboundLinks[0].target_url, "https://example.com/");
  } finally {
    pageStore.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("lists and deletes cache records for purge operations", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "renderclaw-db-"));
  const dbPath = path.join(tmp, "renderclaw.sqlite");
  const pageStore = createDatabase(dbPath);

  try {
    const page = pageStore.ensurePageRecord(new URL("https://example.com/page"));
    pageStore.markCached(
      page.id,
      {
        htmlPath: path.join(tmp, "google.html"),
        cacheKey: "google",
        byteSize: 12,
        expiresAt: new Date(Date.now() + 1000).toISOString(),
        variant: "google",
      },
      { title: "Page", description: "", canonical: "", robots: "" },
      10,
      200
    );

    const candidates = pageStore.listCachePurgeCandidates({
      domain: "example.com",
      crawlerProfile: "google",
    });
    const deleted = pageStore.deleteCacheRecords(candidates);
    const after = pageStore.listCachePurgeCandidates({ domain: "example.com" });

    assert.equal(candidates.length, 1);
    assert.equal(deleted.deletedRecords, 1);
    assert.equal(after.length, 0);
    assert.equal(pageStore.getPage("https://example.com/page").status, "new");
  } finally {
    pageStore.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("lists crawler cache variants for a page", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "renderclaw-db-"));
  const dbPath = path.join(tmp, "renderclaw.sqlite");
  const pageStore = createDatabase(dbPath);

  try {
    const page = pageStore.ensurePageRecord(new URL("https://example.com/page"));
    pageStore.markCached(
      page.id,
      {
        htmlPath: path.join(tmp, "google.html"),
        cacheKey: "google",
        byteSize: 12,
        expiresAt: new Date(Date.now() + 1000).toISOString(),
        variant: "google",
      },
      { title: "Page", description: "", canonical: "", robots: "" },
      10,
      200
    );
    pageStore.markCached(
      page.id,
      {
        htmlPath: path.join(tmp, "social.html"),
        cacheKey: "social",
        byteSize: 14,
        expiresAt: new Date(Date.now() + 1000).toISOString(),
        variant: "social",
      },
      { title: "Page", description: "", canonical: "", robots: "" },
      12,
      200
    );

    const variants = pageStore.listPageCacheVariants(page.id);

    assert.deepEqual(variants.map((entry) => entry.crawler_profile), ["google", "social"]);
    assert.equal(variants[0].url, "https://example.com/page");
    assert.equal(variants[0].domain, "example.com");
  } finally {
    pageStore.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("stores source validators and refreshes cache expiry without rewriting HTML", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "renderclaw-db-"));
  const dbPath = path.join(tmp, "renderclaw.sqlite");
  const pageStore = createDatabase(dbPath);

  try {
    const page = pageStore.ensurePageRecord(new URL("https://example.com/page"));
    pageStore.markCached(
      page.id,
      {
        htmlPath: path.join(tmp, "google.html"),
        cacheKey: "google",
        byteSize: 12,
        expiresAt: new Date(Date.now() + 1000).toISOString(),
        variant: "google",
      },
      { title: "Page", description: "", canonical: "", robots: "" },
      10,
      200,
      {
        checkedAt: "2026-05-16T10:00:00.000Z",
        etag: '"abc"',
        lastModified: "Sat, 16 May 2026 10:00:00 GMT",
        status: 200,
      }
    );

    pageStore.refreshCacheVariant(
      page.id,
      "google",
      { expiresAt: "2026-05-16T11:00:00.000Z" },
      {
        checkedAt: "2026-05-16T10:30:00.000Z",
        etag: '"abc"',
        lastModified: "Sat, 16 May 2026 10:00:00 GMT",
        status: 304,
      }
    );

    const refreshedPage = pageStore.getPage("https://example.com/page");
    const refreshedCache = pageStore.getPageCache(page.id, "google");

    assert.equal(refreshedPage.source_etag, '"abc"');
    assert.equal(refreshedPage.source_status, 304);
    assert.equal(refreshedPage.cache_expires_at, "2026-05-16T11:00:00.000Z");
    assert.equal(refreshedCache.source_status, 304);
    assert.equal(refreshedCache.cache_expires_at, "2026-05-16T11:00:00.000Z");
  } finally {
    pageStore.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
