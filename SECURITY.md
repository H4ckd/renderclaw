# Security Policy

## Supported Versions

RenderClaw is currently in public alpha. Security fixes target the latest version on the default branch.

## Reporting a Vulnerability

Please do not open a public issue for sensitive security reports.

If you find a vulnerability, email the maintainer or use GitHub private vulnerability reporting if it is enabled for the repository.

Include:

- a clear description of the issue;
- reproduction steps;
- affected version or commit;
- impact;
- any suggested fix, if available.

## Production Safety Checklist

Before exposing RenderClaw publicly:

- Configure `ALLOWED_DOMAINS`.
- Protect `/admin/*` behind authentication or a private network.
- Run behind a reverse proxy with request size and rate limits.
- Keep `OPENAI_API_KEY` only in environment variables or private config.
- Do not commit `data/`, logs, caches, SQLite files, or local config files.
- Monitor memory and render queue depth.

## Responsible Use

RenderClaw is intended to make real page content crawler-readable. Do not use it to serve misleading crawler-only content.
