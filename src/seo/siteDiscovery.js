const DEFAULT_MAX_BYTES = 1024 * 1024;

// Lightweight site discovery for Phase 5.
// This module only fetches robots.txt and sitemap files on explicit admin
// request. It does not crawl pages, render URLs, or enqueue work by itself.
function createSiteDiscovery({ fetchImpl = globalThis.fetch, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for site discovery.");
  }

  async function discover(domain) {
    const normalizedDomain = normalizeDomain(domain);
    const origin = `https://${normalizedDomain}`;
    const robotsUrl = `${origin}/robots.txt`;
    const robots = await fetchText(robotsUrl, fetchImpl, maxBytes);
    const robotsSitemaps = robots.ok ? parseRobotsTxt(robots.body).sitemaps : [];
    const candidateSitemaps = uniqueUrls([...robotsSitemaps, `${origin}/sitemap.xml`]);

    const sitemapResults = [];
    const discoveredUrls = new Map();
    const pending = [...candidateSitemaps];
    const seenSitemaps = new Set();

    while (pending.length && sitemapResults.length < 25) {
      const sitemapUrl = pending.shift();
      if (!sitemapUrl || seenSitemaps.has(sitemapUrl)) continue;
      seenSitemaps.add(sitemapUrl);

      const sitemapFetch = await fetchText(sitemapUrl, fetchImpl, maxBytes);
      const parsed = sitemapFetch.ok ? parseSitemapXml(sitemapFetch.body) : emptySitemap();

      sitemapResults.push({
        url: sitemapUrl,
        status: sitemapFetch.status,
        ok: sitemapFetch.ok,
        type: parsed.type,
        urlCount: parsed.urls.length,
        childSitemapCount: parsed.sitemaps.length,
      });

      for (const url of parsed.urls) {
        if (belongsToDomain(url, normalizedDomain) && !discoveredUrls.has(url)) {
          discoveredUrls.set(url, {
            url,
            source: "sitemap",
            sitemapUrl,
          });
        }
      }
      for (const childSitemap of parsed.sitemaps) {
        if (belongsToDomain(childSitemap, normalizedDomain)) pending.push(childSitemap);
      }
    }

    return {
      domain: normalizedDomain,
      robots: {
        url: robotsUrl,
        status: robots.status,
        ok: robots.ok,
        sitemapCount: robotsSitemaps.length,
      },
      sitemaps: sitemapResults,
      urls: [...discoveredUrls.keys()].slice(0, 5000),
      urlEntries: [...discoveredUrls.values()].slice(0, 5000),
      discoveredAt: new Date().toISOString(),
    };
  }

  return { discover };
}

function normalizeDomain(value) {
  const domain = String(value || "").trim().toLowerCase();
  if (!domain || domain.includes("/") || domain.includes(":") || domain.includes("@")) {
    throw new Error("Discovery domain must be a plain hostname.");
  }
  if (domain === "localhost" || /^[\d.]+$/.test(domain) || domain.startsWith("[") || domain.endsWith("]")) {
    throw new Error("Discovery does not allow localhost or IP targets.");
  }
  if (!/^[a-z0-9.-]+$/.test(domain) || !domain.includes(".") || domain.includes("..")) {
    throw new Error("Discovery domain is invalid.");
  }

  return domain;
}

async function fetchText(url, fetchImpl, maxBytes) {
  try {
    const response = await fetchImpl(url, {
      headers: {
        "User-Agent": "RenderClaw site discovery (+https://github.com/H4ckd/renderclaw)",
        Accept: "text/plain, application/xml, text/xml, */*",
      },
      redirect: "follow",
    });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: body.slice(0, maxBytes),
    };
  } catch (error) {
    return { ok: false, status: 0, body: "", error: error.message };
  }
}

function parseRobotsTxt(text) {
  const sitemaps = [];

  for (const line of String(text || "").split(/\r?\n/)) {
    const cleaned = line.replace(/#.*/, "").trim();
    const match = cleaned.match(/^sitemap:\s*(.+)$/i);
    if (match) sitemaps.push(match[1].trim());
  }

  return { sitemaps: uniqueUrls(sitemaps) };
}

function parseSitemapXml(xml) {
  const value = String(xml || "");
  const locs = [...value.matchAll(/<loc[^>]*>\s*([^<]+?)\s*<\/loc>/gi)]
    .map((match) => decodeXml(match[1].trim()))
    .filter(isHttpUrl);

  if (/<sitemapindex[\s>]/i.test(value)) {
    return { type: "sitemapindex", sitemaps: uniqueUrls(locs), urls: [] };
  }

  return { type: "urlset", sitemaps: [], urls: uniqueUrls(locs) };
}

function emptySitemap() {
  return { type: "unknown", sitemaps: [], urls: [] };
}

function belongsToDomain(value, domain) {
  try {
    return new URL(value).hostname.toLowerCase() === domain.toLowerCase();
  } catch {
    return false;
  }
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function uniqueUrls(values) {
  return [...new Set(values.filter(isHttpUrl))];
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

module.exports = {
  createSiteDiscovery,
  normalizeDomain,
  parseRobotsTxt,
  parseSitemapXml,
};
