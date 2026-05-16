// AI SEO analysis client.
// The public contract is analyze({ targetUrl, crawlerProfile, extracted }).
// Swap or extend this module to support additional providers while keeping the
// returned analysis shape stable for renderer.js and database.js.
function createOpenAiSeoClient(config, logger, metrics) {
  async function analyze({ targetUrl, crawlerProfile, extracted }) {
    // AI is optional by design. RenderClaw must still prerender pages in local
    // development, offline deployments, and privacy-focused installations.
    if (!config.enabled || !config.apiKey) {
      metrics.increment("aiFallbacks");
      return fallbackAnalysis(crawlerProfile, "AI disabled or OPENAI_API_KEY missing");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildRequest(config.model, targetUrl, crawlerProfile, extracted)),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`OpenAI response ${response.status}: ${body.slice(0, 240)}`);
      }

      const payload = await response.json();
      const text = extractOutputText(payload);
      const parsed = JSON.parse(text);

      metrics.increment("aiSuccesses");
      return {
        provider: "openai",
        model: config.model,
        status: "ok",
        summary: parsed.summary || "",
        recommendations: normalizeRecommendations(parsed, crawlerProfile),
      };
    } catch (error) {
      logger.log("warn", "AI SEO analysis failed; using fallback", { error: error.message });
      metrics.increment("aiFallbacks");
      return fallbackAnalysis(crawlerProfile, error.message);
    } finally {
      clearTimeout(timeout);
    }
  }

  return { analyze };
}

function buildRequest(model, targetUrl, crawlerProfile, extracted) {
  // The schema forces the model to return machine-readable recommendations.
  // Prompt rules are conservative: improve metadata using page evidence, do
  // not create new facts or rewrite the page intent.
  return {
    model,
    instructions: [
      "You are an SEO rendering optimizer.",
      "Return only valid JSON that matches the provided schema.",
      "Do not invent facts, brands, offers, prices, reviews, or content that is not present in the provided page data.",
      "Optimize for the specified crawler using safe metadata, canonical URLs, social tags, and structured data.",
      "Do not create keyword stuffing and do not change the page intent."
    ].join(" "),
    input: JSON.stringify({
      url: targetUrl.href,
      crawler: crawlerProfile,
      page: {
        title: extracted.title,
        description: extracted.description,
        canonical: extracted.canonical,
        robots: extracted.robots,
        headings: extracted.headings,
        images: extracted.images,
        linksSample: extracted.links.slice(0, 40),
      },
    }),
    text: {
      format: {
        type: "json_schema",
        name: "seo_crawler_optimization",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            robots: { type: "string" },
            canonical: { type: "string" },
            openGraph: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                image: { type: "string" },
                type: { type: "string" },
              },
              required: ["title", "description", "image", "type"],
            },
            twitter: {
              type: "object",
              additionalProperties: false,
              properties: {
                card: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
                image: { type: "string" },
              },
              required: ["card", "title", "description", "image"],
            },
            jsonLd: {
              type: "object",
              additionalProperties: true,
            },
          },
          required: ["summary", "title", "description", "robots", "canonical", "openGraph", "twitter", "jsonLd"],
        },
      },
    },
  };
}

function extractOutputText(payload) {
  if (payload.output_text) return payload.output_text;

  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }

  throw new Error("OpenAI response did not include output text");
}

function normalizeRecommendations(parsed, crawlerProfile) {
  // Normalize and bound strings before they reach HTML injection. These limits
  // keep metadata practical for search/social surfaces and avoid oversized AI
  // outputs from bloating crawler snapshots.
  return {
    crawlerProfile: crawlerProfile.id,
    title: limit(parsed.title, 70),
    description: limit(parsed.description, 170),
    robots: parsed.robots || "index,follow",
    canonical: parsed.canonical || "",
    openGraph: {
      title: limit(parsed.openGraph?.title || parsed.title || "", 95),
      description: limit(parsed.openGraph?.description || parsed.description || "", 220),
      image: parsed.openGraph?.image || "",
      type: parsed.openGraph?.type || "website",
    },
    twitter: {
      card: parsed.twitter?.card || "summary_large_image",
      title: limit(parsed.twitter?.title || parsed.title || "", 95),
      description: limit(parsed.twitter?.description || parsed.description || "", 220),
      image: parsed.twitter?.image || "",
    },
    jsonLd: parsed.jsonLd || {},
  };
}

function fallbackAnalysis(crawlerProfile, reason) {
  // Deterministic fallback keeps the pipeline reliable when AI is disabled,
  // times out, or returns invalid output.
  return {
    provider: "fallback",
    model: "deterministic",
    status: "fallback",
    summary: reason,
    recommendations: {
      crawlerProfile: crawlerProfile.id,
      title: "",
      description: "",
      robots: "index,follow",
      canonical: "",
      openGraph: { title: "", description: "", image: "", type: "website" },
      twitter: { card: "summary_large_image", title: "", description: "", image: "" },
      jsonLd: {},
    },
  };
}

function limit(value, max) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

module.exports = { createOpenAiSeoClient };
