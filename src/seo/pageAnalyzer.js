// Deterministic SEO analyzer.
// This is intentionally separate from the AI layer: it produces explainable,
// repeatable issues and scores that can be shown in the dashboard or API.
function analyzePageSeo(targetUrl, extracted) {
  const issues = [];

  checkTitle(extracted.title, issues);
  checkDescription(extracted.description, issues);
  checkCanonical(targetUrl, extracted.canonical, issues);
  checkRobots(extracted.robots, issues);
  checkHeadings(extracted.headings || [], issues);
  checkImages(extracted.images || [], issues);
  checkSocialMetadata(extracted.social || {}, issues);
  checkStructuredData(extracted.structuredData || {}, issues);

  const score = Math.max(0, 100 - issues.reduce((total, issue) => total + issue.weight, 0));

  return {
    score,
    grade: gradeForScore(score),
    issues,
    summary: {
      titleLength: clean(extracted.title).length,
      descriptionLength: clean(extracted.description).length,
      headingCount: (extracted.headings || []).length,
      imageCount: (extracted.images || []).length,
      linkCount: (extracted.links || []).length,
      jsonLdCount: extracted.structuredData?.jsonLdCount || 0,
      validJsonLdCount: extracted.structuredData?.validJsonLdCount || 0,
      invalidJsonLdCount: extracted.structuredData?.invalidJsonLdCount || 0,
      jsonLdTypes: extracted.structuredData?.jsonLdTypes || [],
    },
  };
}

function checkTitle(title, issues) {
  const value = clean(title);
  if (!value) {
    issue(issues, "title_missing", "high", 18, "Missing title tag.");
    return;
  }

  if (value.length < 20) issue(issues, "title_too_short", "medium", 8, "Title is shorter than 20 characters.");
  if (value.length > 70) issue(issues, "title_too_long", "medium", 8, "Title is longer than 70 characters.");
}

function checkDescription(description, issues) {
  const value = clean(description);
  if (!value) {
    issue(issues, "description_missing", "high", 14, "Missing meta description.");
    return;
  }

  if (value.length < 50) {
    issue(issues, "description_too_short", "low", 5, "Meta description is shorter than 50 characters.");
  }
  if (value.length > 170) {
    issue(issues, "description_too_long", "medium", 7, "Meta description is longer than 170 characters.");
  }
}

function checkCanonical(targetUrl, canonical, issues) {
  const value = clean(canonical);
  if (!value) {
    issue(issues, "canonical_missing", "medium", 8, "Missing canonical URL.");
    return;
  }

  try {
    const canonicalUrl = new URL(value, targetUrl.href);
    if (canonicalUrl.hostname !== targetUrl.hostname) {
      issue(issues, "canonical_cross_domain", "high", 16, "Canonical points to another domain.");
      return;
    }

    if (canonicalComparable(canonicalUrl) !== canonicalComparable(targetUrl)) {
      issue(issues, "canonical_mismatch", "medium", 8, "Canonical URL does not match the rendered URL.");
    }
  } catch {
    issue(issues, "canonical_invalid", "high", 16, "Canonical URL is invalid.");
  }
}

function checkRobots(robots, issues) {
  const value = clean(robots).toLowerCase();
  if (value.includes("noindex")) {
    issue(issues, "robots_noindex", "critical", 35, "Robots directive contains noindex.");
  }
  if (value.includes("nofollow")) {
    issue(issues, "robots_nofollow", "medium", 8, "Robots directive contains nofollow.");
  }
  if (value.includes("unavailable_after")) {
    issue(issues, "robots_unavailable_after", "high", 16, "Robots directive contains unavailable_after.");
  }
}

function checkHeadings(headings, issues) {
  const h1s = headings.filter((heading) => heading.level === "h1");
  const emptyHeadings = headings.filter((heading) => !clean(heading.text));

  if (h1s.length === 0) issue(issues, "h1_missing", "medium", 10, "Missing H1 heading.");
  if (h1s.length > 1) issue(issues, "h1_multiple", "low", 4, "Multiple H1 headings found.");
  if (emptyHeadings.length > 0) issue(issues, "heading_empty", "low", 3, "One or more headings are empty.");
}

function checkImages(images, issues) {
  const withoutAlt = images.filter((image) => !clean(image.alt));
  const withoutDimensions = images.filter((image) => !image.width || !image.height);

  if (withoutAlt.length > 0) {
    issue(issues, "images_missing_alt", "low", Math.min(10, withoutAlt.length * 2), "Some images are missing alt text.");
  }
  if (withoutDimensions.length > 0) {
    issue(
      issues,
      "images_missing_dimensions",
      "low",
      Math.min(8, withoutDimensions.length),
      "Some images are missing width or height attributes."
    );
  }
}

function checkSocialMetadata(social, issues) {
  if (!clean(social.ogTitle)) issue(issues, "og_title_missing", "low", 4, "Missing og:title.");
  if (!clean(social.ogDescription)) issue(issues, "og_description_missing", "low", 4, "Missing og:description.");
  if (!clean(social.ogImage)) issue(issues, "og_image_missing", "low", 5, "Missing og:image.");
  if (!clean(social.twitterCard)) issue(issues, "twitter_card_missing", "low", 3, "Missing twitter:card.");
}

function checkStructuredData(structuredData, issues) {
  const jsonLdCount = Number(structuredData.jsonLdCount || 0);
  const invalidJsonLdCount = Number(structuredData.invalidJsonLdCount || 0);

  if (jsonLdCount === 0) {
    issue(issues, "structured_data_missing", "low", 4, "Missing JSON-LD structured data.");
    return;
  }

  if (invalidJsonLdCount > 0) {
    issue(
      issues,
      "structured_data_invalid",
      "medium",
      Math.min(12, invalidJsonLdCount * 6),
      "One or more JSON-LD blocks are invalid."
    );
  }
}

function issue(issues, code, severity, weight, message) {
  issues.push({ code, severity, weight, message });
}

function clean(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function canonicalComparable(url) {
  const clone = new URL(url.href);
  clone.hash = "";
  clone.hostname = clone.hostname.toLowerCase();
  if ((clone.protocol === "https:" && clone.port === "443") || (clone.protocol === "http:" && clone.port === "80")) {
    clone.port = "";
  }
  clone.pathname = normalizePathname(clone.pathname);
  return clone.href;
}

function normalizePathname(pathname) {
  if (pathname !== "/" && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname || "/";
}

function gradeForScore(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

module.exports = { analyzePageSeo };
