# RenderClaw

Open source AI-assisted prerendering for crawler-ready websites.

RenderClaw is a self-hosted rendering gateway that turns crawler requests into fast, optimized, fully rendered HTML snapshots. It is built for developers, SEO engineers, agencies, and teams that need modern JavaScript-heavy or poorly optimized websites to be readable by search engines and social preview crawlers.

Human visitors are redirected to the original website. Crawlers receive a rendered, cacheable, crawler-specific HTML version of the same page.

> RenderClaw is not a cloaking tool. Crawler-facing output should represent the real content of the source page.

## Features

- Crawler detection for Googlebot, Bingbot, social preview bots, validators, and generic bots.
- Real browser rendering with Puppeteer.
- Crawler-specific HTML cache variants.
- Stale-while-refresh behavior for fast crawler responses.
- SQLite storage for analyzed sites, pages, links, render events, cache variants, and AI analyses.
- Optional AI SEO optimization with OpenAI.
- Conservative metadata improvements: title, description, canonical, robots, Open Graph, Twitter Cards, and JSON-LD.
- CSS and images remain available to crawlers.
- Heavy media, fonts, and known tracking hosts are blocked during render.
- Render concurrency limits and browser reuse to reduce memory pressure.
- Central config file with environment variable overrides.

## Quick Start

```bash
git clone https://github.com/H4ckd/renderclaw.git
cd renderclaw
npm install
npm start
```

Health check:

```bash
curl http://localhost:5000/health
```

Render a page as Googlebot:

```bash
curl -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" \
  http://localhost:5000/example.com/
```

## How It Works

Request format:

```text
/:domain/:path
```

Example:

```text
http://localhost:5000/example.com/products/item
```

For regular visitors, RenderClaw redirects to:

```text
https://example.com/products/item
```

For crawlers, RenderClaw:

1. identifies the crawler profile;
2. checks the crawler-specific cache;
3. renders the target page if needed;
4. extracts SEO and page signals;
5. optionally asks the AI optimizer for crawler-specific recommendations;
6. injects safe metadata improvements;
7. stores the result in SQLite and filesystem cache;
8. returns optimized HTML.

## Configuration

Main config:

```text
config/renderclaw.config.json
```

Example config:

```text
config/renderclaw.example.json
```

Private local override:

```text
config/renderclaw.local.json
```

The local config file is ignored by Git. Environment variables always take priority over config files.

Useful environment variables are documented in:

```text
.env.example
```

## AI Optimization

RenderClaw can use OpenAI to generate crawler-specific SEO recommendations.

```bash
OPENAI_API_KEY=your_key_here
AI_ENABLED=true
OPENAI_MODEL=gpt-4.1-mini
AI_TIMEOUT_MS=4500
```

If no API key is provided, RenderClaw continues to work using a deterministic fallback optimizer.

The AI layer is intentionally conservative. It should improve crawler metadata based on the rendered page, not invent new page content.

## Production Safety

Before exposing RenderClaw publicly:

- Set `ALLOWED_DOMAINS`.
- Protect `/admin/*` behind authentication, a VPN, or a private network.
- Use a reverse proxy with rate limiting.
- Keep `OPENAI_API_KEY` out of Git.
- Monitor memory, browser health, render queue depth, and cache size.
- Do not use RenderClaw to serve misleading crawler-only content.

## Runtime Data

RenderClaw writes runtime data under:

```text
data/
```

This includes:

- `data/renderclaw.sqlite`
- cached HTML files;
- runtime logs.

The `data/` directory is ignored by Git.

## Endpoints

```text
GET /health
GET /admin/sites
GET /admin/pages
GET /:domain/*?
```

## Project Structure

```text
app.js                    Application entrypoint
config/                   RenderClaw configuration
src/server.js             Server composition
src/config.js             Config loader and environment overrides
src/http/                 Routes, crawler detection, headers
src/rendering/            Browser, queue, rendering, SEO optimization
src/storage/              SQLite and HTML cache
src/ai/                   AI SEO analysis client
src/bootstrap/            Runtime filesystem setup
```

## Roadmap

- Domain allowlist enforcement mode.
- Admin authentication.
- Rate limiting.
- Docker image.
- Web dashboard.
- Sitemap discovery.
- SEO scoring.
- Robots.txt analysis.
- JSON-LD generators.
- Redis/Postgres adapters.
- Distributed render workers.
- Plugin system for crawler profiles.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

Good first areas:

- crawler profile improvements;
- deployment docs;
- tests;
- Docker support;
- admin authentication;
- rate limiting.

## Security

Please read [SECURITY.md](SECURITY.md). Do not open public issues for sensitive vulnerabilities.

## License

RenderClaw is released under the [MIT License](LICENSE).
