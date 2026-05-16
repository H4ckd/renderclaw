// Common response headers for crawler-facing HTML.
// X-Prerender-* headers are useful for debugging cache behavior from curl,
// logs, reverse proxies, and future dashboard tooling.
function setSeoHeaders(res, state, page) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Prerendered", "true");
  res.setHeader("X-Prerender-Cache", state);
  if (page?.last_rendered_at) res.setHeader("X-Prerender-Rendered-At", page.last_rendered_at);
}

module.exports = { setSeoHeaders };
