const { URL } = require("node:url");
const { DatabaseSync } = require("node:sqlite");

// SQLite storage adapter.
// This is the persistence boundary for RenderClaw. Other components should use
// the returned methods instead of preparing SQL directly. If the schema grows,
// add migrations here or split them into a dedicated migrations module.
function createDatabase(dbPath) {
  const db = new DatabaseSync(dbPath);

  // Current schema is created idempotently on startup. It tracks:
  // - sites and pages discovered by requests;
  // - links extracted from rendered pages;
  // - render events and errors;
  // - crawler-specific cache variants;
  // - AI analyses used to optimize a snapshot.
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL UNIQUE,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      page_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL,
      url TEXT NOT NULL UNIQUE,
      path TEXT NOT NULL,
      query TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      http_status INTEGER,
      title TEXT,
      meta_description TEXT,
      canonical TEXT,
      robots TEXT,
      html_path TEXT,
      cache_key TEXT,
      byte_size INTEGER NOT NULL DEFAULT 0,
      render_count INTEGER NOT NULL DEFAULT 0,
      last_rendered_at TEXT,
      cache_expires_at TEXT,
      last_error TEXT,
      timing_ms INTEGER,
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );

    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_page_id INTEGER NOT NULL,
      target_url TEXT NOT NULL,
      target_domain TEXT,
      anchor_text TEXT,
      rel TEXT,
      first_seen_at TEXT NOT NULL,
      UNIQUE(source_page_id, target_url, anchor_text),
      FOREIGN KEY(source_page_id) REFERENCES pages(id)
    );

    CREATE TABLE IF NOT EXISTS render_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id INTEGER NOT NULL,
      event TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(page_id) REFERENCES pages(id)
    );

    CREATE TABLE IF NOT EXISTS page_caches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id INTEGER NOT NULL,
      crawler_profile TEXT NOT NULL,
      html_path TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      byte_size INTEGER NOT NULL DEFAULT 0,
      last_rendered_at TEXT NOT NULL,
      cache_expires_at TEXT NOT NULL,
      timing_ms INTEGER,
      UNIQUE(page_id, crawler_profile),
      FOREIGN KEY(page_id) REFERENCES pages(id)
    );

    CREATE TABLE IF NOT EXISTS ai_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id INTEGER NOT NULL,
      crawler_profile TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT,
      recommendations TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(page_id) REFERENCES pages(id)
    );

    CREATE TABLE IF NOT EXISTS seo_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id INTEGER NOT NULL UNIQUE,
      score INTEGER NOT NULL,
      grade TEXT NOT NULL,
      issue_count INTEGER NOT NULL,
      report TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(page_id) REFERENCES pages(id)
    );

    CREATE TABLE IF NOT EXISTS site_discoveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL,
      robots_url TEXT,
      robots_status INTEGER,
      sitemap_count INTEGER NOT NULL DEFAULT 0,
      discovered_url_count INTEGER NOT NULL DEFAULT 0,
      report TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );

    CREATE TABLE IF NOT EXISTS site_urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      path TEXT NOT NULL,
      query TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      sitemap_url TEXT,
      depth INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'discovered',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      UNIQUE(site_id, url),
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );
  `);
  ensureColumn(db, "site_urls", "depth", "INTEGER NOT NULL DEFAULT 0");

  const statements = {
    upsertSite: db.prepare(`
      INSERT INTO sites (domain, first_seen_at, last_seen_at, page_count)
      VALUES (?, ?, ?, 0)
      ON CONFLICT(domain) DO UPDATE SET last_seen_at = excluded.last_seen_at
    `),
    getSite: db.prepare("SELECT * FROM sites WHERE domain = ?"),
    upsertPage: db.prepare(`
      INSERT INTO pages (site_id, url, path, query, status)
      VALUES (?, ?, ?, ?, 'queued')
      ON CONFLICT(url) DO UPDATE SET status = CASE WHEN status = 'error' THEN 'queued' ELSE status END
    `),
    getPage: db.prepare("SELECT * FROM pages WHERE url = ?"),
    updateSitePageCount: db.prepare(`
      UPDATE sites
      SET page_count = (SELECT COUNT(*) FROM pages WHERE site_id = sites.id)
      WHERE id = ?
    `),
    cachePage: db.prepare(`
      UPDATE pages
      SET status = 'cached',
          http_status = ?,
          title = ?,
          meta_description = ?,
          canonical = ?,
          robots = ?,
          html_path = ?,
          cache_key = ?,
          byte_size = ?,
          render_count = render_count + 1,
          last_rendered_at = ?,
          cache_expires_at = ?,
          last_error = NULL,
          timing_ms = ?
      WHERE id = ?
    `),
    markError: db.prepare(`
      UPDATE pages
      SET status = 'error',
          last_error = ?,
          render_count = render_count + 1,
          last_rendered_at = ?,
          timing_ms = ?
      WHERE id = ?
    `),
    insertLink: db.prepare(`
      INSERT OR IGNORE INTO links (source_page_id, target_url, target_domain, anchor_text, rel, first_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    insertEvent: db.prepare(`
      INSERT INTO render_events (page_id, event, detail, created_at)
      VALUES (?, ?, ?, ?)
    `),
    upsertPageCache: db.prepare(`
      INSERT INTO page_caches (
        page_id, crawler_profile, html_path, cache_key, byte_size, last_rendered_at, cache_expires_at, timing_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(page_id, crawler_profile) DO UPDATE SET
        html_path = excluded.html_path,
        cache_key = excluded.cache_key,
        byte_size = excluded.byte_size,
        last_rendered_at = excluded.last_rendered_at,
        cache_expires_at = excluded.cache_expires_at,
        timing_ms = excluded.timing_ms
    `),
    getPageCache: db.prepare("SELECT * FROM page_caches WHERE page_id = ? AND crawler_profile = ?"),
    insertAiAnalysis: db.prepare(`
      INSERT INTO ai_analyses (page_id, crawler_profile, provider, model, status, summary, recommendations, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    upsertSeoReport: db.prepare(`
      INSERT INTO seo_reports (page_id, score, grade, issue_count, report, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(page_id) DO UPDATE SET
        score = excluded.score,
        grade = excluded.grade,
        issue_count = excluded.issue_count,
        report = excluded.report,
        updated_at = excluded.updated_at
    `),
    getSeoReport: db.prepare("SELECT * FROM seo_reports WHERE page_id = ?"),
    insertSiteDiscovery: db.prepare(`
      INSERT INTO site_discoveries (
        site_id, robots_url, robots_status, sitemap_count, discovered_url_count, report, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    getLatestSiteDiscovery: db.prepare(`
      SELECT site_discoveries.*, sites.domain
      FROM site_discoveries
      JOIN sites ON sites.id = site_discoveries.site_id
      WHERE sites.domain = ?
      ORDER BY site_discoveries.created_at DESC
      LIMIT 1
    `),
    upsertSiteUrl: db.prepare(`
      INSERT INTO site_urls (
        site_id, url, path, query, source, sitemap_url, depth, status, first_seen_at, last_seen_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'discovered', ?, ?)
      ON CONFLICT(site_id, url) DO UPDATE SET
        source = excluded.source,
        sitemap_url = COALESCE(excluded.sitemap_url, site_urls.sitemap_url),
        depth = MIN(site_urls.depth, excluded.depth),
        last_seen_at = excluded.last_seen_at
    `),
    getSiteUrlByUrl: db.prepare(`
      SELECT site_urls.*
      FROM site_urls
      JOIN sites ON sites.id = site_urls.site_id
      WHERE sites.domain = ? AND site_urls.url = ?
    `),
    listSiteUrls: db.prepare(`
      SELECT site_urls.*
      FROM site_urls
      JOIN sites ON sites.id = site_urls.site_id
      WHERE sites.domain = ?
      ORDER BY site_urls.last_seen_at DESC, site_urls.url ASC
      LIMIT ?
    `),
    listDiscoveredSiteUrls: db.prepare(`
      SELECT site_urls.*
      FROM site_urls
      JOIN sites ON sites.id = site_urls.site_id
      WHERE sites.domain = ? AND site_urls.status = 'discovered'
      ORDER BY site_urls.last_seen_at ASC, site_urls.url ASC
      LIMIT ?
    `),
    listQueuedSiteUrls: db.prepare(`
      SELECT site_urls.*
      FROM site_urls
      JOIN sites ON sites.id = site_urls.site_id
      WHERE sites.domain = ? AND site_urls.status = 'queued'
      ORDER BY site_urls.last_seen_at ASC, site_urls.url ASC
      LIMIT ?
    `),
    listSiteUrlInventory: db.prepare(`
      SELECT
        site_urls.*,
        pages.id AS page_id,
        pages.status AS page_status,
        pages.http_status,
        pages.last_rendered_at,
        COALESCE(inbound.inbound_count, 0) AS inbound_count
      FROM site_urls
      JOIN sites ON sites.id = site_urls.site_id
      LEFT JOIN pages ON pages.url = site_urls.url
      LEFT JOIN (
        SELECT links.target_url, COUNT(DISTINCT links.source_page_id) AS inbound_count
        FROM links
        JOIN pages source_pages ON source_pages.id = links.source_page_id
        JOIN sites source_sites ON source_sites.id = source_pages.site_id
        WHERE source_sites.domain = ? AND links.target_domain = ?
        GROUP BY links.target_url
      ) inbound ON inbound.target_url = site_urls.url
      WHERE sites.domain = ?
      ORDER BY site_urls.url ASC
    `),
    updateSiteUrlStatus: db.prepare("UPDATE site_urls SET status = ?, last_seen_at = ? WHERE id = ?"),
    updateSiteUrlStatusByUrl: db.prepare(`
      UPDATE site_urls
      SET status = ?, last_seen_at = ?
      WHERE site_id = (SELECT id FROM sites WHERE domain = ?) AND url = ?
    `),
    listSites: db.prepare("SELECT * FROM sites ORDER BY last_seen_at DESC"),
    listPages: db.prepare(`
      SELECT pages.*, sites.domain, seo_reports.score AS seo_score, seo_reports.grade AS seo_grade
      FROM pages
      JOIN sites ON sites.id = pages.site_id
      LEFT JOIN seo_reports ON seo_reports.page_id = pages.id
      ORDER BY COALESCE(last_rendered_at, '1970-01-01') DESC
      LIMIT 200
    `),
    healthCheck: db.prepare("SELECT 1 AS ok"),
  };

  function ensurePageRecord(targetUrl) {
    // Upsert site/page for every request so the database becomes an audit trail
    // of what RenderClaw has been asked to inspect.
    const now = new Date().toISOString();
    const domain = targetUrl.hostname;

    statements.upsertSite.run(domain, now, now);
    const site = statements.getSite.get(domain);
    statements.upsertPage.run(site.id, targetUrl.href, targetUrl.pathname, targetUrl.search || "");
    statements.updateSitePageCount.run(site.id);

    return statements.getPage.get(targetUrl.href);
  }

  function ensureSiteRecord(domain) {
    const now = new Date().toISOString();
    statements.upsertSite.run(domain, now, now);
    return statements.getSite.get(domain);
  }

  function markCached(pageId, cacheData, extracted, timingMs, httpStatus) {
    // pages keeps the latest page-level SEO summary; page_caches keeps the
    // per-crawler rendered artifact metadata.
    const now = new Date();
    statements.cachePage.run(
      httpStatus,
      extracted.title,
      extracted.description,
      extracted.canonical,
      extracted.robots,
      cacheData.htmlPath,
      cacheData.cacheKey,
      cacheData.byteSize,
      now.toISOString(),
      cacheData.expiresAt,
      timingMs,
      pageId
    );

    statements.upsertPageCache.run(
      pageId,
      cacheData.variant,
      cacheData.htmlPath,
      cacheData.cacheKey,
      cacheData.byteSize,
      now.toISOString(),
      cacheData.expiresAt,
      timingMs
    );
  }

  function markError(pageId, error, timingMs) {
    statements.markError.run(error.message, new Date().toISOString(), timingMs, pageId);
  }

  function saveLinks(pageId, links) {
    // Links are deduplicated by SQLite. This keeps extraction simple while
    // preserving enough data for future site-graph features.
    const now = new Date().toISOString();

    for (const link of links) {
      try {
        const parsed = new URL(link.href);
        statements.insertLink.run(pageId, parsed.href, parsed.hostname, link.text, link.rel, now);
      } catch {
        // Ignore malformed links collected from broken markup.
      }
    }
  }

  function recordEvent(pageId, event, detail) {
    statements.insertEvent.run(pageId, event, JSON.stringify(detail || {}), new Date().toISOString());
  }

  function getPageCache(pageId, crawlerProfile) {
    return statements.getPageCache.get(pageId, crawlerProfile);
  }

  function saveAiAnalysis(pageId, crawlerProfile, analysis) {
    statements.insertAiAnalysis.run(
      pageId,
      crawlerProfile,
      analysis.provider || "none",
      analysis.model || "none",
      analysis.status,
      analysis.summary || "",
      JSON.stringify(analysis.recommendations || {}),
      new Date().toISOString()
    );
  }

  function saveSeoReport(pageId, report) {
    statements.upsertSeoReport.run(
      pageId,
      report.score,
      report.grade,
      report.issues.length,
      JSON.stringify(report),
      new Date().toISOString()
    );
  }

  function getSeoReport(pageId) {
    const row = statements.getSeoReport.get(pageId);
    if (!row) return null;

    return {
      ...row,
      report: JSON.parse(row.report),
    };
  }

  function saveSiteDiscovery(domain, report) {
    const site = ensureSiteRecord(domain);
    const now = new Date().toISOString();
    statements.insertSiteDiscovery.run(
      site.id,
      report.robots.url,
      report.robots.status,
      report.sitemaps.length,
      report.urls.length,
      JSON.stringify(report),
      now
    );
    saveDiscoveredUrls(site.id, report, now);
    return getSiteDiscovery(domain);
  }

  function saveDiscoveredUrls(siteId, report, now) {
    const entries = report.urlEntries || report.urls.map((url) => ({ url, source: "sitemap", sitemapUrl: "" }));

    for (const entry of entries) {
      try {
        const parsed = new URL(entry.url);
        statements.upsertSiteUrl.run(
          siteId,
          parsed.href,
          parsed.pathname,
          parsed.search || "",
          entry.source || "sitemap",
          entry.sitemapUrl || "",
          Number(entry.depth || 0),
          now,
          now
        );
      } catch {
        // Discovery already filters URLs, but keep storage resilient to old reports.
      }
    }
  }

  function saveInternalSiteUrls(pageRecord, links, maxDepth = 2) {
    const sourceUrl = new URL(pageRecord.url);
    const sourceEntry = statements.getSiteUrlByUrl.get(sourceUrl.hostname, sourceUrl.href);
    const sourceDepth = sourceEntry ? Number(sourceEntry.depth || 0) : 0;
    const nextDepth = sourceDepth + 1;

    if (nextDepth > maxDepth) return 0;

    const now = new Date().toISOString();
    let saved = 0;

    for (const link of links || []) {
      try {
        const parsed = new URL(link.href);
        if (parsed.hostname !== sourceUrl.hostname) continue;
        statements.upsertSiteUrl.run(
          pageRecord.site_id,
          parsed.href,
          parsed.pathname,
          parsed.search || "",
          "internal_link",
          "",
          nextDepth,
          now,
          now
        );
        saved++;
      } catch {
        // Ignore malformed links collected from broken markup.
      }
    }

    return saved;
  }

  function getSiteDiscovery(domain) {
    const row = statements.getLatestSiteDiscovery.get(domain);
    if (!row) return null;

    return {
      ...row,
      report: JSON.parse(row.report),
    };
  }

  function listSiteUrls(domain, limit = 500) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 5000));
    return statements.listSiteUrls.all(domain, safeLimit);
  }

  function queueDiscoveredSiteUrls(domain, limit = 50) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
    const now = new Date().toISOString();
    const urls = statements.listDiscoveredSiteUrls.all(domain, safeLimit);

    for (const entry of urls) {
      statements.updateSiteUrlStatus.run("queued", now, entry.id);
      ensurePageRecord(new URL(entry.url));
    }

    return urls.map((entry) => ({ ...entry, status: "queued" }));
  }

  function listQueuedSiteUrls(domain, limit = 5) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 100));
    return statements.listQueuedSiteUrls.all(domain, safeLimit);
  }

  function updateSiteUrlStatus(domain, url, status) {
    statements.updateSiteUrlStatusByUrl.run(status, new Date().toISOString(), domain, url);
  }

  function getSiteReport(domain) {
    const inventory = statements.listSiteUrlInventory.all(domain, domain, domain);
    const orphanUrls = inventory
      .filter((entry) => entry.inbound_count === 0 && !isRootUrl(entry.url))
      .slice(0, 200);
    const unrenderedUrls = inventory
      .filter((entry) => !entry.last_rendered_at && entry.status !== "rendered")
      .slice(0, 200);
    const brokenPages = inventory
      .filter((entry) => Number(entry.http_status || 0) >= 400)
      .slice(0, 200);

    return {
      domain,
      generatedAt: new Date().toISOString(),
      summary: {
        urlCount: inventory.length,
        renderedCount: inventory.filter((entry) => entry.status === "rendered" || entry.last_rendered_at).length,
        queuedCount: inventory.filter((entry) => entry.status === "queued").length,
        discoveredCount: inventory.filter((entry) => entry.status === "discovered").length,
        orphanCount: orphanUrls.length,
        unrenderedCount: unrenderedUrls.length,
        brokenCount: brokenPages.length,
      },
      orphanUrls,
      unrenderedUrls,
      brokenPages,
    };
  }

  return {
    close: () => db.close(),
    ensurePageRecord,
    ensureSiteRecord,
    getPage: (url) => statements.getPage.get(url),
    getPageCache,
    getSiteDiscovery,
    getSiteReport,
    getSeoReport,
    healthCheck: () => statements.healthCheck.get(),
    listPages: () => statements.listPages.all(),
    listQueuedSiteUrls,
    listSiteUrls,
    listSites: () => statements.listSites.all(),
    markCached,
    markError,
    queueDiscoveredSiteUrls,
    recordEvent,
    saveAiAnalysis,
    saveInternalSiteUrls,
    saveLinks,
    saveSiteDiscovery,
    saveSeoReport,
    updateSiteUrlStatus,
  };
}

function isRootUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.pathname === "/" && !parsed.search;
  } catch {
    return false;
  }
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((entry) => entry.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

module.exports = { createDatabase };
