// HTML optimizer for crawler-facing snapshots.
// It only changes metadata and structured-data surfaces; it should not rewrite
// visible page content or invent facts. AI recommendations are optional and
// fall back to values extracted from the rendered page.
function optimizeHtml(html, targetUrl, extracted, aiRecommendations = {}) {
  // Remove normal scripts from crawler snapshots to keep the output stable and
  // fast. JSON-LD is preserved because it is valuable structured data.
  let output = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, (script) => {
    return /application\/ld\+json/i.test(script) ? script : "";
  });

  const title = aiRecommendations.title || extracted.title || "";
  const description = aiRecommendations.description || extracted.description || "";
  const robots = aiRecommendations.robots || extracted.robots || "index,follow";
  const canonical = aiRecommendations.canonical || targetUrl.href;

  if (title) {
    output = upsertTitle(output, title);
  }

  if (!/<meta\s+name=["']robots["']/i.test(output)) {
    output = output.replace(
      /<head[^>]*>/i,
      (head) => `${head}\n<meta name="robots" content="${escapeHtml(robots)}">`
    );
  }

  if (description && !/<meta\s+name=["']description["']/i.test(output)) {
    output = output.replace(
      /<head[^>]*>/i,
      (head) => `${head}\n<meta name="description" content="${escapeHtml(description)}">`
    );
  }

  if (!/<link\s+[^>]*rel=["']canonical["']/i.test(output)) {
    output = output.replace(
      /<head[^>]*>/i,
      (head) => `${head}\n<link rel="canonical" href="${escapeHtml(canonical)}">`
    );
  }

  output = injectCrawlerMetadata(output, targetUrl, {
    title,
    description,
    canonical,
    openGraph: aiRecommendations.openGraph,
    twitter: aiRecommendations.twitter,
    jsonLd: aiRecommendations.jsonLd,
  });

  return output;
}

function normalizeAbsolute(baseUrl, value) {
  if (!value) return "";
  try {
    return new URL(value, baseUrl.href).href;
  } catch {
    return "";
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function upsertTitle(html, title) {
  if (/<title\b[^>]*>[\s\S]*?<\/title>/i.test(html)) {
    return html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  }

  return html.replace(/<head[^>]*>/i, (head) => `${head}\n<title>${escapeHtml(title)}</title>`);
}

function injectCrawlerMetadata(html, targetUrl, metadata) {
  const tags = [];
  const image = metadata.openGraph?.image || metadata.twitter?.image || "";

  tags.push(metaProperty("og:url", metadata.canonical || targetUrl.href));
  tags.push(metaProperty("og:title", metadata.openGraph?.title || metadata.title));
  tags.push(metaProperty("og:description", metadata.openGraph?.description || metadata.description));
  tags.push(metaProperty("og:type", metadata.openGraph?.type || "website"));
  if (image) tags.push(metaProperty("og:image", image));

  tags.push(metaName("twitter:card", metadata.twitter?.card || "summary_large_image"));
  tags.push(metaName("twitter:title", metadata.twitter?.title || metadata.title));
  tags.push(metaName("twitter:description", metadata.twitter?.description || metadata.description));
  if (image) tags.push(metaName("twitter:image", image));

  // JSON-LD is escaped before injection so a generated value cannot break out
  // of the script tag with a literal "<" character.
  if (metadata.jsonLd && Object.keys(metadata.jsonLd).length) {
    tags.push(`<script type="application/ld+json">${escapeScriptJson(metadata.jsonLd)}</script>`);
  }

  const block = tags.filter(Boolean).join("\n");
  if (!block) return html;

  return html.replace(/<head[^>]*>/i, (head) => `${head}\n${block}`);
}

function metaName(name, content) {
  if (!content) return "";
  return `<meta name="${escapeHtml(name)}" content="${escapeHtml(content)}">`;
}

function metaProperty(property, content) {
  if (!content) return "";
  return `<meta property="${escapeHtml(property)}" content="${escapeHtml(content)}">`;
}

function escapeScriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

module.exports = {
  normalizeAbsolute,
  optimizeHtml,
};
