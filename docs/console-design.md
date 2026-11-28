# Developer console design

Status: design and visual prototype for the owner to review. Nothing here is
built, deployed or merged. The prototype is in [prototype/](prototype/).

The owner's brief, verbatim: "This is where we work with the API nyuchi api and
servers api need to serve Maps over the API should also be embedding option and
we should be displaying this as a dashboard set up look at mzizi we have all of
the components that we need. The goal of this is not for people to come here and
use our maps ... we are not trying in this repo to be a replacement of Google
Maps, but we are serving basically the tile infrastructure behind people needing
map infrastructure for their own applications. This is the primary purpose. They
also should be able to pull out API, etc. directly from here as well so the
console plus the API is kind of connected to this because those are used to
serve people. This is the map and tile infrastructure for the whole ecosystem
ourselves as well as for other people as well." And: "Chips or badges and buttons
are always pills" (icon-only controls are always round).

So `maps.nyuchi.com` is the developer console for Nyuchi Maps, not a map for the
public to browse. The map stays in it as a live preview of what a developer gets.

## 1. Summary and recommendation

1. Build the console on the Mzizi **Dashboard Standard**: the pure Astro app
   components of `@bundu/ui` 0.17.0 (MIT) over Mzizi's tokens, floor and density
   CSS and the Nyuchi brand overlay. It is what the Nyuchi Console already uses,
   it needs no client framework, and it was built for exactly this page shape.
   The Rust crates do not have a dashboard shell, table, stat tile or chart that
   renders a page today (section 2.1), so "Rust first" is met on the server side.
2. The pill rule conflicts with the shipped standard, which says "Corners use the
   small radius, not the marketing pill". The prototype applies the owner's rule
   with one token override (`--radius-sm: 9999px`) in
   [`maps-pill.css`](prototype/src/styles/maps-pill.css). That should become an
   upstream Mzizi change, not a local fork (open question 2).
3. Everything signed-in already has a home: the Nyuchi Console
   (`nyuchi/nyuchi-platform`, Astro on Cloudflare Workers plus a Rust backend
   Worker) owns WorkOS sign-in, sessions, workspaces and key issuing, and is built
   on the same Mzizi shell. Maps is not mentioned anywhere in the Console or in
   the Nyuchi API today.
4. Recommended split, by the auth boundary: **`maps.nyuchi.com` is the public
   developer site** built from this repo (Overview, Explorer, Endpoints and
   snippets, Embed builder, Coverage, Docs, Status) and **the signed-in tools are
   a "Maps" section of the Console** (API keys with per-key allowed origins, Usage,
   the Embed builder with your own keys). One sitemap, one design, two
   deployments. Section 10 gives the trade-offs and the alternatives.
5. The Nyuchi API is missing three things Maps needs before outside developers
   can use it: a `maps` namespace in the API catalogue; a publishable key kind
   (a `nyk_` that works from a browser, bound to origins) with per-key allowed
   origins and a rate tier; and an endpoint the edge can call to read a key's
   policy. Section 5.2 lists them with who must build them.
6. Per-key usage is metered in Workers Analytics Engine (Workers Paid: 10 million
   data points a month included, three months of retention), with no IP, no
   user agent and no tile coordinates stored (section 7).
7. Embedding is a `/embed` route (an iframe) plus an optional `embed.js` web
   component, both served by the Worker, with `frame-ancestors` and CORS driven
   by the key's origin list from the Nyuchi API, the credits always on, and no
   third-party host at runtime (section 6).
8. Authorization comes from the identity provider's permissions and the API's
   workspace membership only. No allow-list goes in code or config. This also
   means the existing `ALLOWED_ORIGINS` variable in `wrangler.jsonc` should be
   retired in favour of keys held by the first-party apps (open question 3).
9. Delivery is ten independently shippable PRs (section 11). The first useful one
   (metering) is small and changes nothing for users.
10. Ten questions are for the owner (section 13). The first two decide where the
    code lives and whether the standard's corners change.

## 2. Findings

Everything below was read from repositories and public documentation. No
authenticated production endpoint was called. Revisions read: `nyuchi-platform`
4d3171d (2026-11-22), `nyuchi-api` 7d1bad2 (v0.61.0, 2026-11-20), `packages-npm`
4e8d19c, `mzizi-registry` 8d386e5a (2026-11-23), `mzizi-cli` 79059a4.

### 2.1 Mzizi: which implementation to build with

Checked through the Mzizi MCP (`get_tokens` family `floors`, `get_doctrine`,
`list_crates`, `list_components`, `get_component`) and docs.mzizi.dev
(`patterns/dashboard-standard`, `foundations/bundu-floor`, `roots/overview`,
`charts/overview`, `toolchain/cli`).

| Option                              | What exists                                                                                                                                                                                                                                                                                         | Verdict                                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Mzizi Roots (Rust)                  | 17 crates at 0.9.0 in the pinned registry (docs say 14 on crates.io at 0.11.0). UI crates: `mzizi-roots` (alert, badge, card, chart, markdown renderer, progress, safe-area frame, separator), `mzizi-ui` (button, input, label, skeleton, status badge, device code), `mzizi-brand`, `mzizi-shell` | No dashboard shell, side nav, data table, stat tile or form field in Rust. `mzizi-shell` and `mzizi-brand` pull in Dioxus. Not yet |
| Pure Astro (`mz add --type astro`)  | 107 components with an Astro build, including the 31 Dashboard Standard `app-*` components (shell, side nav, workspace switcher, command palette, page header, stat tiles, data table, filter bar, forms, states, toast, bar chart)                                                                 | **Use this.** Server-rendered HTML, no client framework, works without JavaScript, each component has a contract and tests         |
| React and shadcn (`npx shadcn add`) | The registry's tsx builds                                                                                                                                                                                                                                                                           | Deprioritised by Mzizi; only needed for the Recharts area and line charts, which have no Astro build                               |

