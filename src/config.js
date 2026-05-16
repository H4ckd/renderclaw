const fs = require("node:fs");
const path = require("node:path");

// Central configuration loader.
// Order of precedence:
// 1. config/renderclaw.config.json (required, committed defaults)
// 2. config/renderclaw.local.json (optional, ignored by Git)
// 3. environment variables (highest priority for production/secrets)
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

function validateConfig(runtimeConfig) {
  const errors = [];

  if (!runtimeConfig.appName) errors.push("app.name is required");
  if (!runtimeConfig.appSlug) errors.push("app.slug is required");
  if (!Number.isInteger(runtimeConfig.port) || runtimeConfig.port < 1 || runtimeConfig.port > 65535) {
    errors.push("server.port must be a valid TCP port");
  }
  if (!runtimeConfig.dataDir) errors.push("server.dataDir is required");
  if (!Number.isInteger(runtimeConfig.concurrency) || runtimeConfig.concurrency < 1) {
    errors.push("rendering.concurrency must be >= 1");
  }
  if (!Number.isInteger(runtimeConfig.maxQueueSize) || runtimeConfig.maxQueueSize < 0) {
    errors.push("rendering.maxQueueSize must be >= 0");
  }
  if (!Number.isInteger(runtimeConfig.maxRenderCount) || runtimeConfig.maxRenderCount < 1) {
    errors.push("rendering.maxRenderCount must be >= 1");
  }
  if (!Number.isInteger(runtimeConfig.pageTimeoutMs) || runtimeConfig.pageTimeoutMs < 1000) {
    errors.push("rendering.pageTimeoutMs must be >= 1000");
  }
  if (!Number.isInteger(runtimeConfig.maxHtmlBytes) || runtimeConfig.maxHtmlBytes < 1024) {
    errors.push("rendering.maxHtmlBytes must be >= 1024");
  }
  if (!Number.isInteger(runtimeConfig.cacheTtlMs) || runtimeConfig.cacheTtlMs < 1000) {
    errors.push("cache.ttlSeconds must be >= 1");
  }
  if (!Number.isInteger(runtimeConfig.staleTtlMs) || runtimeConfig.staleTtlMs < 0) {
    errors.push("cache.staleTtlSeconds must be >= 0");
  }
  if (!Number.isInteger(runtimeConfig.sourceProbeTimeoutMs) || runtimeConfig.sourceProbeTimeoutMs < 500) {
    errors.push("cache.sourceProbeTimeoutMs must be >= 500");
  }
  for (const [index, rule] of runtimeConfig.cacheRules.entries()) {
    if (rule.ttlSeconds !== undefined && (!Number.isInteger(rule.ttlSeconds) || rule.ttlSeconds < 1)) {
      errors.push(`cache.rules[${index}].ttlSeconds must be >= 1`);
    }
    if (
      rule.staleTtlSeconds !== undefined &&
      (!Number.isInteger(rule.staleTtlSeconds) || rule.staleTtlSeconds < 0)
    ) {
      errors.push(`cache.rules[${index}].staleTtlSeconds must be >= 0`);
    }
    if (rule.pathPattern) {
      try {
        new RegExp(rule.pathPattern);
      } catch (_error) {
        errors.push(`cache.rules[${index}].pathPattern must be a valid regular expression`);
      }
    }
  }
  if (runtimeConfig.rateLimit.enabled) {
    if (!Number.isInteger(runtimeConfig.rateLimit.windowMs) || runtimeConfig.rateLimit.windowMs < 1000) {
      errors.push("rateLimit.windowMs must be >= 1000");
    }
    if (!Number.isInteger(runtimeConfig.rateLimit.maxRequestsPerIp) || runtimeConfig.rateLimit.maxRequestsPerIp < 1) {
      errors.push("rateLimit.maxRequestsPerIp must be >= 1");
    }
    if (!Number.isInteger(runtimeConfig.rateLimit.maxRequestsPerDomain) || runtimeConfig.rateLimit.maxRequestsPerDomain < 1) {
      errors.push("rateLimit.maxRequestsPerDomain must be >= 1");
    }
  }
  if (!Number.isInteger(runtimeConfig.crawl.maxQueueBatch) || runtimeConfig.crawl.maxQueueBatch < 1) {
    errors.push("crawl.maxQueueBatch must be >= 1");
  }
  if (!Number.isInteger(runtimeConfig.crawl.maxRenderBatch) || runtimeConfig.crawl.maxRenderBatch < 1) {
    errors.push("crawl.maxRenderBatch must be >= 1");
  }
  if (!Number.isInteger(runtimeConfig.crawl.maxDepth) || runtimeConfig.crawl.maxDepth < 0) {
    errors.push("crawl.maxDepth must be >= 0");
  }
  if (!Number.isInteger(runtimeConfig.crawl.maxRedirectBatch) || runtimeConfig.crawl.maxRedirectBatch < 1) {
    errors.push("crawl.maxRedirectBatch must be >= 1");
  }
  if (!Number.isInteger(runtimeConfig.crawl.maxRedirectHops) || runtimeConfig.crawl.maxRedirectHops < 0) {
    errors.push("crawl.maxRedirectHops must be >= 0");
  }
  if (runtimeConfig.isProduction && runtimeConfig.allowedDomains.length === 0) {
    errors.push("ALLOWED_DOMAINS is required when NODE_ENV=production");
  }
  if (runtimeConfig.isProduction && !runtimeConfig.adminToken) {
    errors.push("ADMIN_TOKEN is required when NODE_ENV=production");
  }

  if (errors.length) {
    throw new Error(`Invalid RenderClaw configuration:\n- ${errors.join("\n- ")}`);
  }
}

