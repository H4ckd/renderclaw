const puppeteer = require("puppeteer");

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