The owner's three standing rules, applied:

- **Use Mzizi.** Yes: the page is the Dashboard Standard, unmodified except for
  the pill overlay and two components Mzizi does not have yet (below).
- **Rust first for anything built.** The Rust crates cannot render this UI, so the
  UI is Astro, as the Console's is. Services stay Rust where they are new. One
  tension: `nyuchi/maps` itself is a TypeScript Worker today, so new endpoints
  extend TypeScript unless the owner wants a Rust port first (open question 8).
- **Where JavaScript stays, use Deno, not Node.** The page ships almost none:
  MapLibre GL JS (BSD-3-Clause, already vendored here), a copy-to-clipboard
  button and a form-to-preview script, each as progressive enhancement. The
  build uses Astro, which needs a JavaScript runtime; the commands in
  [prototype/README.md](prototype/README.md) run unchanged under Deno 2 but Deno
  is not installed on this machine, so I built with Node 24 and say so plainly.

**Install route.** Two routes give the same components. `@bundu/ui` from npm
(what the Console does, exact version pin) keeps both products on one release.
`mz add <name> --type astro` (CLI 0.14.1, Apache-2.0; `mzizi` is the old name and
prints a deprecation note) copies the files into `src/components/mzizi/`, which
forks them. Recommended: the npm package, pinned. I confirmed that the prototype
built from the published `@bundu/ui` 0.17.0 renders identically to a build from the local
source (compared on the Overview page, desktop, light, byte for byte).

What to vendor, with versions and licences:

| Item                                                                                                                                                                                                                                                                                                                                                                                 | Version              | Licence      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- | ------------ |
| `@bundu/ui`: `app/` AppShell, SideNav, WorkspaceSwitcher, QuickSearch, CommandPalette, TopBarAction, AccountMenu, PageHeader, StatTiles, StatTile, BarChart, DataTable, FilterBar, Pagination, DetailPanel, FormLayout, FormField, Card, Button, Badge, Alert, StateMessage, EmptyState, Skeleton, Toast, ConfirmAction, ToolbarMenu, InfoTip, BrandMark; `SegmentedControl`, `Icon` | 0.17.0               | MIT          |
| Styles from `@bundu/ui`: `tokens.css`, `theme.css`, `globals.css`, `density.css`, `color-scheme.css`, `brand-nyuchi.css`                                                                                                                                                                                                                                                             | 0.17.0               | MIT          |
| Astro, Tailwind CSS, `@tailwindcss/vite`                                                                                                                                                                                                                                                                                                                                             | 7.4.13, 4.3.5, 4.3.5 | MIT          |
| MapLibre GL JS (already in this repo under `public/assets/vendor/`)                                                                                                                                                                                                                                                                                                                  | 6.19.0               | BSD-3-Clause |
| Web fonts for the real build: Noto Sans, Noto Serif, JetBrains Mono (self-hosted, never a font CDN). The prototype falls back to system fonts                                                                                                                                                                                                                                        | to be pinned         | OFL-1.1      |

Tailwind is needed because the app components are still Tailwind-styled; the
"unstyled pattern" (`tokens.css`, `floor.css`, `mzizi-theme.css`) exists for the
button only today.

**Gaps in Mzizi, found by building the prototype** (marked `TODO(mzizi)` there):

1. **Pill corners.** The Dashboard Standard draws controls at 7px
   (`--radius-sm`) with a hairline border, and the Console even carries a
   "density bridge" that forces small corners. Setting `--radius-sm` to full turns
   every `rounded-sm` control (buttons, badges, nav rows, pagination, inputs) into
   a pill, and every square icon-only control into a circle. The page header's
   "View docs" and `SegmentedControl` are already pills. A card and a tile keep
   `--radius-md` and `--radius-lg`.
2. **Soft elevation.** Cards and tiles in the standard use a border. The overlay
   fades the border and adds a two-layer shadow.
3. **Bottom navigation on a phone.** The standard uses a drawer behind a menu
   button. `mzizi-bottom-nav` exists for Rust (Dioxus) and React only. The
   prototype has a small Astro `BottomNav` (4 items plus "More", which opens the
   same drawer), following `patterns/mobile-first`.
4. **Code block and copy button** have no Astro build (`code-block`, `code-tabs`
   are React). The prototype has `Code` and `Copy`.
5. **Area and line charts** have no Astro build (Recharts, or the Rust `chart`
   crate). The prototype uses `BarChart`, the Astro build of the chart contract,
   which carries its figures in a real table. A daily series reads fine as bars.
6. **`map-view`** in the registry wraps Mapbox GL JS. This product uses MapLibre
   against its own tiles, so the prototype draws the map itself and styles
   MapLibre's controls as round pills.
7. **Published `@bundu/ui` exposes `app/nav` from `dist/`**, which the source
   repository does not build. A build from the source tree needs an alias to
   `src/app/nav.ts`. The published package does not.

