const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_CONFIG_FILE = path.resolve("config", "renderclaw.config.json");
const LOCAL_CONFIG_FILE = path.resolve("config", "renderclaw.local.json");

function loadConfigFile(filePath, required = false) {
  if (!fs.existsSync(filePath)) {
    if (required) throw new Error(`Config file not found: ${filePath}`);
    return {};
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function deepMerge(base, override) {
  const output = { ...base };

  for (const [key, value] of Object.entries(override || {})) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = deepMerge(output[key], value);
      continue;
    }

    output[key] = value;
  }

  return output;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  return String(value).split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function numberFromEnv(name, fallback) {
  return process.env[name] ? Number(process.env[name]) : fallback;
}

function stringFromEnv(name, fallback) {
  return process.env[name] || fallback;
}

function booleanFromEnv(name, fallback) {
  if (process.env[name] === "true") return true;
  if (process.env[name] === "false") return false;
  return fallback;
}

const configFilePath = path.resolve(process.env.CONFIG_FILE || DEFAULT_CONFIG_FILE);
const fileConfig = deepMerge(
  loadConfigFile(configFilePath, true),
  loadConfigFile(LOCAL_CONFIG_FILE)
);

const config = {
  appName: fileConfig.app.name,
  appSlug: fileConfig.app.slug,
  port: numberFromEnv("PORT", fileConfig.server.port),
  dataDir: path.resolve(stringFromEnv("DATA_DIR", fileConfig.server.dataDir)),
  cacheTtlMs: numberFromEnv("CACHE_TTL_SECONDS", fileConfig.cache.ttlSeconds) * 1000,
  staleTtlMs: numberFromEnv("STALE_TTL_SECONDS", fileConfig.cache.staleTtlSeconds) * 1000,
  concurrency: numberFromEnv("RENDER_CONCURRENCY", fileConfig.rendering.concurrency),
  maxRenderCount: numberFromEnv("MAX_RENDER_COUNT", fileConfig.rendering.maxRenderCount),
  pageTimeoutMs: numberFromEnv("PAGE_TIMEOUT_MS", fileConfig.rendering.pageTimeoutMs),
  extraWaitMs: numberFromEnv("EXTRA_WAIT_MS", fileConfig.rendering.extraWaitMs),
  maxHtmlBytes: numberFromEnv("MAX_HTML_BYTES", fileConfig.rendering.maxHtmlBytes),
  allowedDomains: parseList(process.env.ALLOWED_DOMAINS || fileConfig.server.allowedDomains),
  ai: {
    enabled: booleanFromEnv("AI_ENABLED", fileConfig.ai.enabled),
    provider: stringFromEnv("AI_PROVIDER", fileConfig.ai.provider),
    apiKey: process.env[fileConfig.ai.apiKeyEnv || "OPENAI_API_KEY"] || "",
    model: stringFromEnv("OPENAI_MODEL", fileConfig.ai.model),
    timeoutMs: numberFromEnv("AI_TIMEOUT_MS", fileConfig.ai.timeoutMs),
  },
};

const paths = {
  cacheDir: path.join(config.dataDir, "cache"),
  logDir: path.join(config.dataDir, "logs"),
  db: path.join(config.dataDir, `${config.appSlug}.sqlite`),
};

module.exports = { config, fileConfig, paths };
