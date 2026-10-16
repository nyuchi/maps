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
Worker falls back to the request origin. The route is commented out in
`wrangler.jsonc`, so nothing is served until the owner provisions the DNS record
and enables it.

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