**The floor, checked.** `mz floor docs/prototype/src` reports 0 violations (34
number-rule warnings about values that are not Mzizi numbers, 1 exempt line with a
reason). It enforces 14px inset, 9px between controls, 1.5 leading and 24px or
45px hit regions. Hit regions on controls the components do not own are drawn at
the floor with a 45px region on touch. Text uses semantic tokens (`foreground`,
`muted-foreground`), which Mzizi holds to its contrast floor; I did not
independently measure APCA Lc on every pair, and that should be done before
shipping (`check_accessibility`).

### 2.2 The Nyuchi platform side

**The Nyuchi API** is `nyuchi/nyuchi-api` (formerly `nyuchi/api-gateway`), serving
`api.nyuchi.com`: FastAPI on Fly, one `/v1/*` namespace tree, rebuilt in Rust
namespace by namespace (decided, not built; README "Where it is going"). A key
authenticates to it with `X-Client-Id` and `X-Client-Secret`, a combined
`X-API-Key`, or a one-hour bearer token from `POST /v1/auth/token`
(`client_credentials`) (`docs/AUTH.md`, "If you're building a script/service").

**Key model** (`gateway/routers/api_keys.py`, `gateway/lib/key_store.py`,
`gateway/lib/api_catalog.py`, `docs/architecture/billing.md`):

| Question                  | What exists                                                                                                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format                    | A pair: `client_id` `nyk_…` and `client_secret` `nys_…`. There is no key that is a public identifier on its own: the id alone is not a credential                                                                                                                                                 |
| Issue                     | `POST /v1/api-keys {name, entity_id, scopes[], expires_in_days?, key_type}` by a manager of the workspace (family guardian, or organisation founder or admin). The secret is shown once; only its SHA-256 is stored. `POST /v1/app-keys` mints for a first-party app, 3 live free keys per family |
| List, revoke, rotate      | `GET /v1/api-keys`, `DELETE /v1/api-keys/{id}`, `POST /v1/api-keys/{id}/rotate`. Revoke and rotate take effect on the next request; an exchanged machine token lives at most an hour                                                                                                              |
| Scopes                    | Namespace slugs from `API_CATALOG`, `public` or `internal`. External keys can never carry `internal` slugs. **There is no `maps` entry**                                                                                                                                                          |
| Origins or referrers      | **None.** `CreateKeyRequest` has no such field, and `key_store.py` has no column for it                                                                                                                                                                                                           |
| Rate limit                | Per key, 60 requests a minute by default (30 on token endpoints). Not configurable per key                                                                                                                                                                                                        |
| Quota                     | `monthlyRequestLimit` follows the family's plan (`commerce_plans.key_limits`; free keys are read only). `platform.api_key_usage` holds one row per key: `period`, `request_count`, `last_used_at`                                                                                                 |
| Verification by a service | There is no introspection endpoint. A service either calls the API with the pair, or verifies a person token offline against the ES256 JWKS (`/.well-known/jwks.json`). Machine tokens use a different audience and must not be accepted as a person                                              |
| Audit                     | Every create, rotate, revoke and refusal writes an ids-only audit line                                                                                                                                                                                                                            |

**The Console** is `nyuchi/nyuchi-platform/console` (private), `platform.nyuchi.com`
(and `beta.nyuchi.com`): `console/web` is Astro 7 rendered on the Cloudflare
Worker `nyuchi-console-web`; `console/backend` is a Rust (Axum on workers-rs)
Worker reached only through a service binding. Facts that matter here:

- **Sign-in is WorkOS AuthKit.** The backend does the code exchange, then an RFC
  8693 token exchange at the Nyuchi API for a person token. The browser holds one
  sealed, HttpOnly cookie (`__Host-` prefixed, host-only) and never a token. The
  AuthKit domain is a backend variable and the Console's own rules forbid writing
  it down in code, config, tests or docs, so this document does not either.
  Because the cookie is host-only, `maps.nyuchi.com` cannot read it.
