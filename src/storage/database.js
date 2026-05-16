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
  `);

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
    listSites: db.prepare("SELECT * FROM sites ORDER BY last_seen_at DESC"),
    listPages: db.prepare(`
      SELECT pages.*, sites.domain
      FROM pages
      JOIN sites ON sites.id = pages.site_id
      ORDER BY COALESCE(last_rendered_at, '1970-01-01') DESC
      LIMIT 200
    `),
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

  return {
    close: () => db.close(),
    ensurePageRecord,
    getPage: (url) => statements.getPage.get(url),
    getPageCache,
    listPages: () => statements.listPages.all(),
    listSites: () => statements.listSites.all(),
    markCached,
    markError,
    recordEvent,
    saveAiAnalysis,
    saveLinks,
  };
}

module.exports = { createDatabase };
