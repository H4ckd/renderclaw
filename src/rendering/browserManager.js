const puppeteer = require("puppeteer");

// Owns the shared Chromium instance.
// RenderClaw reuses one browser for many pages to reduce startup cost, then
// recycles it after maxRenderCount to avoid slow memory growth. If you add a
// browser pool later, keep this module as the only place that launches Chrome.
function createBrowserManager(config) {
  let browser;
  let renderCount = 0;

  async function getBrowser() {
    if (browser && browser.isConnected() && renderCount < config.maxRenderCount) {
      renderCount++;
      return browser;
    }

    if (browser) {
      await browser.close().catch(() => {});
    }

    // These flags are conservative defaults for server environments. Adjust
    // here when adding Docker support or stricter sandboxing profiles.
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--disable-default-apps",
        "--disable-extensions",
      ],
    });
    renderCount = 1;
    return browser;
  }

  async function close() {
    if (browser) await browser.close().catch(() => {});
  }

  return {
    close,
    getBrowser,
    isConnected: () => Boolean(browser?.isConnected()),
  };
}

module.exports = { createBrowserManager };
