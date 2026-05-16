const assert = require("node:assert/strict");
const test = require("node:test");

const { analyzePageSeo } = require("../src/seo/pageAnalyzer");

test("returns a high score for complete page signals", () => {
  const report = analyzePageSeo(new URL("https://example.com/page"), {
    title: "A complete and useful title for this page",
    description: "This is a complete meta description that explains the page with enough useful detail.",
    canonical: "https://example.com/page",
    robots: "index,follow",
    headings: [{ level: "h1", text: "Main heading" }],
    images: [{ src: "https://example.com/image.jpg", alt: "Example image", width: "1200", height: "630" }],
    links: [{ href: "https://example.com/next", text: "Next" }],
    social: {
      ogTitle: "Open Graph title",
      ogDescription: "Open Graph description",
      ogImage: "https://example.com/image.jpg",
      twitterCard: "summary_large_image",
    },
    structuredData: {
      jsonLdCount: 1,
      validJsonLdCount: 1,
      invalidJsonLdCount: 0,
      jsonLdTypes: ["WebPage"],
    },
  });

  assert.equal(report.grade, "A");
  assert.equal(report.issues.length, 0);
  assert.equal(report.summary.validJsonLdCount, 1);
});

test("flags missing critical SEO signals", () => {
  const report = analyzePageSeo(new URL("https://example.com/page"), {
    title: "",
    description: "",
    canonical: "https://other.example/page",
    robots: "noindex,nofollow",
    headings: [],
    images: [{ src: "https://example.com/image.jpg", alt: "", width: "", height: "" }],
    links: [],
    social: {},
    structuredData: { jsonLdCount: 0, validJsonLdCount: 0, invalidJsonLdCount: 0, jsonLdTypes: [] },
  });

  const codes = report.issues.map((issue) => issue.code);
  assert.ok(report.score < 50);
  assert.ok(codes.includes("title_missing"));
  assert.ok(codes.includes("description_missing"));
  assert.ok(codes.includes("canonical_cross_domain"));
  assert.ok(codes.includes("robots_noindex"));
  assert.ok(codes.includes("h1_missing"));
  assert.ok(codes.includes("images_missing_alt"));
  assert.ok(codes.includes("structured_data_missing"));
});

test("flags canonical mismatch, unavailable_after, empty headings, and invalid JSON-LD", () => {
  const report = analyzePageSeo(new URL("https://example.com/page"), {
    title: "A complete and useful title for this page",
    description: "This is a complete meta description that explains the page with enough useful detail.",
    canonical: "https://example.com/other-page",
    robots: "index, follow, unavailable_after: 25 Jun 2026 15:00:00 PST",
    headings: [
      { level: "h1", text: "Main heading" },
      { level: "h2", text: "" },
    ],
    images: [{ src: "https://example.com/image.jpg", alt: "Example image", width: "1200", height: "630" }],
    links: [],
    social: {
      ogTitle: "Open Graph title",
      ogDescription: "Open Graph description",
      ogImage: "https://example.com/image.jpg",
      twitterCard: "summary_large_image",
    },
    structuredData: {
      jsonLdCount: 2,
      validJsonLdCount: 1,
      invalidJsonLdCount: 1,
      jsonLdTypes: ["WebPage"],
    },
  });

  const codes = report.issues.map((issue) => issue.code);
  assert.ok(codes.includes("canonical_mismatch"));
  assert.ok(codes.includes("robots_unavailable_after"));
  assert.ok(codes.includes("heading_empty"));
  assert.ok(codes.includes("structured_data_invalid"));
});
