# Developer console design

Status: design and visual prototype for the owner to review. Nothing here is
built, deployed or merged, and nothing of the dashboard is live at
`maps.nyuchi.com`. The prototype is in [prototype/](prototype/).

The owner's words that set this design:

- "This is where we work with the API nyuchi api and servers api need to serve
  Maps over the API should also be embedding option and we should be displaying
  this as a dashboard set up look at mzizi we have all of the components that we
  need. The goal of this is not for people to come here and use our maps ... we
  are not trying in this repo to be a replacement of Google Maps, but we are
  serving basically the tile infrastructure behind people needing map
  infrastructure for their own applications. ... the console plus the API is kind
  of connected to this because those are used to serve people. This is the map
  and tile infrastructure for the whole ecosystem ourselves as well as for other
  people as well."
- "There is only one api, it serves publicly through api.nyuchi.com.
  maps.nyuchi.com does not serve its own api."
- "Internally it serves through the servers api."
- "maps.nyuchi.com is the origin plus a static load so people can actually see
  what they want."
- "Chips or badges and buttons are always pills"; icon-only controls are round;
  all icons are Radix.

## 1. Summary and recommendation

1. **One public API.** Maps becomes a namespace of the Nyuchi API:
   `https://api.nyuchi.com/v1/maps/...` (tiles, TileJSON, styles, glyphs, sprites).
   Callers authenticate with Nyuchi keys, and keys, limits and metering live at the
   API (section 3).
2. **Three layers.** Client to `api.nyuchi.com` (public edge: key, origin check,
   rate limit, tile cache, metering), then the Nyuchi Servers API (internal, Rust),
   then the Maps origin: the `nyuchi/maps` Worker at `maps.nyuchi.com` over R2
   PMTiles, with the on-demand region builder of PR #19.
3. **`maps.nyuchi.com` has two jobs and no public API.** It is the tile origin
   behind the Servers API, and it serves the static developer dashboard
   (Workers static assets, as today). Its `/v1/*` origin routes stop being open to
   the world: the Servers API presents a signed service credential, and the
   dashboard's own maps read from `api.nyuchi.com` with a demo publishable key
   (section 3.4).
4. **The dashboard is the Mzizi Dashboard Standard**: the pure Astro app components
   of `@bundu/ui` 0.17.0 (MIT) over Mzizi's tokens, with the shell's own sidebar,
   collapse toggle, top bar and account menu, the official Nyuchi mark, Radix icons
   through Mzizi's icon seam, pills and round icon buttons through one token
   override (sections 2.1 and 11).
5. **Signed-in tools live in the Nyuchi Console.** The Console already owns WorkOS
   sign-in, sessions, workspaces and key issuing, on the same Mzizi shell. Keys,
   Usage and the keyed Embed builder are a "Maps" section there; the public pages
   are built from this repo (section 10).
6. **What the Nyuchi API and Servers API still lack** is listed with owners in
   section 2.2: a `maps` catalogue entry, publishable keys with origin lists,
   a `maps` namespace in the Servers API that streams binary tiles and keeps their
   cache headers (it sets `no-store` on everything today), and an edge route that
   caches tiles after the key check.
7. **Every existing app moves to the API path**, one at a time behind a config
   value: Kweli first, then tourism, Events, and Weather last (section 2.4 lists
   each, with the URLs it uses today). None of them calls `maps.nyuchi.com`
   today; most use Leaflet with OpenStreetMap or MapTiler raster tiles. After a
   quiet period the origin is locked to the Servers API (section 12).
8. **Embeds** are a static-looking page at `maps.nyuchi.com/embed/` that loads
   tiles from `api.nyuchi.com` with the key; `frame-ancestors` comes from the key's
   origin list (section 6).
9. **Kweli is the places layer.** Maps proposes a Kweli places overlay as a second
   tile source, the dashboard shows verified places and a tier legend, and Kweli's
   place search is the search backend instead of a third-party geocoder (3.7).
10. **Delivery** is seventeen independently shippable PRs across eight repositories
    (section 12.3). **Fifteen decisions are the owner's** (section 14); the first
    three are where the edge runs, whether a browser-only publishable key may exist,
    and the pill rule against the shipped standard.

## 2. Findings

Everything below was read from repositories and public documentation. No
authenticated production endpoint was called. Revisions read: `nyuchi-platform`
4d3171d (2026-11-22), `nyuchi-api` 7d1bad2 (v0.61.0, 2026-11-20),
`nyuchi-servers-api` `main` (README read 2026-11-28), `packages-npm` 4e8d19c,
`mzizi-registry` 8d386e5a (2026-11-23), `mzizi-cli` 79059a4.

### 2.1 Mzizi: stack, nodes and components

Read through the Mzizi MCP (`get_architecture`, `get_tokens` family `floors`,
`list_crates`, `list_components`, `get_component`) and docs.mzizi.dev
(`patterns/dashboard-standard`, `foundations/bundu-floor`, `foundations/icons`,
`roots/overview`, `charts/overview`, `toolchain/cli`).

| Option                              | What exists                                                                                                                                                                                                                                                                                         | Verdict                                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Mzizi Roots (Rust)                  | 17 crates at 0.9.0 in the pinned registry (docs say 14 on crates.io at 0.11.0). UI crates: `mzizi-roots` (alert, badge, card, chart, markdown renderer, progress, safe-area frame, separator), `mzizi-ui` (button, input, label, skeleton, status badge, device code), `mzizi-brand`, `mzizi-shell` | No dashboard shell, side nav, data table, stat tile or form field in Rust. `mzizi-shell` and `mzizi-brand` pull in Dioxus. Not yet |
| Pure Astro (`mz add --type astro`)  | 107 components with an Astro build, including the Dashboard Standard `app-*` components                                                                                                                                                                                                             | **Use this.** Server-rendered HTML, no client framework, works without JavaScript, each component has a contract and tests         |
| React and shadcn (`npx shadcn add`) | The registry's tsx builds                                                                                                                                                                                                                                                                           | Deprioritised by Mzizi; only needed for the Recharts area and line charts, which have no Astro build                               |

The owner's three standing rules, applied:

- **Use Mzizi.** Yes. The frame is `AppShell` with its slots, not a layout of ours.
- **Rust first for anything built.** The Rust crates cannot render this UI, so the
  UI is Astro, as the Console's is. New services are Rust where they are new: the
  Servers API module and the Nyuchi API edge are Rust. `nyuchi/maps` itself is a
  TypeScript Worker today, so changes to it stay TypeScript unless the owner wants
  a Rust port first (open question 9).
- **Where JavaScript stays, use Deno, not Node.** The page ships little: MapLibre
  GL JS (BSD-3-Clause, already vendored here), a copy button, the theme switch and
  the collapse button's `aria-expanded` wiring, all progressive enhancement. The
  build needs a JavaScript runtime for Astro. The commands in
  [prototype/README.md](prototype/README.md) run unchanged under Deno 2, but Deno
  is not installed on this machine, so I built with Node 24.

**Install route.** `@bundu/ui` from npm with an exact pin is what the Console does
and keeps both products on one release. `mz add <name> --type astro` (CLI 0.14.1,
Apache-2.0; `mzizi` is the old name) copies files into `src/components/mzizi/`,
which forks them. Recommended: the pinned package. The prototype built from the
published 0.17.0 renders identically to a build from the local source (compared
on the Overview page, desktop, light, byte for byte).

#### The dashboard, by node

The helix has eight nodes. The dashboard uses six. Counts and versions are from
the registry at 8d386e5a and `@bundu/ui` 0.17.0.

| Node              | Component (registry name)                                                                                                                                                                                                                                                                                               | Used for                                                         | Implementation                                                                | Version or ref     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------ |
| N1 tokens         | `tokens.css`, `theme.css`, `density.css`, `color-scheme.css`, `brand-nyuchi.css`                                                                                                                                                                                                                                        | Colour, type, radii, spacing floors, dark theme, the gold accent | CSS                                                                           | `@bundu/ui` 0.17.0 |
| N1 icon seam      | `lib/icons` (the "swappable" strand; Mzizi names Lucide)                                                                                                                                                                                                                                                                | One place to swap the icon set; ours is Radix (section 11.2)     | Astro, `RadixIcon.astro` (ours)                                               | prototype          |
| N2 primitives     | `app-button`, `badge`, `app-card`, `app-input`, `app-label`, `app-skeleton`, `app-alert`, `segmented-control`, `native-select`                                                                                                                                                                                          | Buttons, badges, cards, fields, the style switch                 | Astro (React and Rust builds exist for 7)                                     | 0.17.0             |
| N3 brand          | `app-brand-mark` (BrandMark)                                                                                                                                                                                                                                                                                            | The official Nyuchi mark in the sidebar head and the top bar     | Astro                                                                         | 0.17.0             |
| N6 pages          | `app-page-header`, `app-stat-tiles`, `app-stat-tile`, `app-bar-chart`, `app-data-table`, `app-filter-bar`, `app-pagination`, `app-detail-panel`, `app-form-layout`, `app-form-field`, `app-state-message`, `app-empty-state`, `app-toast`, `app-confirm-action`, `app-toolbar-menu`, `app-info-tip`, `app-plan-summary` | Every page body                                                  | Astro                                                                         | 0.17.0             |
| N7 shell          | `app-shell` (collapsible sidebar, drawer, top bar, footer, collapse toggle), `app-side-nav`, `app-workspace-switcher`, `app-quick-search`, `app-command-palette`, `app-top-bar-action`, `app-account-menu`, `app-nav`                                                                                                   | The whole frame                                                  | Astro                                                                         | 0.17.0             |
| N7 shell          | `mzizi-bottom-nav`                                                                                                                                                                                                                                                                                                      | Phone navigation with a raised centre "Create a key" button      | Rust (`mzizi-shell`, Dioxus) and React only; ported to Astro in the prototype | registry 8d386e5a  |
| N7 shell          | `mzizi-theme-provider`                                                                                                                                                                                                                                                                                                  | Theme provision                                                  | Rust (`mzizi-shell`) only; the prototype has a small Astro switch             | registry 8d386e5a  |
| N10 documentation | docs.nyuchi.com, `openapi.yaml`                                                                                                                                                                                                                                                                                         | The Docs page and the Endpoints table                            | MDX / OpenAPI                                                                 | existing           |

