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
    })).filter((heading) => heading.text);

    const images = [...document.querySelectorAll("img")].slice(0, 30).map((image) => ({
      src: absoluteUrl(image.getAttribute("src") || image.getAttribute("data-src") || ""),
      alt: (image.getAttribute("alt") || "").trim().replace(/\s+/g, " ").slice(0, 180),
      width: image.getAttribute("width") || "",
      height: image.getAttribute("height") || "",
    })).filter((image) => image.src);

    return {
      title: document.title || "",
      description: document.querySelector("meta[name='description']")?.getAttribute("content") || "",
      canonical: document.querySelector("link[rel='canonical']")?.getAttribute("href") || "",
      robots: document.querySelector("meta[name='robots']")?.getAttribute("content") || "",
      headings,
      images,
      links,
    };
  });
}

module.exports = { extractPageData };
