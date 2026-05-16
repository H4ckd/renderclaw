// Runs inside the rendered page and extracts signals used by storage and AI.
// Keep this extractor bounded: every collection is sliced to avoid storing or
// sending huge pages to the AI provider. Add new SEO signals here when they are
// needed by the optimizer or dashboard.
async function extractPageData(tab) {
  return tab.evaluate(() => {
    const absoluteUrl = (value) => {
      try {
        return value ? new URL(value, window.location.href).href : "";
      } catch {
        return "";
      }
    };

    const links = [...document.querySelectorAll("a[href]")].slice(0, 500).map((link) => ({
      href: absoluteUrl(link.getAttribute("href")),
      text: (link.textContent || "").trim().replace(/\s+/g, " ").slice(0, 240),
      rel: link.getAttribute("rel") || "",
    })).filter((link) => link.href && !link.href.startsWith("javascript:"));

    const headings = [...document.querySelectorAll("h1, h2, h3")].slice(0, 40).map((heading) => ({
      level: heading.tagName.toLowerCase(),
      text: (heading.textContent || "").trim().replace(/\s+/g, " ").slice(0, 180),
    }));

    const images = [...document.querySelectorAll("img")].slice(0, 30).map((image) => ({
      src: absoluteUrl(image.getAttribute("src") || image.getAttribute("data-src") || ""),
      alt: (image.getAttribute("alt") || "").trim().replace(/\s+/g, " ").slice(0, 180),
      width: image.getAttribute("width") || "",
      height: image.getAttribute("height") || "",
    })).filter((image) => image.src);

    const social = {
      ogTitle: document.querySelector("meta[property='og:title']")?.getAttribute("content") || "",
      ogDescription: document.querySelector("meta[property='og:description']")?.getAttribute("content") || "",
      ogImage: document.querySelector("meta[property='og:image']")?.getAttribute("content") || "",
      twitterCard: document.querySelector("meta[name='twitter:card']")?.getAttribute("content") || "",
      twitterTitle: document.querySelector("meta[name='twitter:title']")?.getAttribute("content") || "",
      twitterDescription: document.querySelector("meta[name='twitter:description']")?.getAttribute("content") || "",
      twitterImage: document.querySelector("meta[name='twitter:image']")?.getAttribute("content") || "",
    };

    const jsonLdScripts = [...document.querySelectorAll("script[type='application/ld+json']")].slice(0, 20);
    const jsonLd = jsonLdScripts.map((script) => {
      const raw = (script.textContent || "").trim();
      const result = { valid: false, type: "", rawLength: raw.length, error: "" };

      if (!raw) {
        result.error = "empty_json_ld";
        return result;
      }

      try {
        const parsed = JSON.parse(raw);
        result.valid = true;
        result.type = getSchemaType(parsed);
        return result;
      } catch (error) {
        result.error = error.message.slice(0, 160);
        return result;
      }
    });

    const jsonLdTypes = [...new Set(jsonLd.map((entry) => entry.type).filter(Boolean))].slice(0, 20);
    const structuredData = {
      jsonLdCount: jsonLd.length,
      validJsonLdCount: jsonLd.filter((entry) => entry.valid).length,
      invalidJsonLdCount: jsonLd.filter((entry) => !entry.valid).length,
      jsonLdTypes,
      jsonLd,
    };

    function getSchemaType(value) {
      if (Array.isArray(value)) {
        return value.map((item) => getSchemaType(item)).filter(Boolean).join(",").slice(0, 160);
      }

      if (!value || typeof value !== "object") return "";
      if (typeof value["@type"] === "string") return value["@type"].slice(0, 80);
      if (Array.isArray(value["@type"])) return value["@type"].join(",").slice(0, 160);
      if (Array.isArray(value["@graph"])) {
        return value["@graph"].map((item) => getSchemaType(item)).filter(Boolean).join(",").slice(0, 160);
      }

      return "";
    }

    return {
      title: document.title || "",
      description: document.querySelector("meta[name='description']")?.getAttribute("content") || "",
      canonical: document.querySelector("link[rel='canonical']")?.getAttribute("href") || "",
      robots: document.querySelector("meta[name='robots']")?.getAttribute("content") || "",
      headings,
      images,
      links,
      social,
      structuredData,
    };
  });
}

module.exports = { extractPageData };
