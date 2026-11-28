# AGENTS.md

Rules for AI agents working in `nyuchi/maps`. They layer on top of the org-wide
guide, [nyuchi/.github AGENTS.md](https://github.com/nyuchi/.github/blob/main/AGENTS.md).
Read that first. Where this file and the org guide conflict, this file wins.

## What this repo is

Nyuchi Maps: the base-map service for every Mukoko app and Nyuchi product.
A TypeScript Cloudflare Worker (Hono) serves tiles, styles, fonts and sprites
from one PMTiles archive in R2 with HTTP range reads, plus a small developer
dashboard. Start with [README.md](README.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Layout

- `src/`: the Worker. `index.ts` routes; `styles.ts`, `credits.ts`, `cors.ts`,
  `originauth.ts`, `ratelimit.ts` and `sources.ts` are the main pieces;
  `src/regions/` is the on-demand regions feature.
- `site/`: the Astro dashboard source. `public/` is generated from it and committed.
- `openapi/`: the OpenAPI 3.1 contract. `test/`: the Workers Vitest suite.
- `docs/`: architecture, the tile contract and the on-demand regions design.
  `docs/prototype/` is a design prototype, not shipped code.

## Commands

```sh
npm ci
npm ci --prefix site   # only for dashboard work
npm test               # vitest run
npm run typecheck
npm run build          # check:web, then wrangler deploy --dry-run
npm run build:web      # regenerate public/ from site/
npm run format:check   # prettier
```

Run `npm test`, `npm run typecheck` and `npm run build` before opening a PR.
If you change `site/`, run `npm run build:web` and commit the regenerated
`public/`; CI fails when it is stale. Pull requests also run the org lint gate
(actionlint, JSON validity, prettier, markdownlint, yamllint).

## Rules for this repo

- Credits and attribution live in `src/credits.ts` only; never write them by hand elsewhere.
- Keep the Worker self-contained: no third-party hosts at runtime, and keep the
  strict Content-Security-Policy. Vendored libraries stay pinned.
- Public routes follow the OpenAPI contract in `openapi/`; change the contract
  and the code together. Errors use RFC 9457 Problem Details.
- Secrets (`ORIGIN_AUTH_KEYS`, `BUILDER_TOKEN`) are Worker secrets, never files.
  `.dev.vars` is git-ignored; copy `.dev.vars.example` for local work.
- New dependencies need a reason in the PR. Pin new GitHub Actions to a full commit SHA.
- Use Conventional Commits and keep PRs small.

## Out of bounds without the owner's sign-off

- Deploys, DNS and route changes, and bucket creation. Merging to `main` runs
  `.github/workflows/deploy.yml`; never trigger it by hand or edit its credentials.
- Changing `PUBLIC_BASE_URL`, `ALLOWED_ORIGINS` or the rate limit in `wrangler.jsonc`.
- Changing the public `/v1` routes or response shapes.
