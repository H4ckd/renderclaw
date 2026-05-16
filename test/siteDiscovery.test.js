const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createSiteDiscovery,
  normalizeDomain,
  parseRobotsTxt,
  parseSitemapXml,
} = require("../src/seo/siteDiscovery");

test("parses sitemap references from robots.txt", () => {
  const parsed = parseRobotsTxt(`
    User-agent: *
    Allow: /
    Sitemap: https://example.com/sitemap.xml
    Sitemap: https://example.com/news-sitemap.xml # comment
  `);

  assert.deepEqual(parsed.sitemaps, [
    "https://example.com/sitemap.xml",
    "https://example.com/news-sitemap.xml",
  ]);
});

test("parses sitemap indexes and URL sets", () => {
  const sitemapIndex = parseSitemapXml(`
    <sitemapindex>
      <sitemap><loc>https://example.com/pages.xml</loc></sitemap>
    </sitemapindex>
  `);
  const urlSet = parseSitemapXml(`
    <urlset>
      <url><loc>https://example.com/a?x=1&amp;y=2</loc></url>
      <url><loc>https://example.com/b</loc></url>
    </urlset>
  `);

  assert.equal(sitemapIndex.type, "sitemapindex");
  assert.deepEqual(sitemapIndex.sitemaps, ["https://example.com/pages.xml"]);
  assert.equal(urlSet.type, "urlset");
  assert.deepEqual(urlSet.urls, ["https://example.com/a?x=1&y=2", "https://example.com/b"]);
});

test("discovers robots sitemaps and same-domain URLs", async () => {
  const responses = new Map([
    ["https://example.com/robots.txt", "Sitemap: https://example.com/sitemap-index.xml"],
    [
      "https://example.com/sitemap-index.xml",
      "<sitemapindex><sitemap><loc>https://example.com/pages.xml</loc></sitemap></sitemapindex>",
    ],
    [
      "https://example.com/pages.xml",
      "<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://other.example/b</loc></url></urlset>",
    ],
    ["https://example.com/sitemap.xml", "<urlset><url><loc>https://example.com/root</loc></url></urlset>"],
  ]);
  const fetchImpl = async (url) => ({
    ok: responses.has(url),
    status: responses.has(url) ? 200 : 404,
    text: async () => responses.get(url) || "",
  });
  const discovery = createSiteDiscovery({ fetchImpl });

  const report = await discovery.discover("example.com");

  assert.equal(report.robots.ok, true);
  assert.equal(report.sitemaps.length, 3);
  assert.deepEqual(report.urls.sort(), ["https://example.com/a", "https://example.com/root"]);
});

test("normalizes discovery domains and rejects local targets", () => {
  assert.equal(normalizeDomain("Example.COM"), "example.com");
  assert.throws(() => normalizeDomain("localhost"), /localhost or IP/);
  assert.throws(() => normalizeDomain("127.0.0.1"), /localhost or IP/);
  assert.throws(() => normalizeDomain("example.com@evil.test"), /plain hostname/);
  assert.throws(() => normalizeDomain("example.com:8080"), /plain hostname/);
  assert.throws(() => normalizeDomain("https://example.com"), /plain hostname/);
});
