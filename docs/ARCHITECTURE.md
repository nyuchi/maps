# Architecture

Nyuchi Maps is platform infrastructure. One Worker, one R2 bucket, no tile
server and no database.

```text
browser / app            Cloudflare edge                         R2 (one bucket)
MapLibre  ──GET──►  Cache API ─miss─► Worker (Hono)  ──range──►  tiles/nyuchi-maps.pmtiles
                                       │                         fonts/…  sprites/…
                                       ├─ CORS allow-list
                                       ├─ per-IP rate limit (RATE_LIMITER)
                                       └─ validation, ETag, Cache-Control
```

## Request path

1. **CORS** (`src/cors.ts`): `ALLOWED_ORIGINS` is an exact or `https://*.host`
   allow-list. No `Origin` header (servers) passes; an unlisted browser origin
   gets no `Access-Control-Allow-Origin`, and its preflight is `403`.
2. **Rate limit** (`src/ratelimit.ts`) on `/v1/*`, keyed by `CF-Connecting-IP`.
   It fails open so a limiter fault cannot take the map down.
3. **Validation** (`src/validate.ts`): every path piece is matched against a
   strict pattern first (digits without leading zeros, `[a-z][a-z0-9-]*` names,
   a bounded font alphabet). Only validated values ever form an R2 key, so there
   is no path traversal.
4. **Tiles** (`src/archive.ts`): the `pmtiles` library reads the v3 header and
   directories through an R2 `Source`; every read is an R2 range read, so the
   archive is never downloaded whole. The header and directories are cached per
   isolate (keyed by the archive ETag); a replaced archive surfaces as an ETag
   mismatch, which the library retries.
5. **Response**: tile bytes are passed through still compressed with
   `Content-Encoding: gzip`, a strong `ETag` (`"<archive etag>:<z>/<x>/<y>"`),
   `Cache-Control: public, max-age=86400, s-maxage=2592000,
stale-while-revalidate=86400`, and `304` on `If-None-Match`. Successful
   tiles are also stored in the Cache API; CORS headers are applied after the
   cache so one cached object serves every allowed origin.

Status codes: a tile absent from the archive but inside its zoom range is `204`
(cached for an hour); outside the zoom range, or a wrong extension, `404`
(cached for minutes); bad coordinates `400`; archive missing from the bucket
`503 archive_unavailable` (`no-store`).

## Styles, fonts, sprites and credits

- **Styles** (`src/styles.ts`) are generated from `@protomaps/basemaps` layers,
  flavors `light` and `dark`. The vector source carries a `url` to our TileJSON
  and nothing else; `glyphs` and `sprite` point at our own `/v1/fonts` and
  `/v1/sprites`. No third-party host appears in a style (a test enforces it).
  Restyling with Mzizi tokens means replacing the flavor objects, not the
  plumbing.
- **Fonts and sprites** are stored objects in the same bucket, served as is. A
  font stack lists fallbacks; the first one the bucket holds wins.
- **Credits** live in `src/credits.ts` and nowhere else. They reach a map through
  the TileJSON `attribution` (MapLibre shows a source's attribution once); styles
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
key. Edge-cached tiles age out within `s-maxage` (30 days) unless purged. A
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
