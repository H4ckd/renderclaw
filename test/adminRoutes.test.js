const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { registerAdminRoutes } = require("../src/http/adminRoutes");

test("refreshes one crawler cache variant through the admin route", async () => {
  const calls = [];
  const pageStore = {
    ensurePageRecord(targetUrl) {
      calls.push({ type: "ensure", url: targetUrl.href });
      return { id: 1, url: targetUrl.href };
    },
    updateSiteUrlStatus(domain, url, status) {
      calls.push({ type: "status", domain, url, status });
    },
  };
  const crawlRunner = {
    async render(targetUrl, pageRecord, crawlerProfile, requestId) {
      calls.push({
        type: "render",
        url: targetUrl.href,
        pageId: pageRecord.id,
        crawlerProfile: crawlerProfile.id,
        requestId,
      });
      return { id: pageRecord.id, url: targetUrl.href, status: "cached" };
    },
  };

  const app = createAdminApp(pageStore, crawlRunner);
  const server = await listen(app);

  try {
    const response = await fetch(
      `${server.url}/admin/cache/refresh?url=${encodeURIComponent("https://example.com/page")}&crawler=bing`,
      { method: "POST", headers: { "x-request-id": "test-refresh" } }
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.url, "https://example.com/page");
    assert.equal(body.crawlerProfile, "bing");
    assert.equal(body.status, "refreshed");
    assert.equal(body.page.status, "cached");
    assert.deepEqual(calls, [
      { type: "ensure", url: "https://example.com/page" },
      {
        type: "status",
        domain: "example.com",
        url: "https://example.com/page",
        status: "rendering",
      },
      {
        type: "render",
        url: "https://example.com/page",
        pageId: 1,
        crawlerProfile: "bing",
        requestId: undefined,
      },
      {
        type: "status",
        domain: "example.com",
        url: "https://example.com/page",
        status: "rendered",
      },
    ]);
  } finally {
    await server.close();
  }
});

test("rejects admin cache refresh requests without a URL", async () => {
  const app = createAdminApp({
    ensurePageRecord() {
      throw new Error("should not render without URL");
    },
    updateSiteUrlStatus() {},
  }, {
    render() {
      throw new Error("should not render without URL");
    },
  });
  const server = await listen(app);

  try {
    const response = await fetch(`${server.url}/admin/cache/refresh`, { method: "POST" });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, "Missing url query parameter");
  } finally {
    await server.close();
  }
});

test("adds cache status variants to admin pages", async () => {
  const pageStore = {
    listPages() {
      return [{ id: 7, url: "https://example.com/page" }];
    },
  };
  const app = createAdminApp(pageStore, { render() {} }, {
    inspectPage(pageId) {
      return [{ pageId, crawlerProfile: "google", status: "fresh" }];
    },
  });
  const server = await listen(app);

  try {
    const response = await fetch(`${server.url}/admin/pages`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.pages[0].cacheVariants, [
      { pageId: 7, crawlerProfile: "google", status: "fresh" },
    ]);
  } finally {
    await server.close();
  }
});

test("returns cache status variants for one admin page", async () => {
  const app = createAdminApp({}, { render() {} }, {
    inspectPage(pageId) {
      return [{ pageId, crawlerProfile: "social", status: "stale" }];
    },
  });
  const server = await listen(app);

  try {
    const response = await fetch(`${server.url}/admin/pages/3/cache`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.cacheVariants, [
      { pageId: 3, crawlerProfile: "social", status: "stale" },
    ]);
  } finally {
    await server.close();
  }
});

function createAdminApp(pageStore, crawlRunner, cacheMaintenance = null) {
  const app = express();
  registerAdminRoutes(
    app,
    pageStore,
    (_req, _res, next) => next(),
    { discover: async () => ({}) },
    {},
    crawlRunner,
    null,
    cacheMaintenance
  );
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
