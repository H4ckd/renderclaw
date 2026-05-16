# Contributing to RenderClaw

Thanks for helping improve RenderClaw.

RenderClaw is an open source project for crawler-ready rendering, SEO analysis, and safe AI-assisted metadata optimization. Contributions are welcome across code, documentation, tests, examples, crawler profiles, and deployment guides.

## Development Setup

```bash
npm install
npm run check
npm run audit
npm start
```

By default RenderClaw stores runtime data in `data/`, which is ignored by Git.

## Before Opening a Pull Request

- Keep changes focused and easy to review.
- Do not commit secrets, runtime caches, logs, SQLite files, or `node_modules`.
- Run `npm run check`.
- Run `npm run audit`.
- Update documentation when behavior or configuration changes.
- Prefer conservative SEO improvements over aggressive rewriting.

## Safety Principles

RenderClaw should not be used to deceive crawlers.

Crawler-facing HTML should represent the real content of the source page. The AI layer may improve metadata, structured data, and preview tags, but it must not invent products, prices, reviews, claims, or content that is not present on the rendered page.

## Good First Contributions

- Add tests for crawler detection.
- Improve crawler profiles.
- Add deployment examples.
- Add Docker support.
- Improve docs and diagrams.
- Add safer admin authentication.
- Add rate limiting.

## Commit Style

Use clear, direct commit messages:

```text
Add Bing crawler profile
Fix stale cache refresh key
Document production allowlist setup
```