const configFilePath = path.resolve(process.env.CONFIG_FILE || DEFAULT_CONFIG_FILE);
const fileConfig = deepMerge(
  loadConfigFile(configFilePath, true),
  loadConfigFile(LOCAL_CONFIG_FILE)
);

// Flatten the JSON config into the runtime shape used by the rest of the app.
// Add new public config here only after adding it to config/renderclaw.config.json.
const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  appName: fileConfig.app.name,
  appSlug: fileConfig.app.slug,
  port: numberFromEnv("PORT", fileConfig.server.port),
  dataDir: path.resolve(stringFromEnv("DATA_DIR", fileConfig.server.dataDir)),
  cacheTtlMs: numberFromEnv("CACHE_TTL_SECONDS", fileConfig.cache.ttlSeconds) * 1000,
  staleTtlMs: numberFromEnv("STALE_TTL_SECONDS", fileConfig.cache.staleTtlSeconds) * 1000,
  sourceProbeTimeoutMs: numberFromEnv("SOURCE_PROBE_TIMEOUT_MS", fileConfig.cache.sourceProbeTimeoutMs || 5000),
  cacheRules: fileConfig.cache.rules || [],
  concurrency: numberFromEnv("RENDER_CONCURRENCY", fileConfig.rendering.concurrency),
  maxQueueSize: numberFromEnv("MAX_QUEUE_SIZE", fileConfig.rendering.maxQueueSize),
  maxRenderCount: numberFromEnv("MAX_RENDER_COUNT", fileConfig.rendering.maxRenderCount),
  pageTimeoutMs: numberFromEnv("PAGE_TIMEOUT_MS", fileConfig.rendering.pageTimeoutMs),
  extraWaitMs: numberFromEnv("EXTRA_WAIT_MS", fileConfig.rendering.extraWaitMs),
  maxHtmlBytes: numberFromEnv("MAX_HTML_BYTES", fileConfig.rendering.maxHtmlBytes),
  allowedDomains: parseList(process.env.ALLOWED_DOMAINS || fileConfig.server.allowedDomains),
  adminToken: process.env[fileConfig.server.adminTokenEnv || "ADMIN_TOKEN"] || "",
  rateLimit: {
    enabled: booleanFromEnv("RATE_LIMIT_ENABLED", fileConfig.rateLimit.enabled),
    windowMs: numberFromEnv("RATE_LIMIT_WINDOW_MS", fileConfig.rateLimit.windowMs),
    maxRequestsPerIp: numberFromEnv("RATE_LIMIT_MAX_REQUESTS_PER_IP", fileConfig.rateLimit.maxRequestsPerIp),
    maxRequestsPerDomain: numberFromEnv(
      "RATE_LIMIT_MAX_REQUESTS_PER_DOMAIN",
      fileConfig.rateLimit.maxRequestsPerDomain
    ),
  },
  crawl: {
    maxQueueBatch: numberFromEnv("CRAWL_MAX_QUEUE_BATCH", fileConfig.crawl?.maxQueueBatch || 50),
    maxRenderBatch: numberFromEnv("CRAWL_MAX_RENDER_BATCH", fileConfig.crawl?.maxRenderBatch || 5),
    maxDepth: numberFromEnv("CRAWL_MAX_DEPTH", fileConfig.crawl?.maxDepth || 2),
    maxRedirectBatch: numberFromEnv("CRAWL_MAX_REDIRECT_BATCH", fileConfig.crawl?.maxRedirectBatch || 25),
    maxRedirectHops: numberFromEnv("CRAWL_MAX_REDIRECT_HOPS", fileConfig.crawl?.maxRedirectHops || 5),
  },
  ai: {
    enabled: booleanFromEnv("AI_ENABLED", fileConfig.ai.enabled),
    provider: stringFromEnv("AI_PROVIDER", fileConfig.ai.provider),
    apiKey: process.env[fileConfig.ai.apiKeyEnv || "OPENAI_API_KEY"] || "",
    model: stringFromEnv("OPENAI_MODEL", fileConfig.ai.model),
    timeoutMs: numberFromEnv("AI_TIMEOUT_MS", fileConfig.ai.timeoutMs),
  },
};
config.isProduction = config.nodeEnv === "production";

validateConfig(config);

// Runtime paths are derived from dataDir so deployments can move all mutable
// files by changing DATA_DIR or server.dataDir in the config file.
const paths = {
  cacheDir: path.join(config.dataDir, "cache"),
  logDir: path.join(config.dataDir, "logs"),
  db: path.join(config.dataDir, `${config.appSlug}.sqlite`),
};

module.exports = { config, fileConfig, paths };
