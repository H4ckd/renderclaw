const DEFAULT_MAX_HOPS = 5;

// Checks redirect chains without rendering pages. It uses HEAD first to keep
// payloads small and follows redirects manually so every hop can be stored.
function createRedirectAnalyzer({ fetchImpl = globalThis.fetch, maxHops = DEFAULT_MAX_HOPS } = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for redirect analysis.");
  }

  async function analyze(url) {
    const chain = [];
    let currentUrl = normalizeHttpUrl(url);

    for (let hop = 0; hop <= maxHops; hop++) {
      const response = await fetchHead(currentUrl, fetchImpl);
      const location = response.headers?.get?.("location") || "";
      const nextUrl = location ? resolveRedirect(currentUrl, location) : "";

      chain.push({
        url: currentUrl,
        status: response.status,
        location: nextUrl,
      });

      if (!isRedirectStatus(response.status) || !nextUrl) {
        return summarizeChain(url, chain, "");
      }

      currentUrl = nextUrl;
    }

    return summarizeChain(url, chain, "redirect_chain_too_long");
  }

  return { analyze };
}

async function fetchHead(url, fetchImpl) {
  try {
    return await fetchImpl(url, {
      method: "HEAD",
      redirect: "manual",
      headers: {
        "User-Agent": "RenderClaw redirect analyzer (+https://github.com/H4ckd/renderclaw)",
        Accept: "*/*",
      },
    });
  } catch (error) {
    return {
      status: 0,
      headers: new Map(),
      error: error.message,
    };
  }
}

function summarizeChain(inputUrl, chain, error) {
  const finalHop = chain[chain.length - 1] || { url: inputUrl, status: 0 };
  const redirectHops = chain.filter((hop) => isRedirectStatus(hop.status)).length;

  return {
    url: normalizeHttpUrl(inputUrl),
    finalUrl: finalHop.url,
    finalStatus: finalHop.status,
    hopCount: redirectHops,
    hasRedirect: redirectHops > 0,
    chain,
    error: error || finalHop.error || "",
    checkedAt: new Date().toISOString(),
  };
}

function resolveRedirect(currentUrl, location) {
  try {
    return new URL(location, currentUrl).href;
  } catch {
    return "";
  }
}

function normalizeHttpUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Redirect analysis only supports HTTP URLs.");
  }
  return parsed.href;
}

function isRedirectStatus(status) {
  return [301, 302, 303, 307, 308].includes(Number(status));
}

module.exports = {
  createRedirectAnalyzer,
  isRedirectStatus,
};
