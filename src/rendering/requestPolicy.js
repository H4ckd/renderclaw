// Network policy for resources loaded inside Puppeteer.
// CSS and images are intentionally allowed so crawler snapshots preserve visual
// context and social images can be discovered. Heavy media, fonts, and common
// trackers are blocked to reduce render time and bandwidth.
const BLOCKED_HOSTS = [
  "google-analytics.com",
  "googletagmanager.com",
  "facebook.net",
  "doubleclick.net",
  "hotjar.com",
  "clarity.ms",
  "sentry.io",
];

function shouldAbortRequest(request) {
  const requestUrl = request.url();
  const resourceType = request.resourceType();
  const hostBlocked = BLOCKED_HOSTS.some((host) => requestUrl.includes(host));
  const heavyResource = resourceType === "media" || resourceType === "font";

  return hostBlocked || heavyResource;
}

module.exports = { shouldAbortRequest };