`mzizi-header`, `mzizi-sidebar` and `mzizi-dashboard-layout` are React-only
compositions of the same idea; `AppShell` supersedes them for Astro and is what the
Console uses. `console-dashboard-page` and `map-page` are React page patterns
(the first is the reference for the Overview, the second is a full-screen map for
end users and does not fit a developer console). `map-view` wraps Mapbox GL JS, so
it is not used.

#### Where the shell defines each piece (and what the prototype did about it)

- **Sidebar head.** `WorkspaceSwitcher` with the mark in its `mark` slot. The
  prototype puts the official Nyuchi mark (BrandMark, 32px) and the name "Nyuchi
  Maps" there; the wordmark carries `data-slot="brand-wordmark"` so the shell hides
  it in the icon rail and leaves the mark.
- **Open and close.** `AppShell` has a collapse toggle in the sidebar foot: a real
  checkbox with the `panel-left` icon, which collapses to a 3.5rem icon rail on a
  desktop and flips its icon. Below 64rem the same `<aside>` is a Popover API
  off-canvas drawer opened by the top bar's menu button, closed by Escape, a click
  outside or its own close button. All of it works without JavaScript. The shell
  announces the toggle as a checkbox. The prototype adds a small enhancement that
  replaces the label with a real button carrying `aria-expanded`, `aria-controls`
  and a changing `aria-label`, keeping the checkbox as the source of truth. It was
  checked with the keyboard (Space toggled it, `aria-expanded` went from `true` to
  `false`). This should become the shell's own behaviour (a gap, below).
- **Theme.** The shell has no theme control; the Console puts "Appearance" in the
  account menu. The owner wants it in the sidebar, so the prototype uses the shell's
  `sidebar-footer` slot for a round, icon-only switch (Radix Sun and Moon) with a
  changing accessible name, stored in `localStorage` (no cookie), applied before
  first paint. The shell hides that slot in the icon rail and in the drawer; the
  prototype overrides that with CSS so the switch stays reachable (a gap).
- **Phone.** `mzizi-bottom-nav` (80px bar, current item marked by a 2.5px accent
  bar, optional raised centre button, hidden from 48rem). The prototype ports its
  markup to Astro: Overview, Explorer, a centre "Create a key", Embed, API keys.
  The drawer behind the top bar's menu button holds the rest.
- **Top bar and account.** `TopBarAction` (Support) and `AccountMenu`.

#### Gaps: what Mzizi lacks, and must gain in the registry first

| Gap                                                                                                                                                                                                                                                                                                                                                              | Needed by                | Where                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------ |
| Pill corners and soft elevation as an overlay. The standard says "Corners use the small radius, not the marketing pill"; the Console even has a "density bridge" forcing small corners. One override, `--radius-sm: 9999px`, makes every `rounded-sm` control (buttons, badges, nav rows, pagination, inputs) a pill and every square icon-only control a circle | Every page               | `mzizi-dev/packages-npm` and the contracts |
| Bottom navigation as an Astro component (`app-bottom-nav`) with a contract                                                                                                                                                                                                                                                                                       | Phone                    | registry, N7                               |
| Theme switch as an Astro component (the Rust `mzizi-theme-provider` has no Astro build)                                                                                                                                                                                                                                                                          | Sidebar                  | registry, N7                               |
| Collapse toggle as a button with `aria-expanded` and `aria-controls`; footer actions kept in the rail and in the drawer                                                                                                                                                                                                                                          | Sidebar                  | `app-shell` and its contract               |
| Code block, tabs and copy button as Astro (React only)                                                                                                                                                                                                                                                                                                           | Endpoints, Embed builder | registry, N2 or N3                         |
| One-time key reveal (client id, masked secret, copy, "shown once"); the Console has a local `CredentialsPanel`                                                                                                                                                                                                                                                   | API keys                 | registry, N6, extracted from the Console   |
| Area and line charts as Astro (Recharts or the Rust `chart` crate); the prototype uses `BarChart`                                                                                                                                                                                                                                                                | Usage                    | registry, N6                               |
| Service status card as Astro (`deployment-status-card`, `mzizi-platform-health` are React or Rust)                                                                                                                                                                                                                                                               | Overview, Status         | registry, N6 or N8                         |
| The icon set. Mzizi's docs name Lucide and `lib/icons` as the swap point; the owner uses Radix. Radix has no key, terminal or map-pin icon; the prototype uses `LockClosed`, `Link2` and `Globe`                                                                                                                                                                 | All icons                | registry `mzizi-icons` (the seam)          |
| A Nyuchi Maps product icon. None exists in Mzizi, the Console or any Nyuchi repository (section 11.1)                                                                                                                                                                                                                                                            | Sidebar, favicon         | owner decision, then the brand assets      |
| `@bundu/ui` exposes `app/nav` from `dist/`, which the source repository does not build; a build from source needs an alias                                                                                                                                                                                                                                       | Builds from source only  | `packages-npm`                             |

**The floor, checked.** `mz floor docs/prototype/src` reports 0 violations
(49 number-rule warnings about values that are not Mzizi numbers, 1 exempt block
with a reason). It enforces 14px inset, 9px between controls, 1.5 leading and 24px
(desktop) or 45px (touch) hit regions. Text uses semantic tokens, which Mzizi holds
to its contrast floor; I did not independently measure APCA Lc on every pair and
that should be done before shipping (`check_accessibility`). The shell's own
controls are 32px on a desktop and 44px on touch, which the registry records as
known gaps against the 45px floor.

### 2.2 The Nyuchi platform side

**The Nyuchi API** is `nyuchi/nyuchi-api` (formerly `nyuchi/api-gateway`), serving
`api.nyuchi.com`: FastAPI on Fly (`nyuchi-api`, `jnb`), one `/v1/<namespace>` tree,
being rebuilt in Rust namespace by namespace behind a Rust edge Worker
(README "Where it is going"; `docs/architecture/rust-routing.md`,
`docs/architecture/data-gateway.md`). The edge, its Worker route, the DNS and the
Fly origins are "owner-only, not done" in those documents; whether `api.nyuchi.com`
is proxied by Cloudflare today is not stated in the repository and I could not
verify it. The target topology is: caller to a Cloudflare edge Worker (rate limits
per credential through Workers bindings, routes `/v1`, adds the internal key), then
a private path to Fly origins.

**Key model** (`gateway/routers/api_keys.py`, `gateway/lib/key_store.py`,
`gateway/lib/api_catalog.py`, `docs/architecture/billing.md`):

| Question             | What exists                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format               | A pair: `client_id` `nyk_...` and `client_secret` `nys_...`. The id alone is not a credential                                                                                                                       |
| Send                 | `X-Client-Id` and `X-Client-Secret`, or `X-API-Key: nyk_....nys_...`, or a one-hour bearer token from `POST /v1/auth/token` (`client_credentials`)                                                                  |
| Issue                | `POST /v1/api-keys {name, entity_id, scopes[], expires_in_days?, key_type}` by a manager of the workspace (family guardian, or organisation founder or admin). The secret is shown once; only its SHA-256 is stored |
| List, revoke, rotate | `GET /v1/api-keys`, `DELETE /v1/api-keys/{id}`, `POST /v1/api-keys/{id}/rotate`; takes effect on the next request; an exchanged token lives at most an hour                                                         |
| Scopes               | Namespace slugs from `API_CATALOG`, `public` or `internal`. **There is no `maps` entry**                                                                                                                            |
| Origins or referrers | **None.** `CreateKeyRequest` has no such field and the key store has no column for it                                                                                                                               |
| Rate limit           | Per key, 60 a minute by default (30 on token endpoints). Not configurable per key                                                                                                                                   |
| Quota                | `monthlyRequestLimit` follows the family's plan; `platform.api_key_usage` holds one row per key (`period`, `request_count`, `last_used_at`)                                                                         |
| Audit                | Every create, rotate, revoke and refusal writes an ids-only audit line                                                                                                                                              |

**The Nyuchi Servers API** is `nyuchi/nyuchi-servers-api` (formerly
`nyuchi/data-gateway`), `api.nyuchiservers.com`, **internal only**:

- **Rust**, one workspace built to three targets: `crates/core` (no I/O),
  `crates/origin` (an axum binary, the Fly app `nyuchi-servers-api`, deployed in
  `jnb`, no public IP) and `crates/edge` (a workers-rs Worker with no public
  route). The README says it does not record whether the tunnel, DNS and edge are
  in place, and no namespace has moved to it yet.
- **Reached over a private path.** A Cloudflare Tunnel; Workers use a Workers VPC
  binding if workers-rs supports one, otherwise a tunnel hostname locked to
  Cloudflare Access service tokens; Fly callers use 6PN.
- **Access is deny by default.** One table, `access::POLICY`, lists every route and
  what it needs; a route not listed is not served. Every credentialed route needs an
  **internal key** (`nyk_` and `nys_`, type `internal`, sent as
  `x-nyuchi-internal-key` or `x-client-id` and `x-client-secret`) **and** an ES256
  bearer token against a JWKS, both carrying the route's scope (`ops`, `shamwari`),
  plus the Cloudflare Access token when configured. Only `/health` and `/ready` are
  open.
