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
