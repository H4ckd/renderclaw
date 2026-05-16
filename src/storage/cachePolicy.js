// Cache policy resolver.
// Rules are evaluated in order and can target a domain and/or a URL path
// pattern. The first matching rule overrides the global cache freshness window.
function createCachePolicy({ defaultTtlMs, defaultStaleTtlMs, rules = [] }) {
  const compiledRules = rules.map((rule, index) => ({
    id: rule.id || `rule-${index + 1}`,
    domain: normalizeDomain(rule.domain || ""),
    pathPattern: rule.pathPattern || "",
    pathRegex: rule.pathPattern ? new RegExp(rule.pathPattern) : null,
    ttlMs: secondsToMs(rule.ttlSeconds, defaultTtlMs),
    staleTtlMs: secondsToMs(rule.staleTtlSeconds, defaultStaleTtlMs),
  }));

  function resolve(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_error) {
      return {
        ttlMs: defaultTtlMs,
        staleTtlMs: defaultStaleTtlMs,
        ruleId: "default",
      };
    }

    const path = `${parsed.pathname}${parsed.search}`;
    const hostname = parsed.hostname.toLowerCase();
    const match = compiledRules.find((rule) => (
      domainMatches(rule.domain, hostname) &&
      (!rule.pathRegex || rule.pathRegex.test(path))
    ));

    return {
      ttlMs: match ? match.ttlMs : defaultTtlMs,
      staleTtlMs: match ? match.staleTtlMs : defaultStaleTtlMs,
      ruleId: match ? match.id : "default",
    };
  }

  return { resolve };
}

function secondsToMs(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) * 1000 : fallback;
}

function normalizeDomain(domain) {
  return String(domain || "").trim().toLowerCase();
}

function domainMatches(ruleDomain, hostname) {
  if (!ruleDomain) return true;
  if (ruleDomain.startsWith("*.")) {
    const root = ruleDomain.slice(2);
    return hostname === root || hostname.endsWith(`.${root}`);
  }
  return hostname === ruleDomain;
}

module.exports = { createCachePolicy };
