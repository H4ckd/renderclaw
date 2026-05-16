// Maps user-agent strings to optimization profiles.
// Add new crawlers here when they need distinct metadata priorities or cache
// variants. The id becomes part of the cache key, so changing ids invalidates
// existing per-crawler cache records.
function detectCrawlerProfile(req) {
  const agent = String(req.headers["user-agent"] || "").toLowerCase();

  if (agent.includes("googlebot") || agent.includes("google-inspectiontool")) {
    return {
      id: "google",
      name: "Googlebot",
      priorities: ["indexability", "canonical", "structured_data", "content_completeness", "core_web_vitals"],
    };
  }

  if (agent.includes("bingbot")) {
    return {
      id: "bing",
      name: "Bingbot",
      priorities: ["indexability", "canonical", "structured_data", "clean_head"],
    };
  }

  if (
    agent.includes("facebookexternalhit") ||
    agent.includes("twitterbot") ||
    agent.includes("linkedinbot") ||
    agent.includes("whatsapp") ||
    agent.includes("telegrambot") ||
    agent.includes("discordbot") ||
    agent.includes("slackbot")
  ) {
    return {
      id: "social",
      name: "Social preview crawler",
      priorities: ["open_graph", "twitter_cards", "title", "description", "primary_image"],
    };
  }

  if (agent.includes("w3c_validator") || agent.includes("chrome-lighthouse")) {
    return {
      id: "validator",
      name: "Validator crawler",
      priorities: ["valid_markup", "robots", "canonical", "performance"],
    };
  }

  return {
    id: "generic",
    name: "Generic crawler",
    priorities: ["indexability", "title", "description", "canonical"],
  };
}

module.exports = { detectCrawlerProfile };
