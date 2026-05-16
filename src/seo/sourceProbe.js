// Lightweight source freshness probe.
// It uses HTTP validators before expensive browser rendering when a cached
// crawler snapshot already exists.
function createSourceProbe({ fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  async function probe(targetUrl, validators = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const headers = {};

    if (validators.etag) headers["If-None-Match"] = validators.etag;
    if (validators.lastModified) headers["If-Modified-Since"] = validators.lastModified;

    try {
      const response = await fetchImpl(targetUrl.href, {
        method: "HEAD",
        headers,
        redirect: "follow",
        signal: controller.signal,
      });
      const etag = response.headers.get("etag") || "";
      const lastModified = response.headers.get("last-modified") || "";
      const status = response.status;
      const changed = didSourceChange(status, { etag, lastModified }, validators);

      return {
        checkedAt: new Date().toISOString(),
        changed,
        etag,
        error: "",
        lastModified,
        status,
      };
    } catch (error) {
      return {
        checkedAt: new Date().toISOString(),
        changed: true,
        etag: "",
        error: error.message,
        lastModified: "",
        status: null,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  return { probe };
}

function didSourceChange(status, next, previous) {
  if (status === 304) return false;
  if (status < 200 || status >= 400) return true;
  if (previous.etag && next.etag) return previous.etag !== next.etag;
  if (previous.lastModified && next.lastModified) return previous.lastModified !== next.lastModified;
  return true;
}

module.exports = { createSourceProbe, didSourceChange };
