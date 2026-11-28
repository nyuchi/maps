# Architecture

Nyuchi Maps is platform infrastructure. One Worker, one R2 bucket, no tile
server and no database.

```text
browser / app            Cloudflare edge Worker (Hono)                   R2 (one bucket)
MapLibre ──GET──► CORS (allow-list, Vary: Origin)
                  ├─ /v1 non-tile routes: rate limit, validate, serve ──► fonts/…  sprites/…
                  └─ /v1 tiles: validate ─► Cache API (key: path + TILES_VERSION)
                                              hit ─► respond (no limiter, no R2)
                                              miss ─► rate limit ─► pmtiles reader ──range──► tiles/nyuchi-maps.pmtiles
```

## Request path

1. **CORS** (`src/cors.ts`): `ALLOWED_ORIGINS` is an exact or `https://*.host`
   allow-list. No `Origin` header (servers) passes; an unlisted browser origin
   gets no `Access-Control-Allow-Origin`, and its preflight is `403`.
2. **Rate limit** (`src/ratelimit.ts`), keyed by `CF-Connecting-IP`, 1800 a
   minute. It fails open so a limiter fault cannot take the map down. Non-tile
   `/v1` routes are limited up front; tile requests only on an edge-cache miss,
   so cache hits (and many users behind one carrier-grade NAT address) do not
   spend the budget. A request with no `CF-Connecting-IP` (never behind
   Cloudflare) is not limited, rather than sharing one bucket. The namespace id
   is 7402; 1001 is the Mukoko API's IP limiter and ids are unique per account.
3. **Validation** (`src/validate.ts`): every path piece is matched against a
   strict pattern first (digits without leading zeros, `[a-z][a-z0-9-]*` names,
   a bounded font alphabet). Only validated values ever form an R2 key, so there
   is no path traversal.
4. **Tiles** (`src/archive.ts`): the `pmtiles` library reads the v3 header and
   directories through an R2 `Source`; every read is an R2 range read, so the
   archive is never downloaded whole. The header and directories are cached per
   isolate in a `ResolvedValueCache` (keyed by the archive ETag): it stores only
   values that resolved, so a missing archive or a transient R2 error is never
   cached (the next request retries; `SharedPromiseCache` would keep the
   rejection and poison the isolate, and cannot share promises across Workers
   requests anyway). A replaced archive surfaces as an ETag mismatch, which the
   library retries. A matching `If-None-Match` is answered from the cached
   header, before the directory or the tile is read.
5. **Response**: tile bytes are passed through still compressed with
   `Content-Encoding: gzip` **and `encodeBody: "manual"`** (`responseInit` in
   `src/http.ts`): the runtime's default is to compress such a body again, which
   clients cannot parse. Every place that builds or rebuilds a tile response
   uses it: the origin response, the CORS rebuild, the cache-hit path, and the
   copy written to the Cache API (a `res.clone()` would lose the flag).
   `test/encoding.test.ts` runs the real Worker entry to prove a single gzip
   layer. A strong `ETag` (`"<archive etag>:<z>/<x>/<y>"`),
   `Cache-Control: public, max-age=86400, s-maxage=2592000,
stale-while-revalidate=86400`, and `304` on `If-None-Match`. Successful
   tiles are also stored in the Cache API under a key of origin + path +
   `TILES_VERSION` only (a query string cannot bypass it; bumping the var
   retires every tile of a replaced archive). CORS headers are applied after the
   cache so one cached object serves every allowed origin.

Status codes: a tile absent from the archive but inside its zoom range is `204`
(cached for an hour); outside the zoom range, or a wrong extension, `404`
(cached for minutes; error responses keep a Cache-Control the handler set and
default to `no-store`); bad coordinates `400`; archive missing from the bucket
`503 archive_unavailable` (`no-store`).

## On-demand regions

A tile in an area no archive holds yet (z6 to 14) is recorded as demand for its
z6 cell and answered with a short-lived `204`; a service
(`nyuchi/maps-region-builder`) extracts that cell from the Protomaps planet
build, uploads `tiles/regions/<cell>-<build>.pmtiles` and the Worker's ledger
publishes it in `tiles/regions.json`, after which the same URL is a `200`.
Off unless `ONDEMAND_REGIONS=on`. Production traffic never reads the planet
build (optional single-tile fallback excepted). Code is in `src/regions/`;
decisions, protocol, caps and infra list are in
[ondemand-regions.md](ondemand-regions.md).