- **How a product plugs in.** A namespace is moved or built in this repository with
  its own scope, its own `access::POLICY` rows and an OpenAPI entry, to a contract
  the product writes (Shamwari's is `docs/servers-api-contract.md` in
  `shamwari-ai/shamwari`). The owner's rule of 2026-11-13: every backend service
  reaches data only through this API.
- **Keys and metering.** A ledger-backed `KeyStore` (reads `platform.api_key_lookup`)
  and a `UsageSink` (inserts `platform.usage_events`, upserts
  `platform.usage_counters`) are built, not deployed. Shamwari's
  `POST /v1/shamwari/keys/verify` takes a key prefix and the key's SHA-256 (the raw
  key never arrives); `POST /v1/shamwari/usage/events` takes 1 to 100 allow-listed
  events, idempotent on `requestId`; `GET /v1/shamwari/usage/rollup` returns a
  period total. A found key is cached 30 seconds.
- **Behaviour that matters for tiles.** RFC 9457 problems, W3C Trace Context,
  OpenAPI 3.1; per-address and per-client-id limits before any authentication work;
  request timeout answered `503` with `Retry-After`; a body limit; **every answer
  carries `Cache-Control: no-store`**. There is no proxy or streaming route in the
  README: routes today answer from stores.

**The Console** is `nyuchi/nyuchi-platform/console` (private),
`platform.nyuchi.com`: `console/web` is Astro 7 on the Worker `nyuchi-console-web`;
`console/backend` is a Rust (axum on workers-rs) Worker reached only through a
service binding.

- **Sign-in is WorkOS AuthKit.** The backend does the code exchange, then an RFC
  8693 token exchange at the Nyuchi API for a person token. The browser holds one
  sealed, HttpOnly, host-only cookie and never a token. The AuthKit domain is a
  backend variable and the Console's rules forbid writing it down in code, config,
  tests or docs, so this document does not either. `maps.nyuchi.com` cannot read
  the cookie.
