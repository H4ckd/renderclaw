const assert = require("node:assert/strict");
const test = require("node:test");

const { optimizeHtml } = require("../src/rendering/seoOptimizer");

test("injects crawler metadata without changing visible body content", () => {
  const html = "<html><head></head><body><h1>Hello</h1><script>alert('x')</script></body></html>";
  const targetUrl = new URL("https://example.com/page");
  const extracted = {
    title: "Original title",
    description: "Original description",
    robots: "",
  };
  const optimized = optimizeHtml(html, targetUrl, extracted, {
    title: "AI title",
    description: "AI description",
    robots: "index,follow",
    openGraph: {
      title: "OG title",
      description: "OG description",
      image: "https://example.com/image.jpg",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "Twitter title",
      description: "Twitter description",
      image: "https://example.com/image.jpg",
    },
    jsonLd: { "@context": "https://schema.org", "@type": "WebPage" },
  });

  assert.match(optimized, /<title>AI title<\/title>/);
  assert.match(optimized, /meta name="description" content="AI description"/);
  assert.match(optimized, /meta property="og:title" content="OG title"/);
  assert.match(optimized, /application\/ld\+json/);
  assert.match(optimized, /<h1>Hello<\/h1>/);
  assert.doesNotMatch(optimized, /alert\('x'\)/);
});