## The dashboard

`maps.nyuchi.com` is the tile origin plus a static developer dashboard. The
public API is the Nyuchi API (`api.nyuchi.com/v1/maps`, through the Servers API,
which fronts this origin; see docs/console-design.md); this Worker does not
serve a second public API. When the Servers API and its Worker edge call this
origin (over the private path or a service binding), they present the signed
origin credential of the design; nothing in the dashboard changes that, and
the dashboard's own reads of `/v1` are same-origin until the origin is locked.

`/`, `/explorer/`, `/endpoints/`, `/embed-builder/`, `/docs/`, `/status/`,
`/embed/` and `/assets/*`, `/favicon*.png`, `/robots.txt` are served by the same
Worker from static assets (`assets` in `wrangler.jsonc`, binding `ASSETS`,
`run_worker_first: true`), so `/v1` routing, CORS, the limiter and headers are
untouched and the Worker stays small (MapLibre is an asset, not Worker code).
`src/web.ts` adds the headers: a CSP with `self` only (plus `worker-src blob:`,
`img-src data: blob:` and `frame-src 'self'` for the Embed builder's preview),
`nosniff`, no referrer, `geolocation=(self)`; `public, max-age=60` for HTML and
a year `immutable` for content-hashed or version-named files.

`/embed/` is the one page other sites may frame. Its CSP is the dashboard's
with `frame-ancestors 'self'` plus the valid host entries of `ALLOWED_ORIGINS`;
nothing in the request (query, headers, referrer) can add to it, so a hostile
URL cannot widen it. There is no key handling: per-key origin lists arrive with
the Maps API, and this allow-list goes away with `ALLOWED_ORIGINS`. The credits
are MapLibre's attribution control reading the TileJSON; no parameter hides it.

`site/` is an Astro 7 project with its own `package.json` and lockfile (the
Worker's install, tests and typecheck do not need it), built on the Mzizi
Dashboard Standard: `@bundu/ui` 0.17.0 pinned exactly, the same pin as the
Console, with Radix icons through a one-file icon seam, pills and round
icon-only controls through one radius override. `src/config.ts` is the one
place that holds `MAPS_API_ENABLED` (flip it when the Nyuchi API serves Maps),
the API base and the Console keys URL. Pages read only this service's own
`/health`, `/v1/tiles.json`, styles, tiles and `/openapi.json` at run time; no
number is invented, and where the figure does not exist yet (usage) the page
says so.

`public/` is generated by `scripts/build-web.mjs`: it runs `astro build` in
`site/`, drops unreferenced files, checks the output has no inline script,
style or handler (the CSP forbids them), vendors the pinned `maplibre-gl` into
`assets/vendor/maplibre-gl/<ver>/` and writes the lot to `public/`, which is
committed. Astro content-hashes every file name. `npm run check:web` (inside
`npm run build`, so in CI and the deploy verify job) rebuilds and fails if
`public/` is stale. The script starts Astro with the runtime it runs under, so
`deno run -A scripts/build-web.mjs` works too; Astro 7.4.13 produces
byte-identical output under Node 24 and Deno 2.9. The Explorer opens on a frame
that shows Africa and South East Asia, the two areas in
`scripts/extract-regions.geojson`; a test keeps the frame inside that file's
bounding box. It sets no `maxBounds`, so a viewer can look anywhere.

## Tile sources

A source is one PMTiles archive in the bucket, registered in `src/sources.ts`
(`SOURCES`). Today there is one, `basemap`, at the short URLs
(`/v1/tiles.json`, `/v1/tiles/{z}/{x}/{y}.mvt`) and also at
`/v1/sources/basemap/...`. Any further source is served at
`/v1/sources/{id}/tiles.json` and `/v1/sources/{id}/tiles/{z}/{x}/{y}.{ext}`
by the same handlers: same validation, caching, ETag, CORS and rate limit.
Each source has its own object key, its own TileJSON (with its own credit ids,
so an overlay shows only the credits that apply to it), and its own header and
directory cache entries.

This is how a Kweli places overlay would arrive later: a second archive
(`tiles/kweli-places.pmtiles`), one entry in `SOURCES`, one var for its key, and
a style layer that adds it as a second vector source. That overlay is not built
here, and the registry ships with the base map only. `createApp(sources)` takes
the registry as a parameter, which is how the tests exercise a second source
without registering one.

The tile routes and TileJSON described here are the first slice's. The contract
that replaces them (OGC API - Tiles as the canonical description, TileJSON
derived from it, PMTiles as storage only) is
[tile-contract.md](tile-contract.md); nothing in it is built yet.

## Styles, fonts, sprites and credits

- **Styles** (`src/styles.ts`) are generated from `@protomaps/basemaps` layers,
  flavors `light` and `dark`. The vector source carries a `url` to our TileJSON
  and nothing else; `glyphs` and `sprite` point at our own `/v1/fonts` and
  `/v1/sprites`. No third-party host appears in a style (a test enforces it).
  Each style is built once per (name, base URL, language) and memoised.
  Restyling with Mzizi tokens means replacing the flavor objects, not the
  plumbing.
- **Fonts and sprites** are stored objects in the same bucket, served as is. A
  font stack lists fallbacks; the first one the bucket holds wins.
- **Credits** live in `src/credits.ts` and nowhere else. They reach a map through
  the TileJSON `attribution` (MapLibre shows a source's attribution once);
  `vector_layers` come from the archive's own metadata block; styles
  deliberately add none, so a credit cannot appear twice. A test checks that no
  credit is listed or rendered twice and that styles carry none.

## Configuration, not constants

The host is `PUBLIC_BASE_URL` (`https://maps.nyuchi.com`, owner-confirmed).
TileJSON and style URLs are built from it; if it is unset or invalid the
Worker falls back to the request origin. The page's CSP allows only its own
origin, so locally `PUBLIC_BASE_URL` must be the dev origin. The route is
commented out in `wrangler.jsonc`, so nothing is served until the owner
provisions the DNS record and enables it; the map page then goes live at `/`
with the same deploy.

## Origin authentication

`maps.nyuchi.com` is the tile origin behind `api.nyuchi.com` and the Nyuchi
Servers API, and it also serves the public map page. Once every consumer has
moved to the API, `/v1/*` must answer only the Servers API. That is
`ORIGIN_AUTH` (code: `src/originauth.ts`), **off by default**:

| `ORIGIN_AUTH`   | Behaviour                                                                                                                                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `off` (default) | Nothing is checked. Unset, empty and `off` are the same, and the code path is a single early return.                                                                                                                                                                                              |
| `log`           | `/v1` requests are verified, counted in a structured log line (`event: origin_auth`, `result`, `reason`, `route`; never the path, query, address or signature) and served either way. The response carries `X-Origin-Auth: ok`, `missing` or `invalid`, only in this mode.                        |
| `enforce`       | A `/v1` request without a valid credential is a `401` RFC 9457 problem (`application/problem+json`, `no-store`) that does not say which part was wrong. With no keys configured every `/v1` request is refused (fail closed). Any other value of the variable is treated as `enforce` and logged. |

Rollback is the variable. `/health`, `/`, `/assets/*`, `/favicon.svg`,
`/robots.txt` and `/openapi.json` are outside `/v1` and always public; CORS
preflight (`OPTIONS`) is answered before the check and returns no data.

**Order.** The check is middleware on `/v1/*` registered right after CORS, so
it runs before the rate limiter, the edge-cache lookup and every handler. A
tile cached by an authorised request is therefore never served to an
unauthenticated one, and a `401` is `no-store` and never written to the cache.
The cache key is unchanged (origin, path, `TILES_VERSION`): the credential is
not part of it, because the check precedes every read and write. Rejected
requests spend none of the per-IP rate budget. Both are tested.

**The credential** (scheme `v1`, the design doc's proposal with a key id and a
nonce added):

```text
X-Nyuchi-Origin: kid=<key id>,t=<unix seconds>,n=<nonce>,v1=<hex>

v1        = hex(HMAC-SHA256(secret of kid, canonical))
canonical = "nyuchi-origin-v1" LF METHOD LF TARGET LF t LF n LF kid
TARGET    = path and query exactly as sent: /v1/tiles/3/4/5.mvt?x=1
```

`kid` is 1 to 32 of `A-Za-z0-9_-`; `t` is the signer's clock; `n` is 16 to 64
characters of `A-Za-z0-9_-`, fresh for every request attempt. The signature
covers the method and the target, so a captured header cannot be used for
another path, query or method (a `GET` signature does not authorise `HEAD`;
sign each method you send). Test vector (secret `test-secret-0123456789abcdef`):

```text
GET /v1/tiles/3/4/5.mvt?x=1   t=1700000000  n=AAAAAAAAAAAAAAAAAAAAAA  kid=k1
v1=1531768216d79431dc3b6689f96c5699c7188dabb7c8506346845d3af0f23ab6
```

**Keys.** The Worker secret `ORIGIN_AUTH_KEYS` holds `kid:secret` pairs
separated by commas (secrets of at least 16 characters; set with
`wrangler secret put`, never in `wrangler.jsonc`). Any listed key verifies, so
rotation has no gap: add the new pair, switch the signer to the new `kid`,
remove the old pair. The signature is compared in constant time
(`crypto.subtle.verify`), the HMAC is computed even for an unknown `kid`, and
a credential is accepted when `|now - t|` is within `ORIGIN_AUTH_WINDOW_SECONDS`
(60 by default, bounded to 5 to 300).

**Replay, and why it is only best effort.** A Worker is stateless and runs in
many isolates, so a nonce can be remembered only inside one isolate. The
Worker does that (a bounded in-memory table, filled only by correctly signed
requests), which rejects an immediate replay to the same isolate, but a replay
that lands in another isolate or after a restart is accepted. What bounds a
replay for real is the short window plus the signature covering method and
target: a captured header works for one `GET` or `HEAD` of public map data, for
at most the window. Strict one-time nonces would need shared state (a Durable
Object or KV) read on every tile request, which costs more than the exposure it
removes. Because a remembered nonce is rejected, the signer must use a new
nonce on every attempt, retries included.

### Before enforcing

- The rate limiter is keyed by client address. Behind the Servers API every
  request arrives from its few egress addresses, so they share a bucket; the
  lock PR removes the per-address limiter (design doc, section 12.2).
- Cloudflare zone settings on `nyuchi.com` sit in front of the Worker and can
  refuse a signed request before it arrives: Hotlink Protection answers `403`
  (`error code: 1011`) on `.png` and other image files when the `Referer` is
  another site, and a managed challenge (`cf-mitigated: challenge`) answers
  `HEAD`, `POST`, `OPTIONS` and `GET` without `User-Agent` or `Accept`. The
  Servers API must send `GET`, a `User-Agent`, `Accept` and no `Referer`, and
  must probe `/health` with `GET`, not `HEAD`.

## Access model

- **First-party apps** (Mukoko apps, Nyuchi products): an allow-listed origin
  (CORS) and the per-IP limit. This is what is built.
- **Outside developers and enterprise**: keys in the Nyuchi model (`nyk_` /
  `nys_`), verified through `api.nyuchi.com`, with per-key limits. Not built in
  this slice; it would add a key check in front of `/v1/*` (header or query key)
  and move the rate-limit key from IP to key id.

## Data and updates

The archive is a Protomaps build (OpenStreetMap, ODbL). The first slice is a
regional extract (see `scripts/build-extract.md`); planet versus regional is the
owner's decision. Updates are manual for now: rebuild, upload over the same
key, bump `TILES_VERSION` and deploy (see `scripts/build-extract.md`). A
scheduled refresh (a cron Worker) is a later step.

## Out of scope

The Tomorrow.io overlay Worker `mukoko-weather-tiles` is a weather product and
stays where it is. Satellite basemaps are not provided here.

## Not verified yet

This slice is tested against small in-memory PMTiles v3 archives and a stubbed
R2 binding. It has not been run against real Protomaps data, a real bucket or
the Workers runtime in production: real-archive directory depth, R2 range-read
latency and the rendered styles in MapLibre still need checking once the owner
creates the bucket.
