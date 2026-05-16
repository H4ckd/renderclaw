const path = require("node:path");
const { URL } = require("node:url");

const BOT_AGENTS = [
  "googlebot", "yahoo! slurp", "bingbot", "yandex", "baiduspider",
  "facebookexternalhit", "twitterbot", "rogerbot", "linkedinbot", "embedly",
  "quora link preview", "showyoubot", "outbrain", "pinterest/0.",
  "developers.google.com/+/web/snippet", "slackbot", "vkshare",
  "w3c_validator", "redditbot", "applebot", "whatsapp", "flipboard",
  "tumblr", "bitlybot", "skypeuripreview", "nuzzel", "discordbot",
  "google page speed", "qwantify", "pinterestbot", "bitrix link preview",
  "xing-contenttabreceiver", "chrome-lighthouse", "telegrambot",
  "google-inspectiontool"
];

const IGNORE_EXTENSIONS = new Set([
  ".js", ".css", ".xml", ".less", ".png", ".jpg", ".jpeg", ".gif", ".pdf",
  ".doc", ".txt", ".ico", ".rss", ".zip", ".mp3", ".rar", ".exe", ".wmv",
  ".avi", ".ppt", ".mpg", ".mpeg", ".tif", ".wav", ".mov", ".psd",
  ".ai", ".xls", ".xlsx", ".mp4", ".m4a", ".swf", ".dat", ".dmg", ".iso",
  ".flv", ".m4v", ".torrent", ".woff", ".woff2", ".ttf", ".svg", ".webmanifest",
  ".json", ".map"
]);

function isCrawler(req) {
  const agent = String(req.headers["user-agent"] || "").toLowerCase();
  return BOT_AGENTS.some((bot) => agent.includes(bot));
}

function shouldIgnoreRequest(url) {
  const parsed = new URL(url);
  return IGNORE_EXTENSIONS.has(path.extname(parsed.pathname).toLowerCase());
}

function validateDomain(domain, allowedDomains) {
  const normalized = String(domain || "").trim().toLowerCase();

  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalized)) {
    throw new Error("Dominio non valido");
  }

  if (allowedDomains.length && !allowedDomains.includes(normalized)) {
    throw new Error("Dominio non autorizzato");
  }

  return normalized;
}

function buildTargetUrl(req, allowedDomains) {
  const domain = validateDomain(req.params.domain, allowedDomains);
  const targetPath = req.params[0] || "";
  const url = new URL(`https://${domain}/${targetPath}`);
  url.search = req._parsedUrl.search || "";
  return url;
}

module.exports = {
  buildTargetUrl,
  isCrawler,
  shouldIgnoreRequest,
};