- **Authorization comes from WorkOS.** Operator namespaces reach a person only
  through `console:*` permissions on their roles in the Nyuchi Africa organisation.
  For customers the API checks workspace membership (a manager may mint external
  keys, api-gateway#171).
- **A section is cheap to add** (`CONTRIBUTING-SECTIONS.md`): one nav line, pages
  under `web/src/pages/dashboard/<section>/`, a Rust module under
  `backend/src/sections/`, tests. Its rules: only the backend talks to the API, no
  tokens in the browser, nothing stubbed.
- **Keys exist; usage does not.** `/dashboard/developer` (the API library from
  `GET /v1/api-keys/catalog`) and `/dashboard/developer/keys` (list, create with the
  secret shown once and a credentials-file download, revoke, rotate) are built.
  There is **no usage, quota or billing page** for any product, and no "projects" or
  "teams": the concepts are workspaces (a family or an organisation entity),
  persons and memberships. Billing in the API is behind `BILLING_ENABLED` (off).

A search of the `nyuchi` and `mukoko-dev` organisations for `maps.nyuchi.com` finds
only `nyuchi/maps`, and the Console and API clones mention Maps nowhere. I found no
consumer in those organisations; the `ALLOWED_ORIGINS` list in `wrangler.jsonc`
(`weather.mukoko.com`, `weatherstations.nyuchi.com`) shows the intent, and actual
traffic must be read from logs before the transition (section 12).

**Missing, and who builds it:**

| Missing                                                                                                                                                        | Owner / repo                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `maps` slug in `API_CATALOG`; the `/v1/maps/*` route class at the edge (key and origin check, rate limit, tile cache, metering)                                | `nyuchi/nyuchi-api` (Rust edge)     |
| Publishable key kind, per-key origin list, rate tier, embed flag; the key snapshot the edge reads                                                              | `nyuchi/nyuchi-api`                 |
| A `maps` namespace: scope, policy rows, a streaming, header-preserving origin client with a signed credential, readiness probe, OpenAPI                        | `nyuchi/nyuchi-servers-api`         |
| Origin credential check, demand gating without `ALLOWED_ORIGINS`, trace headers                                                                                | `nyuchi/maps`                       |
| The dashboard site and the embed page                                                                                                                          | `nyuchi/maps`                       |
| Maps section in the Console (keys with origins, usage, keyed embed builder) and the first usage page of any product                                            | `nyuchi/nyuchi-platform`            |
| Pill overlay, bottom nav, theme switch, collapse button, code block, key reveal, charts as Astro; the Radix seam                                               | `mzizi-dev` (registry and packages) |
| The edge route and DNS, tunnel or VPC binding, Access service token, Analytics Engine read token, secrets, Tiered Cache, a demo key, the product icon decision | the owner                           |

### 2.3 What Nyuchi Maps is today

From this repo's `README.md`, `docs/ARCHITECTURE.md`, `src/` and `openapi/`: one
Worker, one R2 bucket, `GET /` a MapLibre page, `/v1/tiles.json`,
`/v1/tiles/{z}/{x}/{y}.mvt`, `/v1/sources/{id}/...`, `/v1/styles/{light,dark}.json`,
`/v1/fonts/...`, `/v1/sprites/...`, `/openapi.json`, `/health`. Access is a CORS
allow-list in `wrangler.jsonc` (`ALLOWED_ORIGINS`) plus a per-IP limit; the page has
`frame-ancestors 'none'`. Keys are "not built". Tiles pass through gzip-compressed
with `encodeBody: "manual"`, a strong `ETag`, `Cache-Control: public, max-age=86400,
s-maxage=2592000, stale-while-revalidate=86400`, and `304` on `If-None-Match`; the
Worker keeps them in the Cache API under a key of path and `TILES_VERSION`. PR #19
(open, not touched here) adds on-demand regions: a z6-cell manifest in R2, a
SQLite Durable Object ledger and builder-only `/internal/v1/regions` routes behind
`BUILDER_TOKEN`, and it records demand only for requests with an allowed `Origin`
and counts per client by a hash of IP and day. I confirmed the live service serves
real tiles (the prototype's maps draw from the real bucket through
`wrangler dev --remote`). The `ALLOWED_ORIGINS` variable is an allow-list in config,
against the owner's rule that authorization comes from the identity provider only;
it goes away in the migration.

### 2.4 Who uses map tiles today

I searched the local clones of the `nyuchi`, `mukoko-dev`, `bundu-labs` and
`mzizi-dev` organisations (revisions 2026-11-21) for `maps.nyuchi.com`,
`nyuchi-maps`, MapLibre, Mapbox, Leaflet, Protomaps, PMTiles, MapTiler,
`tile.openstreetmap` and `style.json`. **No repository calls `maps.nyuchi.com`.**
The two origins in `ALLOWED_ORIGINS` are an intention. What the apps do use today is
other providers, listed here with the change each needs. Repositories that are not
cloned here were not searched.

| Consumer (host)                                       | Repo and where                                                                                                                                                                                                                                                                                                                                                       | What it uses today                                                                                                                                                                                                                      | Change                                                                                                                                                                                                                                                                                                                                   | Key                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Mukoko Kweli** (`kweli.mukoko.com`), core places    | `mukoko-dev/kweli`: `components/place/place-location-map.tsx` (line 55), `components/place/place-list-map.tsx` (line 56), `lib/mcp/places-app.ts` (Leaflet from cdnjs, dark theme by a CSS invert filter)                                                                                                                                                            | Leaflet 1.9.4 with OpenStreetMap raster tiles, `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`. Not in `ALLOWED_ORIGINS`                                                                                                           | Replace Leaflet and raster tiles with MapLibre GL and `https://api.nyuchi.com/v1/maps/styles/{light,dark}.json`; drop the invert filter (a dark style exists); add the Kweli places layer (3.7); update the CSP                                                                                                                          | A publishable key for `https://kweli.mukoko.com`   |
| **Mukoko Weather** (`weather.mukoko.com`)             | `mukoko-dev/mukoko-weather` (the clone `nyuchi/wt-weather-backend` has the same remote): `src/components/weather/map/MapLibreMap.tsx` (52-53), `src/lib/map-layers.ts`, `src/lib/static-map.ts` (92), `src/lib/map-sources.ts`, `src/proxy.ts`, `next.config.ts`, `src/lib/sw-precache.ts`, `workers/crates/weather-core/src/{tiles.rs,web/cache.rs,web/headers.rs}` | MapLibre GL with MapTiler styles, `https://api.maptiler.com/maps/{style}/style.json?key=NEXT_PUBLIC_MAPTILER_API_KEY`, and MapTiler raster PNG tiles for static maps. Its own registry records the MapTiler Free plan as non-commercial | Swap the style URL to the API (one constant); remove the MapTiler credit and CSP entries, keep OpenStreetMap's; keep the Tomorrow.io and NASA overlays, which are not ours. **Static raster tiles have no equivalent** (Maps serves vector only): render the static map with MapLibre, or add a raster endpoint later (open question 13) | A publishable key for `https://weather.mukoko.com` |
| **StationKit console** (`weatherstations.nyuchi.com`) | `nyuchi/stationkit` (`console/`)                                                                                                                                                                                                                                                                                                                                     | In `ALLOWED_ORIGINS`; I found no map code in the clone. It may show the weather app's map                                                                                                                                               | Confirm. If it embeds a map, the same swap; otherwise remove it from the list                                                                                                                                                                                                                                                            | A publishable key for its origin, if it needs one  |
| **Mukoko Events** (`events.mukoko.com`)               | `mukoko-dev/nhimbe` (remote `mukoko-dev/mukoko-events`): `src/lib/map/tiles.ts` (OSM standard, OpenTopoMap, CyclOSM raster), `src/app/map/map-client.tsx`, `src/app/events/[id]/event-map.tsx`, `next.config.ts` CSP (lines 13-69), `src/app/actions/geocode.ts`                                                                                                     | Leaflet 1.9.4 with three raster tile hosts. Geocoding searches its places database, then falls back to `nominatim.openstreetmap.org` server-side                                                                                        | MapLibre GL with the API style (the topo and cycling layers have no Nyuchi equivalent: open question 13); geocoding moves to Kweli's place search (3.7), dropping the Nominatim fallback                                                                                                                                                 | A publishable key for `https://events.mukoko.com`  |
| **Mukoko Events admin**                               | `mukoko-dev/mukoko-events-admin` (`package.json`)                                                                                                                                                                                                                                                                                                                    | Declares Leaflet 1.9.4; I found no tile URL in its source                                                                                                                                                                               | Confirm it is used; then as Events                                                                                                                                                                                                                                                                                                       | As Events                                          |
| **Zimbabwe tourism** (`nyuchi/zti-app`)               | `components/zimbabwe-map.tsx` (118), `components/itinerary-map.tsx` (43), `lib/map-colors.ts`, `e2e/maps.spec.ts`                                                                                                                                                                                                                                                    | Leaflet 1.9.4 with OpenStreetMap raster tiles                                                                                                                                                                                           | MapLibre GL with the API style; update the e2e test                                                                                                                                                                                                                                                                                      | A publishable key for its origin                   |
| `maps.nyuchi.com` itself                              | `nyuchi/maps` `web/`                                                                                                                                                                                                                                                                                                                                                 | The old map page, same-origin `/v1/styles`                                                                                                                                                                                              | Replaced by the dashboard; its maps use the API with the demo key (3.4)                                                                                                                                                                                                                                                                  | The demo key                                       |

Three things follow. First, **migrating means changing a third-party tile or style
URL, not a Nyuchi one**, which also removes a licensing problem (MapTiler's free
plan) and heavy use of OpenStreetMap's own raster servers, whose usage policy is
not meant for application traffic. Second, **most consumers use Leaflet and raster
tiles**, and Maps serves vector tiles, so each moves to MapLibre GL, a real
front-end change in four repositories, not a URL swap. Third, `kweli.mukoko.com` is
missing from `ALLOWED_ORIGINS`, which is moot once keys carry the origins.

## 3. Architecture

```text
 client (browser, app, server)
     |  https://api.nyuchi.com/v1/maps/...   ?key=nyk_...   or X-Client-Id / X-Client-Secret
     v
 api.nyuchi.com  public edge (Nyuchi API, Rust edge Worker)
     |  key and origin check (key snapshot in KV), rate limit per key tier,
     |  Cache API for tiles: hit -> answer;  metering (Analytics Engine) on every request
     |  miss
     v  private path (tunnel or Workers VPC binding, Access service token, internal key + ES256 token, scope maps)
 Nyuchi Servers API  (Rust, Fly, no public IP; namespace "maps")
     |  deny-by-default policy; streams the origin's answer, headers kept;
     |  signed service credential on the request
     v  https://maps.nyuchi.com/v1/...   (signature required)
 maps.nyuchi.com  nyuchi/maps Worker
     |  /v1/*  tile origin: R2 PMTiles, fonts, sprites, on-demand regions (PR #19)
     |  /  /embed/  /assets/*   static dashboard (Workers static assets), public
     v
 R2 bucket (tiles/, fonts/, sprites/, regions)
```

### 3.1 Who does what

| Concern                                         | Layer                                  |
| ----------------------------------------------- | -------------------------------------- |
| Public URL, CORS for browsers, key kinds        | `api.nyuchi.com` edge                  |
| Key check, origin list, rate tier, quota flag   | `api.nyuchi.com` edge (snapshot in KV) |
| Tile cache in front of everything slow          | `api.nyuchi.com` edge (Cache API)      |
| Metering per key                                | `api.nyuchi.com` edge                  |
| Internal path, policy, trace, problem details   | Nyuchi Servers API                     |
| Reading the tile, ETag, range reads on R2, gzip | `maps.nyuchi.com` origin               |
| Regions, demand ledger, builder                 | `maps.nyuchi.com` origin (PR #19)      |
| The dashboard pages and the embed page          | `maps.nyuchi.com` static assets        |

The origin no longer checks keys, applies CORS to `/v1`, or rate limits by
address. Those move to the edge, which is the point at which a key and a browser
`Origin` are both visible. The Servers API sees only cache misses, so it **cannot be
where usage is counted**.

### 3.2 URL scheme

Consistent with the existing `/v1/<namespace>` tree (`/v1/weather`, `/v1/places`):

| Resource                           | Public URL                                                             | Origin route (behind the API)              |
| ---------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------ |
| TileJSON                           | `GET /v1/maps/tiles.json`                                              | `GET /v1/tiles.json`                       |
| Tile                               | `GET /v1/maps/tiles/{z}/{x}/{y}.mvt`                                   | `GET /v1/tiles/{z}/{x}/{y}.mvt`            |
| Other source                       | `GET /v1/maps/sources/{id}/tiles.json`, `.../tiles/{z}/{x}/{y}.{ext}`  | `GET /v1/sources/{id}/...`                 |
| Styles                             | `GET /v1/maps/styles/{light,dark}.json?lang=`                          | `GET /v1/styles/{name}.json`               |
| Glyphs                             | `GET /v1/maps/fonts/{stack}/{range}.pbf`                               | `GET /v1/fonts/...`                        |
| Sprites                            | `GET /v1/maps/sprites/{name}[@2x].{json,png}`                          | `GET /v1/sprites/...`                      |
| Status, coverage (public summary)  | `GET /v1/maps/status`, `GET /v1/maps/coverage`, `.../coverage.geojson` | new, read the manifest                     |
| OGC API - Tiles (tile-contract.md) | `GET /v1/maps/datasets/basemap/tiles/WebMercatorQuad/...`              | the contract's paths under `/v1/datasets/` |

The API rewrites absolute URLs in what it returns: the style's source `url`, the
TileJSON's `tiles` templates, `glyphs` and `sprite` all name
`https://api.nyuchi.com/v1/maps/...`, and carry the `key` parameter through when the
style was requested with one (MapLibre does not add it to the URLs a style names).
This replaces the Worker's `PUBLIC_BASE_URL` for public use. The OpenAPI document in
`openapi/` becomes the `maps` section of the Nyuchi API's.

### 3.3 Authentication at each hop

| Hop                                     | Credential                                                                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Client to `api.nyuchi.com`              | A secret pair (`X-Client-Id`, `X-Client-Secret`) or bearer token from a server; a publishable `nyk_` as `?key=` from a browser, bound to the key's origin list (needs approval, open question 2) |
| Edge to Nyuchi Servers API              | The private path (tunnel or Workers VPC binding), the Access service token, an internal key and an ES256 bearer carrying scope `maps` (the Servers API's own rule)                               |
| Nyuchi Servers API to `maps.nyuchi.com` | A signed service credential on every `/v1` request (3.4)                                                                                                                                         |

### 3.4 Protecting the origin while it serves the dashboard

`maps.nyuchi.com` has a public hostname, so `/v1/*` must refuse callers that do not
come from the Servers API.

- **The credential.** Recommended: an HMAC-SHA256 signature in a header,
  `X-Nyuchi-Origin: t=<unix seconds>,v1=<hex>` over the method, the path with its
  query, and `t`, accepted within 60 seconds, with two secrets accepted so one can
  be rotated. It cannot be replayed for another path and is checked before the
  Cache API is consulted. Both sides hold the secret as a secret (Worker secret and
  Fly secret), never in config. A plain bearer secret is simpler and weaker. An
  alternative or addition is a Cloudflare Access application with a service-token
  policy on `maps.nyuchi.com/v1/*` (the dashboard paths excluded); the origin would
  verify the Access token as well. A missing or bad credential is a `401` RFC 9457
  problem with no hint which.
- **The dashboard's own maps.** Options:

  | Option                                                                | For                                                                                                                                      | Against                                                                                                                              |
  | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
  | **A. Use `api.nyuchi.com` with a demo publishable key** (recommended) | The Explorer and Embed builder show exactly what a developer gets; the origin never serves an unauthenticated browser; one set of limits | Dashboard traffic is metered under a demo key, and the key is public in the page (bound to `https://maps.nyuchi.com`, smallest tier) |
  | B. A same-origin allowance on the origin with its own low limit       | No dependency on the API for the dashboard                                                                                               | Every header is forgeable by a script outside a browser, so it is a free public API at the low rate; contradicts "no second API"     |
  | C. Both                                                               | Dashboard still works if the API is down                                                                                                 | Carries B's hole                                                                                                                     |

- **Existing consumers** are moved to the API path, not left on the origin (section
  12). The origin's unsigned mode exists only as a log-only step before the lock.

### 3.5 Passing tiles through both layers

| Concern         | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Body            | Binary MVT, already gzip. No layer decodes, re-encodes or buffers it: the Servers API streams the upstream body to the response (a hyper or axum streaming body, the HTTP client with automatic decompression off); the edge uses the same manual-encoding rule as `src/http.ts` (`encodeBody: "manual"`)                                                                                                                                                                        |
| Headers kept    | `Content-Type`, `Content-Encoding`, `Content-Length`, `ETag`, `Cache-Control`, `Vary`, `Last-Modified` if present. Hop-by-hop headers dropped                                                                                                                                                                                                                                                                                                                                    |
| Conditional     | `If-None-Match` is forwarded; a `304` from the origin is a `304` to the client, with its validators                                                                                                                                                                                                                                                                                                                                                                              |
| `Cache-Control` | **The Servers API sets `no-store` on every answer today.** The `maps` tile routes need a per-route exception that passes the origin's `Cache-Control` through. This is a change to its policy table                                                                                                                                                                                                                                                                              |
| No range        | A tile is one read of an R2 range inside the origin; clients never send `Range`                                                                                                                                                                                                                                                                                                                                                                                                  |
| Errors          | Origin errors become RFC 9457 problems at the Servers API (`application/problem+json`, `traceId`); a timeout is `503` with `Retry-After` per its rule; a `204` (tile absent) and its short cache pass through                                                                                                                                                                                                                                                                    |
| Trace           | `traceparent` is forwarded to the origin and logged there                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Cache in front  | The edge keeps tiles in the Cache API **after** the key check, under a key of path and tiles version with the `key` parameter and any `Origin` removed, so one object serves every key. Tiered Cache or Cache Reserve in front of the zone reduces misses further (a Cloudflare setting, the owner's). Browsers cache for a day (`max-age=86400`), so a revoked key can still read a tile its browser holds; that is acceptable for public data and is stated in the Console     |
| Misses          | The expected path to the origin is a miss only: a cold tile crosses Cloudflare, the private path, Fly in `jnb`, and Cloudflare again to R2. The hit rate (97 percent in the sample figures, a design assumption, not a measurement) is what makes that affordable; it must be measured before anyone optimises. The alternative of the edge reaching the origin directly after the key check removes two hops, but skips the owner's path, so it is a question (open question 4) |

### 3.6 Metering at the API

Per request, at the edge, into **Workers Analytics Engine** (one data point per
request, written with `waitUntil`). Verified against Cloudflare's documentation
(read 2026-11-28): up to 20 blobs, 20 doubles and 1 index per data point; 250 data
points per invocation; three months of retention; Workers Paid includes 10 million
data points written and 1 million read queries a month (then $0.25 and $1.00 per
million).

| Field     | Value                                                                                                                 |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| `index1`  | The API's key id, or `anon`                                                                                           |
| `blob1`   | Route class: `tile`, `style`, `tilejson`, `glyph`, `sprite`, `embed`, `other`                                         |
| `blob2`   | Source id (`basemap`)                                                                                                 |
| `blob3`   | Status class: `2xx`, `204`, `304`, `4xx`, `429`, `5xx`                                                                |
| `blob4`   | Served from: `edge_cache`, `origin`, `legacy` (the transition)                                                        |
| `blob5`   | Zoom band: `z0-5`, `z6-9`, `z10-12`, `z13-14`                                                                         |
| `double1` | 1 (a count; queries use `SUM(_sample_interval * double1)` because Analytics Engine samples adaptively at high volume) |
| `double2` | Response bytes                                                                                                        |
| `double3` | Duration in ms                                                                                                        |

No IP, no user agent, no URL, no tile coordinates, no cookie, no person id. Cost is
about $25 for each 100 million requests beyond the included 10 million. Quota and
billing use a different path: the edge sends batched, idempotent usage events (up to
100, keyed by a request id, allow-listed fields) and a daily rollup to the Servers
API's ledger (`platform.usage_events`, `platform.usage_counters`), the pattern
Shamwari already uses; the key snapshot carries an `over_quota` flag the edge honours
within its propagation time (60 seconds or less). The Console reads time series
through a person-authorised Nyuchi API route that queries the SQL API with a token
held by the API alone; only 90 days are available, so longer history comes from the
ledger rollups (open question 10).

### 3.7 Kweli: the core places, and how Maps and Kweli fit

**What exists.** Mukoko Kweli (`kweli.mukoko.com`) is the trust platform for Africa
and emerging markets: places, the organisations that operate them, and a five-level
verification ladder (levels 0 to 4, plus attestations such as Community Vouched,
Registered Business and Domain Verified; `app-tier-status` in Mzizi draws it). Its data lives in
the Nyuchi API's `places` namespace (MongoDB `places.places`, each place a
`geo` GeoJSON point, `isActive`, `placeType`, a hierarchy and a verification
state). The API already serves `GET /v1/places` (with `q`, a case-insensitive name
search, and type, city, country, province and category filters), `GET /v1/places/nearby`
(`lat`, `lng`, `radius_km`), `GET /v1/places/{id}` and `/{id}/verification`, a
public `places` scope, and `GET /v1/search?type=places` (the ecosystem search,
k-bounded, public). The Kweli MCP (`kweli.mukoko.com/mcp`, read only for these
tools) offers `search_places`, `get_place`, `get_organization`, `get_verification`
and `get_open_stats`. Places are seeded from OpenStreetMap through Overpass by
Kweli's ingestion agents. There is **no bounding-box query and no vector-tile or
GeoJSON-by-area endpoint** for places.

**Decision proposed: Maps carries a Kweli places overlay, as a second tile
source.** `docs/ARCHITECTURE.md` already planned it ("a second archive, one entry in
`SOURCES`"). Concretely:

- A job reads every active, public place through the API (not the database: the
  owner's rule is that backend services reach data only through the API path) and
  writes `tiles/kweli-places.pmtiles` to R2 with tippecanoe or planetiler: one
  point layer with `id`, `name`, `placeType`, `slug` and the verification level
  (an integer 0 to 4) and attestation flags. Nothing personal: the `PLACE_PUBLIC`
  gate of the ecosystem search is the rule, and no owner, reviewer or contact fields.
- It is served as a source of the origin and reaches clients as
  `GET /v1/maps/sources/kweli-places/tiles/{z}/{x}/{y}.mvt` and its TileJSON, and as
  an optional style, `.../styles/light.json?overlays=kweli-places`, whose layers are
  clustered points below a zoom and verification-coloured markers above it. Credits
  stay in the TileJSON (the layer's own `attribution`).
- It is rebuilt by schedule (nightly to start) and on demand after a verification
  change, bumping a per-source version in the cache key so tiles are not stale for a
  month. Freshness is the cost of a tile overlay: a place that changes tier shows at
  the next rebuild.
- The marker design is Mzizi's: `map-marker` (default, verified, featured and
  cluster states with verification tier indicators), `map-cluster` and `map-card`.
  They exist only as React, so the layer's look is a MapLibre style plus the card
  rendered by Kweli, with the components as the design reference. A registry
  Astro or Rust build is a gap.
- **Kweli's own maps** then use the same API: one style, the overlay, and Kweli's
  place card on click, replacing both Leaflet components.

**What the dashboard shows from Kweli.** Coverage gains a "Places from Kweli" card:
active public places (and by country), how many are at each verification level, and
a legend of the five levels and the attestation chips, from the Kweli open
statistics. The Explorer gains a layer switch for the overlay. The prototype shows
the Coverage card with invented figures.

**Search and geocoding.** Maps serves tiles, not geocoding, and has no search box
(the existing README says why). Kweli's place search is the natural backend for
every map UI instead of a third-party geocoder: `GET /v1/places?q=` is the
suggestion list, `GET /v1/places/nearby` the radius query, and `GET /v1/search`
reaches events, circles, entities and news as well. Mukoko Events already runs "our
places first, OpenStreetMap Nominatim as the fallback", and the Nyuchi API's
`places/resolve` route is designed for "search OpenStreetMap or GeoNames, select,
then resolve" for the weather backend. Three gaps: place search covers only what
Kweli holds (a fallback for an address Kweli does not know is still needed, and it
should be a Nyuchi-side geocoding route, not browsers calling Nominatim); there is no
bounding-box endpoint, so "places in this map view" needs either the overlay tiles
or a new `bbox` parameter; and `places:resolve` is internal and not built. A search
box in the dashboard's Explorer would use `GET /v1/places?q=` and add nothing else.

**Who builds it.** The overlay job and source: `nyuchi/maps` (and
`nyuchi/maps-region-builder` for the pattern); the places read for the job and any
`bbox` and `kweli_stats` additions: `nyuchi/nyuchi-api` (Kweli's data) with
`mukoko-dev/kweli` for its statistics; Kweli's switch to MapLibre: `mukoko-dev/kweli`;
the marker components: `mzizi-dev`.

## 4. Product: what a map-infrastructure developer needs

| Need                                            | Why                                                       |
| ----------------------------------------------- | --------------------------------------------------------- |
| Know it is up, and how much of the world it has | Trust before integrating                                  |
| See what they will get                          | A live map, in both styles                                |
| Copy a working integration in their stack       | Time to first tile                                        |
| Embed without writing code                      | Many users want an iframe, not an SDK                     |
| Get and manage keys safely                      | Per-key origins and limits, rotate, revoke                |
| See what they use                               | Requests, bytes, cache hits, errors, quota                |
| Request a region                                | The service builds missing regions on demand (PR #19)     |
| Know the licence obligations                    | ODbL credit is mandatory and must be shown to their users |
| Find the contract                               | OpenAPI, the tile contract, a changelog                   |

### Sitemap

```text
Maps
  Overview            health, usage, coverage at a glance
Build
  Explorer            live preview of the base map, style switch
  Embed builder       iframe and web component, live preview, copy
  Endpoints           TileJSON, XYZ, styles, glyphs, sprites, snippets
Manage
  API keys            publishable and secret, origins, limits
  Usage               requests, bytes, cache, errors, per key
  Coverage            stored areas, on-demand regions
Learn
  Product icon        the mark in use and a proposed Maps icon (design review only)
  Docs  Status  Changelog
```

### Per-page specification

"Public" means no sign-in. "Signed in" means a Console session.

| Page                    | Shows                                                                                                                                                                    | Reads or writes                                                                      | Built where                                            | Access                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------- |
| Overview                | Four stat tiles with trend in words, a requests-per-day bar chart, service status badges, quick actions, coverage by area, recent activity                               | Public: `GET /v1/maps/status`, `/coverage`. Signed in: the usage figures             | Public part here; personal part in the Console         | Mixed                                    |
| Explorer                | The Nyuchi base map, Light and Dark segmented control, copy style URL (the `api.nyuchi.com` one), live centre and zoom, tile source, the credits                         | `GET /v1/maps/styles/*.json` and tiles through `api.nyuchi.com` with the demo key    | This repo                                              | Public                                   |
| Embed builder           | Form (style, centre, zoom, markers, controls, key), live preview, the allowed origins of the chosen key, the credits notice, copy tabs (iframe, web component, MapLibre) | The embed page; the list of my publishable keys                                      | Public mode here (demo key); keyed mode in the Console | Public preview; keys need sign-in        |
| Endpoints               | Base URL `https://api.nyuchi.com/v1/maps` with copy, a table of resources and paths, snippets for MapLibre GL JS, Leaflet, OpenLayers, Flutter, iOS, Android, curl       | Static, generated from the OpenAPI document                                          | This repo                                              | Public                                   |
| API keys                | A table (name, key prefix, type, origins, rate limit, last used, status), create form, the one-time secret panel, rotate, revoke with a confirm step                     | Nyuchi API `/v1/api-keys*` through the Console backend; new origin and tier fields   | Console                                                | Signed in; a workspace manager creates   |
| Usage                   | Stat tiles, bytes and errors per day, requests by key and zoom band, a per-key table, date-range menu                                                                    | A new person-authorised API route over Analytics Engine, through the Console backend | Console                                                | Signed in; my keys only                  |
| Coverage                | Stat tiles, the real map with the stored areas outlined, a table of regions and their state                                                                              | Public: `GET /v1/maps/coverage(.geojson)`. Staff: the ledger state (PR #19)          | Public here; ledger detail in the Console              | Public summary; ledger detail staff only |
| Docs, Status, Changelog | Link out to `docs.nyuchi.com`, `status.nyuchi.com` and the release notes                                                                                                 | Existing                                                                             | Existing                                               | Public                                   |

Every state is worded once through `StateMessage`: empty, loading (skeletons the
shape of the content), error, not configured, unavailable. A missing figure reads
"Not available", never 0.

## 5. Contracts

### 5.1 Nyuchi API additions (`nyuchi/nyuchi-api`)

1. **`maps` in `API_CATALOG`** (`access: public`), "Maps API". With this alone, an
   outside developer can mint a `nyk_`/`nys_` pair scoped to `maps` through the
   existing Console key page.
2. **Publishable keys.** A key kind for browsers: the `nyk_` id alone, read only,
   scope `maps` only, valid only from the origins on the key's list
   (`https://www.example.com` or `https://*.example.com`, the rule the Maps Worker's
   `src/cors.ts` already implements), with `rate_tier` and an `embed` flag. Created
   and edited through the existing key routes and the Console page. Whether it
   should exist is a security decision for the owner (open question 2).
3. **The key snapshot.** The edge reads keys from KV (`{client_id -> {kind, secret
SHA-256 for a pair, scopes, origins, tier, embed, status, expires, over_quota}}`),
   published on create, rotate, revoke and plan change, the mechanism the data
   gateway already plans for snapshots. Revocation reaches the edge within the KV
   propagation time and the Console says so.
4. **An embed policy read** for the embed page (6): `GET /v1/maps/keys/{client_id}/embed`
   returns `{"active":true,"origins":[...]}` for a publishable key with the embed
   flag, and `404` otherwise. Origins are not secret (a browser sends them), and the
   answer is cacheable for 60 seconds.
5. **Usage read.** `GET /v1/maps/usage?key_id=&from=&to=&bucket=day&group_by=`, with
   a person token that manages the key's workspace; it queries Analytics Engine with
   a token only the API holds, and returns `sampled: true`.
6. **Errors and headers:** RFC 9457 problems and the IETF `RateLimit` headers, as the
   platform's engineering bar requires.

### 5.2 Nyuchi Servers API (`nyuchi/nyuchi-servers-api`)

A `maps` namespace, scope `maps`, deny-by-default rows in `access::POLICY` for
exactly the origin routes in 3.2 and no others:

```http
GET /v1/maps/tiles/{z}/{x}/{y}.mvt        (and the routes of 3.2)
x-nyuchi-internal-key: nyk_<id>.nys_<secret>      internal key, scope maps
Authorization: Bearer <ES256 token, scope maps>
If-None-Match: "<etag>"                            forwarded
-> streams the origin's answer: status, ETag, Cache-Control, Content-Encoding, Content-Length, Vary
```

It adds: the origin client (HTTP client with decompression off, streaming body, a
timeout under its request timeout), the signature of 3.4, a readiness probe of the
origin's `/health`, `traceparent` forwarding, the per-route `Cache-Control`
exception, and an OpenAPI entry. It does not count usage and does not hold keys of
customers.

### 5.3 Origin contract (`nyuchi/maps`)

- `/v1/*` requires the signature of 3.4 (`401` problem otherwise), checked before
  the cache; `/health` stays open; the static paths (`/`, `/assets/*`, `/embed/`,
  `/favicon.*`, `/robots.txt`) stay public.
- No CORS headers and no per-address limit on `/v1` once the transition ends; both
  belong to the edge.
- **Demand recording (PR #19) changes.** Today it needs an allowed `Origin` and a
  hash of the client address. Behind the API the Servers API forwards two values the
  edge computed and the signature covers: whether this key's tier may trigger
  on-demand regions, and a privacy-preserving client token (a truncated SHA-256 of
  address and day, never the address). `ALLOWED_ORIGINS` is no longer consulted. This
  is a follow-up PR after #19 merges, not a change to it.
- Styles and TileJSON take their public base URL from a variable that is
  `https://api.nyuchi.com/v1/maps`, and carry the `key` through.
- RFC 9457 problems, `traceparent` logged.

### 5.4 Console backend (`nyuchi/nyuchi-platform`)

A `maps` section: `backend/src/sections/maps.rs` with `GET /api/maps/keys` (through
the API's workspace and key routes), `GET /api/maps/usage` and
`GET /api/maps/coverage`. The usage route is the API's person-authorised route (5.1.5),
so a person can only read keys their workspaces own. Pages under
`web/src/pages/dashboard/maps/`, one nav line under "Developer", rows in `PARITY.md`.

## 6. Embed design

Two forms, one source.

```html
<iframe src="https://maps.nyuchi.com/embed/?style=light&center=31.05,-17.83&zoom=11&key=nyk_..."
  width="600" height="400" loading="lazy" title="Map of Harare" allow="geolocation"></iframe>

<script type="module" src="https://maps.nyuchi.com/embed.js" integrity="sha384-..." crossorigin="anonymous"></script>
<nyuchi-map style-name="light" center="31.05,-17.83" zoom="11" key="nyk_..." label="Map of Harare"></nyuchi-map>
```

- **The embed document is on `maps.nyuchi.com`** and is a page of the static load.
  Its script loads MapLibre from `self` and reads the style, tiles, glyphs and
  sprites from `https://api.nyuchi.com/v1/maps/...` with the key. Its CSP is the
  dashboard's with `connect-src` and `img-src` naming `api.nyuchi.com`.
- **`frame-ancestors` is the gate for embedding.** A static file cannot vary a
  header per key, so the Worker answers `/embed/` itself: it asks the API's embed
  policy read (5.1.4), caches it for 60 seconds, and sets
  `Content-Security-Policy: frame-ancestors <the key's origins>`. An unknown, revoked
  or embed-disabled key, or none, gets `frame-ancestors 'none'` and a plain page
  saying why. This is the one place `maps.nyuchi.com` calls the API for policy.
- **Tile requests from the frame** carry `Origin: https://maps.nyuchi.com`, not the
  embedding site's. The edge therefore accepts a publishable key from either an
  origin on its list or, if its embed flag is set, from the embed host (a variable,
  not a list of customers). Embedding is gated by `frame-ancestors`; direct use is
  gated by the origin list.
- **`embed.js`** defines `<nyuchi-map>`. It creates the same iframe, so one path
  enforces the rule. It reads `style-name`, `center`, `zoom`, `markers`, `controls`,
  `lang`, `key`, `label`, sets the iframe `title` from `label`, and reads no page
  data. It is versioned by a content-hashed path, and the builder's snippet carries
  a Subresource Integrity hash for that exact file.
- **Credits are always present**, from the TileJSON the style points at, drawn by
  MapLibre's attribution control. There is no parameter to hide them, and the
  builder says so. ODbL requires "© OpenStreetMap contributors" wherever the map is
  shown; the snippets tell developers who draw their own map to show it too.
- **Markers** are `lng,lat` pairs, at most 50, validated numerically, no labels from
  the query string. **Privacy:** no cookies, no storage, geolocation only if the
  embedder grants it and the visitor accepts, no analytics script.

## 7. Authentication and authorization

- **Anonymous pages** (Overview status, Explorer, Endpoints, Coverage summary, the
  Embed builder preview) need no sign-in and carry no personal data.
- **Signed-in pages** use the Console's mechanism unchanged: WorkOS AuthKit, the
  backend's sealed host-only cookie, a person token by RFC 8693 exchange, and every
  API call made by the backend as the person. The browser never holds a token; the
  tile layers never see a person.
- **Authorization comes from the identity provider and the API only.** Customers:
  workspace membership. Staff: `console:*` WorkOS permissions (a new one for the
  on-demand ledger, added in WorkOS by the owner, not in code). No email, domain or
  origin allow-list is written in code or config; the allowed origins of a key are
  data on the key.
- **Each hop trusts the one before it by secret, not by address**, and every secret
  is a Worker or Fly secret, never in `wrangler.jsonc` or `fly.toml`.
- **The existing tension.** `ALLOWED_ORIGINS` in `wrangler.jsonc` is an allow-list in
  config. It is retired in the migration (section 12), and the two first-party apps
  get keys.

## 8. Security

- **`nys_` never reaches a browser.** The Embed builder, snippets and key page only
  ever show a `nyk_` in a page; a secret appears once, at creation, in `no-store`
  responses, as the Console does today.
- **No secret in a URL.** A secret goes in `X-Client-Secret` or a bearer token. A
  publishable `nyk_` may be `?key=` because it is public by design and bound to
  origins.
- **An origin list is a hotlinking control, not authentication.** A script outside a
  browser can send any `Origin` or `Referer`. The list stops other sites showing the
  map on someone else's key; it does not stop scraping. The controls against
  scraping are the per-key rate tier, the monthly quota, anomaly checks on the usage
  series, quick revoke and rotate, and the cache. The Console says this plainly
  rather than promising more.
- **Origin matching** reuses `isOriginAllowed`'s rule (exact, or `https://*.host`,
  never the bare apex), compares parsed origins and never substrings; `Referer` is
  the fallback for image loads without an `Origin`.
- **Order at the edge:** key check, then cache, then metering. The cache key holds
  neither the key nor the origin, so one object serves everyone.
- **Fail open or closed.** A key snapshot older than ten minutes fails closed for
  keyed requests; anonymous requests (if allowed, open question 5) are unaffected. A
  kill switch variable returns the edge route to a plain pass-through of the old
  behaviour during the transition.
- **Origin credential:** signed, short-lived, per path, two secrets for rotation, a
  generic `401`.
- **Abuse:** per-key and per-address limits, ceilings on markers and zoom, strict
  validation of every query parameter (the existing rule), `429` with `Retry-After`.
- **CSP** stays `self` plus `https://api.nyuchi.com` for the maps, no inline script or
  style (the prototype is built with `inlineStylesheets: never`).
- **Dashboard pages are static HTML** with no data of a person; personal pages live in
  the Console under its own CSP, cookie rules and tests.

## 9. Product icon

Mzizi's BrandMark ships the Nyuchi mark (the bee), Mukoko, and Kweli (a shield with a
tick, Kweli's own artwork, with its own favicon, apple-touch and maskable icons);
`nyuchi/workspace-tools` holds the "bundu-ecosystem-icons" pairs for Nyuchi, Mukoko,
Shamwari, Bundu, Travel and Telia. I searched Mzizi, `mzizi-registry`, the Console,
`workspace-tools` and the other local clones: **there is no Nyuchi Maps icon.** The
sidebar head, the top bar and the favicon therefore use the official Nyuchi mark
(the Console's own favicon pair, copied). Kweli shows that a product may have its
own icon, so the prototype's "Product icon" page shows a **proposal for the owner to
approve**: a rounded gold tile with a faint tile grid and a dark pin, built from
Mzizi's gold brand fill and on-brand colour. It is not used as the logo anywhere.

## 10. Where the code lives

Revised for the owner's corrections: **`nyuchi/maps` is the tile origin and the
static dashboard**; the public API is the Nyuchi API's.

| Repo                               | Holds                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `nyuchi/maps`                      | The origin Worker (`src/`), the static dashboard and embed page (`site/`, built to `public/`), the origin contract |
| `nyuchi/nyuchi-api`                | The `maps` catalogue entry, key kinds, the Rust edge route class, the usage route                                  |
| `nyuchi/nyuchi-servers-api`        | The `maps` namespace (Rust)                                                                                        |
| `nyuchi/nyuchi-platform` (Console) | The signed-in Maps section                                                                                         |
| `mzizi-dev/*`                      | The gaps in 2.1                                                                                                    |

**Signed-in half.** A second sign-in implementation inside `nyuchi/maps` would be a
copy of the Console's backend in a public repository, in the Worker that serves
tiles, and the Console's cookie is host-only so it cannot be shared. So keys, usage
and the keyed embed builder are Console pages; the public site links to them from
"Sign in". Alternatives are all in the Console (the public pages then sit behind
sign-in or in a public section) or all here with its own session (open question 1).

**How the static site is built in this repo.** Today `web/` is built by
`scripts/build-web.mjs` (Node built-ins only, runs under Deno) into a committed
`public/`, and CI's `check:web` fails if it is stale, so a deploy needs no build.
Recommended: keep that convention. The Astro source moves to `site/` with its own
`package.json` and lockfile, so the Worker's `npm ci`, tests and typecheck do not
depend on Astro; `npm run build:site` writes `public/` (the Astro output plus the
vendored MapLibre at its versioned path); `check:site` fails when `public/` is
stale; the deploy still ships committed files. Generated diffs are accepted so that
the deploy job stays free of a build toolchain. The alternative is to build in CI and
stop committing `public/`, which makes the deploy job run Astro with its credentials
present. The old `web/` page is removed once the dashboard replaces it.

## 11. Icons, theme and the dashboard frame

### 11.1 The frame

The prototype uses `AppShell` with `accent="gold"`, the `workspace` slot
(`WorkspaceSwitcher` with the Nyuchi mark and "Nyuchi Maps"), `search`
(`QuickSearch` and `CommandPalette`), `nav` (`SideNav` fed by a `NAV` data array,
as the Console does), `brand`, `actions`, `account`, `sidebar-footer` (the theme
switch beside the shell's collapse toggle), the page, `footerLinks`, and a
`BottomNav` for phones. It is not a layout of ours.

### 11.2 Radix icons through Mzizi's seam

Mzizi's docs name Lucide and `lib/icons` as the single swap point (one of the three
declared fork seams). `@bundu/ui` itself draws a curated stroke set. The prototype
implements the seam: `RadixIcon.astro` has the props of `Icon.astro` and draws the
Radix icon (`@radix-ui/react-icons` 1.3.2, MIT) that stands in for each Mzizi icon
name; a Vite plugin points every `Icon.astro` import, inside `@bundu/ui` too, at it;
`scripts/gen-radix.mjs` generates `src/radix.ts` from the package. Radix has no key,
terminal or map-pin icon, so `LockClosed`, `Link2` and `Globe` stand in; the owner
may prefer another.

## 12. Migration and phased delivery

The owner's decisions: the existing apps are **routed through the Servers API**
(client, `api.nyuchi.com`, Servers API, origin), not left on the origin; after
the last one has moved and a quiet period has passed, the origin is **locked to the
Servers API**; the static dashboard stays public; and there is no dual mode longer
than it needs to be.

### 12.1 Moving each consumer

Order, with the reason. Each consumer ships its own PR, behind one configuration
value (for example `NEXT_PUBLIC_MAPS_STYLE_URL`), so the old provider is one value
away.

| Step | Consumer                                                                 | Why this position                                                                                                              |
| ---- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 0    | The dashboard (demo key)                                                 | Proves the whole path with no one depending on it                                                                              |
| 1    | `kweli.mukoko.com`                                                       | Core places; pilot of the overlay; the app that is already "ours" and has the smallest map surface (two components)            |
| 2    | `nyuchi/zti-app`                                                         | Two components, no overlay, low risk                                                                                           |
| 3    | Mukoko Events (and its admin)                                            | Three raster layers to replace by one style; geocoding moves to Kweli search                                                   |
| 4    | `weather.mukoko.com`, and `weatherstations.nyuchi.com` if it shows a map | Largest traffic and the static raster gap; last, so the path is proven; the MapTiler licence is the reason not to wait forever |

Per consumer:

1. **Get a key.** A manager of the Nyuchi Africa workspace creates a publishable
   key in the Console for that app, with its origin list (its production and beta
   hosts), tier and embed flag. Where a browser key is not appropriate (a server
   that renders maps, such as the weather workers' static tiles), a secret pair held
   as a secret and used from the server through the API's header form; never in a page.
   (`POST /v1/app-keys` is for an app's developers, bound to free-tier namespaces; first-party
   keys are workspace keys.)
2. **Swap behind the value.** Style URL (and for Leaflet apps, the move to MapLibre
   GL), CSP entries, attribution (the TileJSON carries it), remove the old provider's
   key and credit.
3. **Verify**, in the app's preview deployment against the live API: the style loads
   in both themes, a z0 tile, a z14 tile, a glyph range, the sprite sheet at 1x and
   2x, `304` on a repeat, the credits visible, no request to the old provider, no
   console error, and the Console's Usage page shows the key's requests.
4. **Release** the value to production. Watch the key's error rate for a day.
5. **Rollback** is the value: put the old URL back. The key stays.
6. **Then the next.**

### 12.2 Locking the origin

Since no repository calls `maps.nyuchi.com/v1` today, the origin may already be
unused except by people who found it. Sequence:

1. **Log-only.** The origin verifies the signature and logs unsigned requests but
   still serves them (`ORIGIN_AUTH=log`), counting them as `legacy` in the metering.
   This ships first, so the count is known before any consumer moves.
2. Consumers move (12.1). The Servers API route and the edge route are live behind a
   kill switch from the start.
3. **Quiet period.** Unsigned traffic is zero for the period the owner chooses
   (proposal: 14 days after the last consumer, with one weekly cycle in it; the
   weather app has the weekend and month-start patterns).
4. **Lock.** `ORIGIN_AUTH=enforce`: every `/v1` route needs the Servers API's
   signature, so the origin is no longer usable directly. The static dashboard, the
   embed page and `/health` stay public. `ALLOWED_ORIGINS`, the per-address limiter
   and `/v1` CORS are deleted in the same PR. Rollback is the variable.

There is no longer-lived dual mode: `log` exists only until the lock.

### 12.3 Phased PRs

Each row is one PR, independently shippable, merged by the owner. Sizes: S under a
day, M one to three days, L a week or more.

| #   | Repo                                                         | PR                                                                                                                                                   | Size | Depends on                        |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------- |
| 1   | `nyuchi/nyuchi-api`                                          | `maps` slug in `API_CATALOG`, docs; secret pairs scoped to `maps` work                                                                               | S    | none                              |
| 2   | `nyuchi/maps`                                                | Origin signature check in `log` mode, trace headers, `legacy` count; no behaviour change                                                             | S    | none                              |
| 3   | `nyuchi/nyuchi-servers-api`                                  | `maps` namespace: policy rows, signed streaming origin client, `Cache-Control` exception, readiness probe, OpenAPI, tests                            | L    | 2                                 |
| 4   | `nyuchi/nyuchi-api`                                          | Publishable key kind, origins, tier, embed flag; the KV key snapshot                                                                                 | L    | 1                                 |
| 5   | `nyuchi/nyuchi-api`                                          | Rust edge route class `/v1/maps/*`: key and origin check, tier limits, tile cache after the key check, metering to Analytics Engine, URL rewriting   | L    | 3, 4, the owner enabling the edge |
| 6   | `nyuchi/maps`                                                | `/embed/` with per-key `frame-ancestors`, `embed.js`, tests including credits always present                                                         | M    | 4                                 |
| 7   | `mzizi-dev/packages-npm` (and the registry)                  | Pill overlay, `app-bottom-nav`, theme switch, collapse button with `aria-expanded`, code block and copy, key reveal, Radix seam, as contract changes | M    | owner's Q3                        |
| 8   | `nyuchi/maps`                                                | The static dashboard in `site/` (Overview, Explorer, Embed builder, Endpoints, Coverage, Changelog), `build:site`, `check:site`; CSP names the API   | L    | 5, 6, 7                           |
| 9   | `nyuchi/nyuchi-api`, `nyuchi/nyuchi-servers-api`             | Usage events and rollups into the ledger; the person-authorised usage route; quota flag in the snapshot                                              | M    | 5                                 |
| 10  | `nyuchi/nyuchi-platform`                                     | Console "Maps" section: keys with origins, usage, keyed embed builder, coverage ledger; Rust module, tests, `PARITY.md`                              | L    | 4, 9                              |
| 11  | `nyuchi/maps`                                                | Kweli places overlay: the export job, the `kweli-places` source and style option                                                                     | M    | 5, 12                             |
| 12  | `nyuchi/nyuchi-api`                                          | Places additions for the job: a bulk or `bbox` read, verification level in the public place shape, open statistics                                   | M    | none                              |
| 13  | `mukoko-dev/kweli`                                           | Swap Leaflet and OSM raster for MapLibre GL and the API style, add the places layer, update the CSP                                                  | M    | 5, 11                             |
| 14  | `nyuchi/zti-app`                                             | Same swap for its two map components and its e2e test                                                                                                | S    | 5                                 |
| 15  | `mukoko-dev/mukoko-events` (`nhimbe`), `mukoko-events-admin` | Swap the tile layers; geocoding through Kweli place search                                                                                           | M    | 5, 12                             |
| 16  | `mukoko-dev/mukoko-weather`                                  | Swap MapTiler style for the API style; remove its credit and CSP; static map by MapLibre or a raster endpoint                                        | M    | 5                                 |
| 17  | `nyuchi/maps`                                                | `ORIGIN_AUTH=enforce`; delete `ALLOWED_ORIGINS`, the address limiter and `/v1` CORS; demand gating from signed values (follow-up to #19)             | S    | the quiet period, #19             |

Owners: the Maps, Console and Servers API PRs by the build agents under the owner's
review; the consumer PRs in each app's repository by the agents working there; the
Nyuchi API PRs by whoever the owner assigns there (Python today, Rust for the edge);
Mzizi upstream by the `mzizi-dev` maintainers. Only the owner can: enable the edge
route and DNS, create the tunnel or VPC binding and the Access service token, set the
origin secret, the Analytics Engine read token and the demo key, turn on Tiered Cache,
create the app keys, decide limits, prices and the quiet period, add WorkOS permissions,
approve each deploy.

## 13. Risks

- **Leaflet to MapLibre is a front-end rewrite** in four repositories, not a URL swap; the topo and cycling layers have no equivalent; static raster maps need a decision.
- **The Kweli overlay is stale between rebuilds,** and a place's tier shown on a map is public; only places that already pass the public gate may be exported.
- **Three hops for a cold tile.** Fly in `jnb` between two Cloudflare layers is slower
  for users far from it and adds a dependency. Mitigated by the edge cache; the hit rate
  is unmeasured. A direct edge-to-origin path is the fallback (open question 4).
- **The edge is not deployed.** The Rust edge Worker, its route and DNS are owner-only
  and not done, and I could not confirm that `api.nyuchi.com` is proxied by Cloudflare.
  Without an edge the tile route cannot be cached or keyed cheaply, and FastAPI is the
  wrong place for binary tiles.
- **The Servers API is internal and young:** deployed in one region, no namespace moved,
  its limiters in memory per machine, its ledger stores built but not deployed.
- **`no-store` everywhere** in the Servers API is the opposite of what tiles need; the
  exception must be per route and tested.
- **Pill against the standard.** A global radius change alters every Console page and
  trips the standard's contract tests; it needs the owner's decision and an upstream
  change, and the Console's density bridge would go with it.
- **Publishable keys are spoofable** from outside a browser (section 8).
- **Retention is three months** in Analytics Engine; longer needs rollups. Sampling means
  the UI says "estimated".
- **A public demo key** is a free sample of the service; bound to one origin and the
  smallest tier.
- **Origin credential rotation** needs both secrets live at once.
- **ODbL.** The credit must reach developers' users. The embed enforces it; for developers
  drawing their own map it is guidance. Counsel should confirm the classification of the
  tiles (the README already says so).
- **The Console is private**, and its section follows its review rules (no stubs).
- **Not measured:** APCA Lc of every colour pair, screen reader behaviour of the
  prototype, real traffic and hit rates, latency across the three hops.

## 14. Open questions for the owner

1. **Where does the signed-in half live?** Recommended: Console "Maps" section for keys,
   usage and the keyed embed builder, with `maps.nyuchi.com` as the public dashboard and
   origin. Or everything in the Console, or everything here with a second sign-in.
2. **Publishable keys.** Do you approve a `nyk_` that works alone from a browser, bound to
   a list of origins, read only, `maps` scope only, plus an embed flag? Without it a
   browser map needs a server in between.
3. **Pills against the standard.** The Dashboard Standard says small corners. May I
   propose the pill overlay upstream to `mzizi-dev` (and remove the Console's density
   bridge), or should Maps carry it alone?
4. **The path of a tile.** Keep client, `api.nyuchi.com`, Servers API, origin for every
   tile (your path), or let the edge fetch from the origin directly after the key check
   and keep the Servers API for control calls? The first is what you described; the
   second saves two hops on every cold tile.
5. **Anonymous access.** Do unkeyed requests stay allowed for anyone (at a per-address
   limit), or is a key required for everyone who is not first-party?
6. **Plans, quotas and price** for Maps on free, go, plus, pro, enterprise: monthly tile
   quota, per-minute tier, whether free keys may embed, and whether the demo key exists.
7. **Origin credential.** A signed request (recommended), a plain bearer secret, or a
   Cloudflare Access service-token policy in front of `/v1`?
8. **Product icon.** Approve the proposed tile-and-pin icon, change it, or keep the Nyuchi
   mark for Maps? And is Radix `LockClosed`, `Link2` and `Globe` acceptable for key,
   endpoints and explorer?
9. **Language.** `nyuchi/maps` is TypeScript. Do the origin changes stay in TypeScript, or
   is a Rust port the first step?
10. **Usage retention.** Keep daily rollups for how long, and may a per-key aggregate of
    embedding site hostnames be recorded?
11. **Attribution and staff access.** Is "© OpenStreetMap contributors" the only credit that
    must always show, or also a "Nyuchi Maps" mark; and should staff access to the
    on-demand ledger be a new WorkOS permission, and who holds it?
12. **The quiet period** before the origin is locked: 14 days after the last consumer
    (proposed), or lock as soon as the log shows no unsigned traffic?
13. **Raster and extra layers.** Weather's static map uses raster PNG tiles and Events
    offers topo and cycling layers. Render static maps with MapLibre, add a raster
    endpoint (OGC API - Maps in `docs/tile-contract.md`), or drop the extra layers?
14. **Kweli overlay.** Approve the overlay as a second tile source rebuilt nightly from
    the public places, and the verification level and attestations being in a public
    tile. And is Kweli's place search (with a Nyuchi-side geocoding fallback) the
    search backend for every map UI?
15. **Keys for first-party apps.** One publishable key per app and environment created in
    the Console by a Nyuchi Africa manager (proposed), or an app key through
    `POST /v1/app-keys`, or an internal key for server-side use?

## 15. The prototype

- **Where it lives.** `docs/prototype/` in `nyuchi/maps`, on the branch
  `docs/console-design`, in the draft pull request nyuchi/maps#23. It is documentation:
  the Worker does not ship it. The production dashboard will live in `site/` (section 10) in a later PR; it does not exist yet.
- **Not deployed.** Nothing of the dashboard is deployed at `maps.nyuchi.com`. The live
  host still serves the old map page and the open `/v1/*` API.
- **Open it.** Follow [prototype/README.md](prototype/README.md): run the origin Worker
  locally with `.dev.vars` (`npx wrangler dev --remote --port 8787`), then in
  `docs/prototype` run `npm install --legacy-peer-deps`, `npm run build`, and
  `python3 -m http.server 8788 --directory dist`; open `http://localhost:8788`. The
  maps draw from the real bucket; the URLs the pages show are the `api.nyuchi.com` ones
  the design proposes.
- **What it shows.** Eight pages (Overview, Explorer, Embed builder, Endpoints, API keys,
  Usage, Coverage with a "Places from Kweli" card, Product icon) in the real Mzizi shell: the sidebar with the Nyuchi
  mark, a collapse toggle (a rail on a desktop, an off-canvas sheet on a phone), a round
  theme switch, Radix icons, pill buttons, badges and chips, round icon controls, soft
  elevation, the Mzizi bar charts, light and dark, and a bottom navigation on phones. Every
  figure, key and origin is invented and labelled.
- **Captured** at phone (390 by 844), tablet (820 by 1180) and desktop (1440 by 900),
  light and dark, at device scale factor 2; the captures are in the reviewing session's
  scratch folder and are not committed.
