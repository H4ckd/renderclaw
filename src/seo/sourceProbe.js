const crypto = require("node:crypto");

// Lightweight source freshness probe.
// It uses HTTP validators before expensive browser rendering when a cached
// crawler snapshot already exists.
function createSourceProbe({ fetchImpl = fetch, maxHashBytes = 262144, timeoutMs = 5000 } = {}) {
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
      const shouldHash = shouldHashCompare(status, { etag, lastModified }, validators);

      if (shouldHash) {
        const snapshot = await snapshotSource(targetUrl);
        return {
          ...snapshot,
          changed: validators.hash ? snapshot.hash !== validators.hash : true,
        };
      }

      return {
        checkedAt: new Date().toISOString(),
        changed,
        etag,
        error: "",
        hash: "",
        lastModified,
        status,
      };
    } catch (error) {
      return {
        checkedAt: new Date().toISOString(),
        changed: true,
        etag: "",
        error: error.message,
        hash: "",
        lastModified: "",
        status: null,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function snapshotSource(targetUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(targetUrl.href, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
      });
      const hash = await hashResponse(response, maxHashBytes);

      return {
        checkedAt: new Date().toISOString(),
        changed: true,
        etag: response.headers.get("etag") || "",
        error: "",
        hash,
        lastModified: response.headers.get("last-modified") || "",
        status: response.status,
      };
    } catch (error) {
      return {
        checkedAt: new Date().toISOString(),
        changed: true,
        etag: "",
        error: error.message,
        hash: "",
        lastModified: "",
        status: null,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  return { probe, snapshotSource };
}

function didSourceChange(status, next, previous) {
  if (status === 304) return false;
  if (status < 200 || status >= 400) return true;
  if (previous.etag && next.etag) return previous.etag !== next.etag;
  if (previous.lastModified && next.lastModified) return previous.lastModified !== next.lastModified;
  return true;
}

function shouldHashCompare(status, next, previous) {
  if (!previous.hash) return false;
  if (status === 304 || status < 200 || status >= 400) return false;
  if (previous.etag && next.etag) return false;
  if (previous.lastModified && next.lastModified) return false;
  return true;
}

async function hashResponse(response, maxHashBytes) {
  const hash = crypto.createHash("sha256");
  let remaining = maxHashBytes;

  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    hash.update(buffer.subarray(0, maxHashBytes));
    return hash.digest("hex");
  }

  const reader = response.body.getReader();
  try {
    while (remaining > 0) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = Buffer.from(value);
      hash.update(chunk.subarray(0, remaining));
      remaining -= Math.min(remaining, chunk.length);
      if (remaining <= 0) await reader.cancel().catch(() => {});
    }
  } finally {
    reader.releaseLock();
  }

  return hash.digest("hex");
}

module.exports = { createSourceProbe, didSourceChange, shouldHashCompare };