- **Authorization comes from WorkOS.** Operator namespaces reach a person only
  through `console:*` permissions on their WorkOS roles in the Nyuchi Africa
  organisation (`console:admin-read`, `console:api-keys-mint` and others). For
  customers, the API checks workspace membership (a manager may mint external keys,
  api-gateway#171).
- **A section is cheap to add.** `CONTRIBUTING-SECTIONS.md`: one nav line, pages
  under `web/src/pages/dashboard/<section>/`, a Rust module under
  `backend/src/sections/`, and tests. Its rules: only the backend talks to the
  API, no tokens in the browser, no shared secret for people, nothing is stubbed.
- **A key section exists.** `/dashboard/developer` (the API library, from
  `GET /v1/api-keys/catalog`) and `/dashboard/developer/keys` (list, create with
  the secret shown once and a credentials-file download, revoke, rotate), per
  workspace. There is a Weather section (status, forecast, stations, alerts) but
  **no usage, quota or billing page** for any product.
- **The shell is the Dashboard Standard**, `@bundu/ui` 0.17.0, with WorkspaceSwitcher
  showing one organisation. There are no "projects" or "teams": the concepts are
  workspaces (a family or an organisation entity), persons and memberships.
- **Billing runs through the Console** is decided, not built
  (`nyuchi-platform` README). The API has the plan ladder (`free`, `go`, `plus`,
  `pro`, `enterprise`) behind `BILLING_ENABLED` (off).
- **Analytics precedent.** `docs/architecture/analytics.md` reports aggregates
  only, with k-anonymity k = 5, for the callers who already see what they summarise.
  The Maps usage design follows the same rule.

A code search of the `nyuchi` and `mukoko-dev` organisations for
`maps.nyuchi.com` finds only `nyuchi/maps`, and a search of the local Console and
API clones for Nyuchi Maps finds nothing. Neither the Console nor the API refers
to Maps. The Nyuchi Servers API (`nyuchi/nyuchi-servers-api`) is
the internal data path the Console is decided to move to; it is not needed for
this design.

**Who must build what that is missing:**

| Missing                                                                                                      | Owner / repo                          |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `maps` slug in `API_CATALOG`, documented                                                                     | `nyuchi/nyuchi-api`                   |
| Publishable key kind, per-key origin list, rate tier, a policy read endpoint, monthly quota enforcement hook | `nyuchi/nyuchi-api`                   |
| Maps section in the Console (keys with origins, usage, embed builder, coverage) and its Rust backend module  | `nyuchi/nyuchi-platform`              |
| Usage and quota pages, for any product (the Console has none)                                                | `nyuchi/nyuchi-platform`              |
| Key checks, metering, `/embed`, status and coverage endpoints, internal usage endpoint, the public site      | `nyuchi/maps`                         |
| Pill overlay, `BottomNav`, code block and copy button as Astro, optionally area and line charts as Astro     | `mzizi-dev/packages-npm` (+ registry) |
| An API token for the Analytics Engine SQL API, held as a Worker secret                                       | the owner (Cloudflare)                |
| Pricing and free-tier limits for Maps                                                                        | the owner                             |

### 2.3 What Nyuchi Maps is today

From this repo's `README.md`, `docs/ARCHITECTURE.md`, `src/` and `openapi/`:
one Worker, one R2 bucket, `GET /` a MapLibre page, `/v1/tiles.json`,
`/v1/tiles/{z}/{x}/{y}.mvt`, `/v1/sources/{id}/…`, `/v1/styles/{light,dark}.json`,
`/v1/fonts/…`, `/v1/sprites/…`, `/openapi.json`, `/health`. Access is a CORS
allow-list in `wrangler.jsonc` (`ALLOWED_ORIGINS`) plus a per-IP limit of 1800 a
minute; the page is served with `frame-ancestors 'none'`. Keys are "not built".
PR #19 (open, not touched here) adds on-demand regions: a z6-cell manifest in R2,
a SQLite Durable Object ledger and builder-only `/internal/v1/regions` routes
behind `BUILDER_TOKEN`.

I confirmed that the live service answers and serves real tiles (the prototype's
Explorer, Embed builder and Coverage maps draw from the real bucket through
`wrangler dev --remote`).

## 3. Product: what a map-infrastructure developer needs

| Need                                            | Why                                                       |
| ----------------------------------------------- | --------------------------------------------------------- |
| Know it is up, and how much of the world it has | Trust before integrating                                  |
| See what they will get                          | A live map, in both styles                                |
| Copy a working integration in their stack       | Time to first tile                                        |
| Embed without writing code                      | Many users want an iframe, not an SDK                     |
| Get and manage keys safely                      | Per key origins and limits, rotate, revoke                |
| See what they use                               | Requests, bytes, cache hits, errors, quota                |
| Request a region                                | The service builds missing regions on demand (PR #19)     |
| Know the licence obligations                    | ODbL credit is mandatory and must be shown to their users |
| Find the contract                               | OpenAPI, the tile contract, a changelog                   |

### Sitemap

```text
Maps
  Overview            health, usage, coverage at a glance
Build
  Explorer            live preview of our base map, style switch
  Embed builder       iframe and web component, live preview, copy
  Endpoints           TileJSON, XYZ, styles, glyphs, sprites, snippets
Manage
  API keys            publishable and secret, origins, limits
  Usage               requests, bytes, cache, errors, per key
  Coverage            stored areas, on-demand regions
Learn
  Docs                OpenAPI, tile contract, attribution guidance
  Status              component status
  Changelog           releases and data builds
```

Docs, Status and Changelog link out in the prototype (the Console already links
`docs.nyuchi.com` and `status.nyuchi.com`).

## 4. Per-page specification

"Public" means no sign-in. "Signed in" means a Console session through the API.

| Page          | Shows                                                                                                                                                                                    | Reads or writes                                                                                                       | Built where                                                               | Access                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------- |
| Overview      | Four stat tiles (requests, cache hit rate, error rate, bytes) with trend in words, a requests-per-day bar chart, service status badges, quick actions, coverage by area, recent activity | Public: new `GET /v1/status`, `GET /v1/coverage`. Signed in: the usage figures and activity from `/internal/v1/usage` | Public part here; personal part in the Console                            | Mixed: status and coverage public, usage mine |
| Explorer      | Our map, Light and Dark segmented control, copy style URL, live centre and zoom, tile source (vector MVT, zoom 0 to 14), the credits                                                     | Existing `/v1/styles/*.json`, `/v1/tiles.json`                                                                        | This repo                                                                 | Public                                        |
| Embed builder | A form (style, centre, zoom, markers, controls, key), a live preview, the allowed origins of the chosen key, the credits notice, three copy-paste tabs (iframe, web component, MapLibre) | New `/embed` and `embed.js`; the list of my publishable keys                                                          | Public mode here (no key, our own demo origin); keyed mode in the Console | Public preview; keys need sign-in             |
| Endpoints     | Base URL with copy, a table of every resource and path, snippets for MapLibre GL JS, Leaflet, OpenLayers, Flutter, iOS, Android, curl                                                    | Static, generated from `openapi/openapi.yaml`                                                                         | This repo                                                                 | Public                                        |
| API keys      | A table (name, key prefix, type, origins, rate limit, last used, status), create form (name, type, origins, rate limit), the one-time secret panel, rotate, revoke, with a confirm step  | Nyuchi API `/v1/api-keys*` via the Console backend; new origins and rate fields                                       | Console                                                                   | Signed in; workspace manager creates          |
| Usage         | Stat tiles, bytes and errors per day, requests by key and by zoom band, a per-key table with cache hits, errors and quota used, date-range menu                                          | New `/internal/v1/usage` over Analytics Engine, through the Console backend                                           | Console                                                                   | Signed in; my keys only                       |
| Coverage      | Stat tiles (stored cells, on-demand regions, waiting, needs attention), the real map with the stored areas outlined, a table of regions and their state                                  | Public: `GET /v1/coverage(.geojson)`. Signed in: region states from the ledger (PR #19 `state`)                       | Public here; ledger detail in the Console (staff)                         | Public summary; ledger detail staff only      |
| Docs          | OpenAPI, tile contract, attribution and licence guidance                                                                                                                                 | Existing `/openapi.json`, `docs/`                                                                                     | `docs.nyuchi.com`                                                         | Public                                        |
| Status        | Components and incidents                                                                                                                                                                 | `status.nyuchi.com` (exists); `GET /v1/status` for the page above                                                     | Existing                                                                  | Public                                        |
| Changelog     | Releases, data builds                                                                                                                                                                    | `TILES_VERSION` and build tags                                                                                        | This repo                                                                 | Public                                        |

Every state is worded once through `StateMessage`: empty (no keys yet, with a
"Create a key" action), loading (skeletons the shape of the content), error,
not configured, unavailable. A missing figure reads "Not available", never 0.

## 5. Contracts

### 5.1 New Worker endpoints (`nyuchi/maps`)

Public, cacheable, no key:

```http
GET /v1/status
200 {"status":"operational|degraded|down",
     "components":[{"id":"tiles","status":"operational"},{"id":"styles","status":"operational"},
                   {"id":"builder","status":"building","detail":"1 region"}],
     "archive":{"tiles_version":"2"}, "updated":"2026-11-28T10:00:00Z"}
Cache-Control: public, max-age=30
```

```http
GET /v1/coverage
200 {"grid_zoom":6,"primary":{"cells":4420},"regions":{"ready":14,"waiting":3},
     "updated":"2026-11-28T10:00:00Z"}
GET /v1/coverage.geojson     the primary coverage as one outline (for the map)
```

Both read the manifest (`tiles/regions.json`, PR #19) and the primary archive's
header. Neither exposes demand per cell.

Embed (section 6):

```http
GET /embed?style=light&center=31.05,-17.83&zoom=11&markers=31.05,-17.83&controls=1&key=nyk_…&lang=en
GET /embed.js
```

Internal, not public, reached only through the Console backend's service binding
with a bearer secret held as a Worker secret (the same pattern as PR #19's
`BUILDER_TOKEN`; answers 404 while the secret is unset):

```http
GET /internal/v1/usage?key_id=<id>&from=2026-10-30&to=2026-11-28&bucket=day&group_by=none|route|status|zoom|cache
200 {"series":[{"t":"2026-10-30","requests":410000,"bytes":61000000000,"cache_hit":0.97,"errors":210}],
     "totals":{"requests":12480000,"bytes":1900000000000,"cache_hit":0.972,"errors":4990},
     "sampled":true}
GET /internal/v1/regions       the ledger state, as in PR #19
```

`from` and `to` are bounded to 90 days (the retention). The key id is the API's
key id, never the secret.

### 5.2 Nyuchi API dependencies (`nyuchi/nyuchi-api`)

1. **`maps` in `API_CATALOG`** (`access: public`), titled "Maps API". With this
   alone, an outside developer can already mint a `nyk_`/`nys_` pair scoped to
   `maps` through the existing Console key page and call Maps from a server.
2. **Publishable keys.** A key kind for browsers: the `nyk_` id alone, read only,
   scope `maps` only, valid only from the origins on the key's list. A secret
   pair stays the way to call from a server. Fields on the key: `origins[]`
   (exact or `https://*.example.com`, the rule `src/cors.ts` already implements),
   `rate_tier`. Create, list, update and revoke through the existing routes and the
   Console's key page. Whether this key kind should exist is a security policy
   decision for the owner (open question 3).
3. **A policy read for the edge.**

   ```http
   GET /v1/maps/key-policy?client_id=nyk_…
   Authorization: <Maps Worker's own service credential>
   200 {"active":true,"kind":"publishable","scopes":["maps"],"origins":["https://www.example.com"],
        "rate_tier":"standard","monthly_limit":null,"over_quota":false,"read_only":true}
   404 unknown key
   ```

   Never returns a secret or a hash. The Worker caches the answer for 60 seconds
   (30 for a 404), so a revocation or an origin change takes effect within a
   minute. That latency is part of the contract and is shown in the Console.

4. **Quota.** The API's `monthlyRequestLimit` counts requests to the API, not
   tiles. Maps meters tiles itself (section 7). A scheduled rollup posts daily
   totals per key to the API (`POST /v1/maps/usage-rollups`, a service call), and
   the policy's `over_quota` flips when the month's total passes the plan.
5. **Plan limits** for the `maps` namespace on the free, go, plus, pro and
   enterprise ladder: the owner sets them (open question 4).

### 5.3 Console backend (`nyuchi/nyuchi-platform`)

A `maps` section: `backend/src/sections/maps.rs` with `GET /api/maps/keys`
(through the API's workspace routes), `GET /api/maps/usage` and
`GET /api/maps/coverage`. The usage route first asks the API which keys the
person's workspaces own, then asks Maps for those key ids only, so a person can
never read another key's numbers. Pages under `web/src/pages/dashboard/maps/`,
one nav line under "Developer", rows in `PARITY.md`.

## 6. Embed design

**Two forms, one source.** An iframe for people who want zero code, and a web
component for people who want it to size itself and sit in their DOM.

```html
<iframe src="https://maps.nyuchi.com/embed?style=light&center=31.05,-17.83&zoom=11&key=nyk_…"
  width="600" height="400" loading="lazy" title="Map of Harare" allow="geolocation"></iframe>

<script type="module" src="https://maps.nyuchi.com/embed.js"></script>
<nyuchi-map style-name="light" center="31.05,-17.83" zoom="11" key="nyk_…" label="Map of Harare"></nyuchi-map>
```

- **`/embed`** serves one small HTML document, our vendored MapLibre and our own
  script from `self`. No third-party host at runtime, as for the page today. Its
  CSP is the current one with `frame-ancestors` set per request.
- **`frame-ancestors` and CORS are driven by the key's origin list** read from the
  Nyuchi API policy (5.2). With no `key`, `/embed` is framable only by origins in
  the first-party key's list (open question 3); it is never `frame-ancestors *`.
  A key that is unknown, revoked, over quota or used from an unlisted origin gets
  a plain, accessible page saying so, not a blank frame.
- **`embed.js`** defines `<nyuchi-map>`. It creates the same iframe in the page,
  so one code path enforces the origin rule. It reads attributes (`style-name`,
  `center`, `zoom`, `markers`, `controls`, `lang`, `key`, `label`), sets the iframe
  `title` from `label`, and never reads page data. It is versioned by path
  (`/embed/v1.js`, content-hashed) so a change cannot break an embedder, and the
  builder's snippet carries a Subresource Integrity hash for that exact file
  (`integrity` and `crossorigin`), so a changed file is refused by the browser.
- **Credits are always present.** They come from the TileJSON the style points at,
  as today, rendered by MapLibre's attribution control in the frame. There is no
  parameter to hide it, and the Embed builder says so ("Credits always on").
  ODbL requires "© OpenStreetMap contributors" wherever the map is shown, and the
  snippets for MapLibre, Leaflet and others carry a note telling developers who
  draw their own map to show it too.
- **Markers** are given as `lng,lat` pairs, at most 50, validated numerically. No
  HTML, no labels from the query string, so a link cannot inject content.
- **Privacy.** No cookies, no storage, geolocation only if the embedder grants
  `allow="geolocation"` and the visitor accepts, no analytics script.

## 7. Usage metering design

**Workers Analytics Engine** on the Paid plan, written by the Worker per request
with `ctx.waitUntil`. Verified against Cloudflare's documentation (read
2026-11-28): up to 20 blobs, 20 doubles and 1 index per data point; 250 data
points per invocation; **three months of retention**; Workers Paid includes 10
million data points written and 1 million read queries a month (then $0.25 and
$1.00 per million).

| Field     | Value                                                                                                                 |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| `index1`  | The API's key id, or `anon` (under 96 bytes)                                                                          |
| `blob1`   | Route class: `tile`, `style`, `tilejson`, `glyph`, `sprite`, `embed`, `other`                                         |
| `blob2`   | Source id (`basemap`)                                                                                                 |
| `blob3`   | Status class: `2xx`, `204`, `304`, `4xx`, `429`, `5xx`                                                                |
| `blob4`   | Cache: `edge_hit`, `r2`, `empty`                                                                                      |
| `blob5`   | Zoom band: `z0-5`, `z6-9`, `z10-12`, `z13-14`                                                                         |
| `double1` | 1 (a count; queries use `SUM(_sample_interval * double1)` because Analytics Engine samples adaptively at high volume) |
| `double2` | Response bytes                                                                                                        |
| `double3` | Duration in ms                                                                                                        |

**Privacy by construction.** No IP, no user agent, no URL, no tile coordinates
(coordinates reveal where a person is looking), no cookie, no person id.
Origin is not stored in the first version; an embedding site's host could be added
later as a per-key aggregate once the owner agrees (open question 9). The key id
is the owner's own identifier for their own traffic; no cross-key reading exists.

**Cost.** One point per request. At 10 million requests a month this is inside the
included allowance; each further 100 million costs about $25. If volume passes
that, aggregate per isolate per key per minute and flush once, accepting the
sampling.

**Reading.** The SQL API needs an Analytics Read token, held as a Worker secret by
the Maps Worker only. The Console never holds it: it calls
`/internal/v1/usage` (5.1) through its service binding. Responses are cached for
60 seconds. **Retention is the limit:** the dashboard can show 90 days. A daily
rollup (section 5.2.4) can persist per-key daily totals in the API for longer;
how long to keep them is an owner decision (open question 9).

**Enforcement is separate from metering.** Per-minute limits use the Workers rate
limiting binding with one binding per tier (its limit and period are static per
binding), keyed by the key id. The per-IP limit stays for anonymous traffic.

## 8. Authentication and authorization

- **Anonymous pages** (Overview status, Explorer, Endpoints, Coverage summary,
  the Embed builder preview) need no sign-in and carry no personal data.
- **Signed-in pages** use the Console's mechanism unchanged: WorkOS AuthKit, the
  backend's sealed host-only cookie, a person token by RFC 8693 token exchange,
  and every API call made by the backend as the person. The browser never holds a
  token. The Maps Worker never sees a person.
- **Authorization comes from the identity provider and the API only.** Customers:
  workspace membership, as the API enforces for keys today. Staff: `console:*`
  WorkOS permissions (a new `console:maps-admin` read of the ledger could be
  added by the owner in WorkOS, not in code). No email, domain or origin
  allow-list is written in code or config. The allowed origins of a key are
  **data** on the key.
- **Maps trusts only the Console backend** for internal routes, by a service
  binding and a bearer secret in the Worker's secrets (never in `wrangler.jsonc`),
  and 404s while it is unset.
- **Existing tension.** `wrangler.jsonc` today holds `ALLOWED_ORIGINS` for the
  two first-party apps. That is an allow-list in config. The design moves the
  first-party apps onto keys (publishable keys held by the apps) and removes the
  variable in a later PR, behind a transition where both are accepted.

## 9. Security

- **`nys_` never reaches a browser.** The Embed builder, the snippets and the key
  page only ever show a `nyk_` in a page. A secret appears once, at creation, in
  `Cache-Control: no-store` responses, as the Console does today.
- **No secret in a URL.** A secret goes in the `X-Client-Secret` header. A
  publishable `nyk_` may be a query parameter, because it is public by design and
  is bound to origins; it is still never logged with a secret.
- **An origin list is a hotlinking control, not authentication.** A script outside
  a browser can send any `Origin` or `Referer`. The list stops other websites
  from showing the map on a key that is not theirs; it does not stop scraping. The
  controls against scraping are the per-key rate tier, the monthly quota,
  anomaly checks on the usage series, quick revoke and rotate, and the existing
  edge cache. The design says this plainly in the Console rather than promising
  more.
- **Origin matching** reuses `isOriginAllowed` (exact, or `https://*.host`, never
  the bare apex). `Referer` is the fallback for image loads that send no
  `Origin`. Both are compared as parsed origins, never as substrings.
- **Order of checks.** The key policy runs before the edge cache answers, from an
  in-memory per-isolate cache, so a revoked key cannot be served from cache for
  longer than the policy TTL. The cache key itself stays free of the origin and
  the key (one cached object serves everyone), as in `docs/ARCHITECTURE.md`.
- **Fail open or closed.** A policy fetch failure keeps the last good policy for
  up to ten minutes and then fails closed for keyed requests; anonymous requests
  are unaffected. A kill switch var returns behaviour to today's, as PR #19 does.
- **Abuse.** Per-key and per-IP limits, a ceiling on markers and on `zoom`, strict
  validation of every query parameter (the existing rule: only validated values
  form a key or a header), and 429 with `Retry-After`.
- **Content-Security-Policy** stays `self` only, no inline script or style (the
  prototype is built with `inlineStylesheets: never` for this reason).
- **Dashboard pages are static HTML**, carrying no data of a person. Personal
  pages live in the Console, which has its own CSP, cookie rules and tests.

## 10. Where the code lives

The owner said "the console plus the API is kind of connected to this". Three
options:

| Option                                                        | For                                                                                                                                            | Against                                                                                                                                                                                                                                 |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Everything in `nyuchi/maps`, served by the Worker's assets | One repo and deploy; `maps.nyuchi.com` is the dashboard, as said; the Worker serves tiles, embed and pages together                            | Signed-in pages need their own WorkOS redirect, client secret, session sealing key and token exchange: a second copy of the Console backend, in a public repo, in the Worker that serves tiles. The cookie cannot be shared (host-only) |
| B. Everything in the Console as a "Maps" section              | Auth, workspaces, key issuing, billing and the shell are already there; zero duplicated security code; one Mzizi upgrade path                  | `maps.nyuchi.com` would have no interface of its own; public pages (Explorer, Endpoints) sit behind sign-in or need a public section; the Console repo is private, so outside developers cannot see the source                          |
| **C. Split by the auth boundary (recommended)**               | Public pages stay on `maps.nyuchi.com`, from this repo, public, with the tile API; the signed-in tools are Console pages that reuse everything | Two deployments to keep visually in step. Mitigated: both use the same `@bundu/ui` version and the same sitemap, and the public site's "Sign in" goes to the Console section                                                            |

Recommended: **C**. The deciding factor is that a second sign-in implementation
is the riskiest piece of code in any option, and the Console already has it, with
the tests and WorkOS configuration. `nyuchi/maps` stays "the pure tile API" plus
public developer pages. This is open question 1.

Under C, the prototype is the design for both halves: the public site ships
Overview (status and coverage, no personal figures), Explorer, Endpoints,
Embed builder (preview), Coverage, and the Console ships Keys, Usage and the keyed
Embed builder, with the same sidebar and pages.

## 11. Phased delivery

Each row is one PR, independently shippable, reviewed and merged by the owner.
Sizes: S under a day, M one to three days, L a week or more.

| #   | Repo                     | PR                                                                                                                                 | Size | Depends on |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------- |
| 1   | `nyuchi/maps`            | Analytics Engine metering (binding, writer, tests), off by a var; no behaviour change                                              | S    | none       |
| 2   | `nyuchi/nyuchi-api`      | `maps` slug in `API_CATALOG`, docs; secret pairs scoped to `maps` work                                                             | S    | none       |
| 3   | `mzizi-dev/packages-npm` | Pill overlay (corners, elevation), `BottomNav`, code block and copy button in Astro, as contract changes                           | M    | owner's Q2 |
| 4   | `nyuchi/nyuchi-api`      | Publishable key kind, origins, rate tier, `GET /v1/maps/key-policy`, quota rollup route                                            | L    | 2          |
| 5   | `nyuchi/maps`            | Key check middleware: policy cache, origin and referer check, per-key rate tiers, kill switch; `ALLOWED_ORIGINS` kept for now      | M    | 4          |
| 6   | `nyuchi/maps`            | `/embed`, `embed.js`, per-key `frame-ancestors`, tests including credits always present                                            | M    | 5          |
| 7   | `nyuchi/maps`            | `/v1/status`, `/v1/coverage(.geojson)`, internal `/internal/v1/usage` (SQL API, secret), rollup cron                               | M    | 1, PR #19  |
| 8   | `nyuchi/maps`            | The public developer site (Astro, `@bundu/ui`, replaces `web/`): Overview, Explorer, Endpoints, Embed builder, Coverage, Changelog | L    | 3, 6, 7    |
| 9   | `nyuchi/nyuchi-platform` | Console "Maps" section: keys with origins, usage, keyed embed builder, coverage; Rust module, tests, `PARITY.md`                   | L    | 4, 7       |
| 10  | `nyuchi/maps`, `docs`    | Move first-party apps to keys, remove `ALLOWED_ORIGINS`; OpenAPI and attribution guidance                                          | S    | 5, 9       |

Owners: the Maps and Console PRs by the build agents under the owner's review; the
Nyuchi API PRs by whoever the owner assigns there (Python today); Mzizi upstream
by the `mzizi-dev` maintainers (the owner's rule is to fix a component upstream,
not to restyle it locally). Things only the owner can do: create the Analytics
Read token and set it as a secret, set `BUILDER_TOKEN` and the internal bearer
secret, decide limits and prices, add WorkOS permissions if any, approve each deploy.

## 12. Risks

- **Pill versus the standard.** A global radius change alters every Console page
  and trips the standard's contract tests ("the brand-overlay rule"). It needs the
  owner's decision and an upstream change, and the Console's density bridge would
  go with it.
- **Publishable keys are spoofable** from outside a browser (section 9). Mitigated
  by limits and quota; the owner should accept that explicitly.
- **Edge lookups add a dependency on the API.** A cache and a fail-closed bound
  limit the blast radius; tile reads never wait on the API on a warm isolate.
- **Retention is three months** in Analytics Engine. Anything longer needs rollups.
- **Sampling.** Analytics Engine samples at high volume; the UI must say "estimated".
- **Two deployments** can drift visually. One package version and one sitemap file.
- **Metering cost** is small until traffic is large; the plan is in section 7.
- **ODbL.** The credit must reach developers' users. The embed enforces it; for
  developers drawing their own map it is guidance only. Counsel should confirm the
  classification of the tiles (README already says so).
- **The Console is private** and its section needs Console review rules (no stubs).
- **Planet or regional data** remains the owner's earlier decision and changes the
  Coverage page's meaning.
- **Not measured:** APCA Lc of every colour pair, screen reader behaviour of the
  prototype, real traffic volumes, and the latency of a policy lookup.

## 13. Open questions for the owner

1. **Where does the signed-in half live?** Recommended: Console "Maps" section for
   keys, usage and the keyed embed builder, with `maps.nyuchi.com` as the public
   developer site (option C). Or all in the Console, or all here with a second
   sign-in implementation.
2. **Pills against the standard.** The Dashboard Standard says small corners. May
   I propose the pill overlay upstream to `mzizi-dev` (and remove the Console's
   density bridge), or should Maps carry it alone?
3. **Publishable keys.** Do you approve a `nyk_` that works alone from a browser,
   bound to a list of origins, read only, `maps` scope only? And should the two
   first-party apps move onto such keys so that `ALLOWED_ORIGINS` leaves
   `wrangler.jsonc`?
4. **Plans, quotas and price** for Maps on free, go, plus, pro, enterprise: the
   monthly tile quota, the per-minute rate tier of each, and whether free keys may
   embed.
5. **Anonymous access.** Do unkeyed requests stay allowed for outside origins (at
   the per-IP limit), or is a key required for anyone who is not first-party?
6. **Phone navigation.** The standard uses a drawer; the brief and Mzizi's mobile
   pattern say a bottom bar. May I contribute a bottom nav to Mzizi's Astro build?
7. **Attribution.** Is "© OpenStreetMap contributors" the only credit that must
   always show, or also a "Nyuchi Maps" mark on every embed? (The map today shows
   both, from the TileJSON.)
8. **Language.** `nyuchi/maps` is TypeScript. Do new endpoints stay in TypeScript,
   or is a Rust port of the Worker the first step?
9. **Usage retention and the embedding site.** Keep daily rollups for how long,
   and may a per-key aggregate of embedding site hostnames be recorded?
10. **Console permission.** Should staff access to the on-demand ledger use a new
    WorkOS permission, and who holds it?

## 14. The prototype

[prototype/](prototype/) is a static Astro site built from the real
`@bundu/ui` 0.17.0 components, with sample data labelled as invented on every
page that has figures. It is not shipped by the Worker and is excluded from the
Worker build. The maps in Explorer, Embed builder and Coverage are real MapLibre
maps drawn from the live tiles through `wrangler dev --remote`. The Embed
builder form updates the preview, and the snippets are static in this version.

Seven pages (Overview, Explorer, Embed builder, Endpoints, API keys, Usage,
Coverage), each captured at phone (390 by 844), tablet (820 by 1180) and desktop
(1440 by 900), light and dark, at device scale factor 2. The captures are in the
reviewer's session scratch folder and are not committed.
