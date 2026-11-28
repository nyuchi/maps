# Nyuchi Maps

Nyuchi Maps is Nyuchi infrastructure: the base map for every Mukoko app and
every Nyuchi product. It owns the tiles, styles, fonts, sprites and the credits
that go with them. It is not a weather feature; weather overlays (for example
the Tomorrow.io tiles served by `mukoko-weather-tiles`) are a separate product
and are out of scope here.

It is a small TypeScript Cloudflare Worker over one R2 bucket. A single
[PMTiles](https://docs.protomaps.com/pmtiles/) archive (v3) holds the whole map;
the Worker answers tile requests with HTTP range reads against it. There is no
tile server to run.

Host: `maps.nyuchi.com` (owner-confirmed). It is configuration, not code:
`PUBLIC_BASE_URL` in `wrangler.jsonc`. The route is commented out until the
owner provisions the DNS record, so nothing is served until then.

## The map

`GET /` is a map for people: all of Africa, Madagascar and the nearby islands,
in a light and a dark style. It follows the system colour scheme, remembers a
manual choice in `localStorage` (no cookies), and has zoom, rotate, locate-me
and scale controls. The credits shown on it come from the TileJSON, never from
the page. It is mobile-first and keyboard accessible, and follows the Bundu
floor (45px touch targets, 24px on desktop, 17px body on touch). There is no
search box: a geocoder would need a third-party service or a gazetteer this
Worker does not have, so it is left out.

MapLibre GL JS (pinned, BSD-3-Clause) is vendored and served by the Worker
itself, so a visitor's browser contacts no other host. The page ships with a
strict Content-Security-Policy (`self` only, a worker, `data:` icons).

To use the same map in your own app, point MapLibre at the style (the origin
must be in `ALLOWED_ORIGINS`):

```js
new maplibregl.Map({
  container: "map",
  style: "https://maps.nyuchi.com/v1/styles/light.json", // or dark.json
});
```

The page is not framed (`frame-ancestors 'none'`); embed by style URL, not by
iframe. Its source is in [`web/`](web/); `public/` is generated from it (see
Development) and committed.

## Routes

These are the routes the first slice serves today. The contract that will replace the tile routes, written from OGC API - Tiles (decided, not built), is [docs/tile-contract.md](docs/tile-contract.md).

| Route                                                            | What it serves                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `GET /`                                                          | The map page (HTML), with its `/assets/*`, `/favicon.svg`, `/robots.txt` |
| `GET /health`                                                    | Liveness, answered at the edge                                           |
| `GET /openapi.json`                                              | The OpenAPI 3.1 contract ([`openapi/`](openapi/))                        |
| `GET /v1/tiles.json`                                             | TileJSON 3.0.0 for the archive, with the credits                         |
| `GET /v1/tiles/{z}/{x}/{y}.mvt`                                  | One tile (the extension follows the archive's tile type)                 |
| `GET /v1/sources/{id}/tiles.json`, `.../tiles/{z}/{x}/{y}.{ext}` | Any further registered tile source (none ships yet; see architecture)    |
| `GET /v1/styles/{light,dark}.json`                               | MapLibre styles that reference only our tiles, fonts, icons              |
| `GET /v1/fonts/{stack}/{range}.pbf`                              | Glyph PBFs from the bucket                                               |
| `GET /v1/sprites/{name}[@2x].{json,png}`                         | Sprite index and sheets from the bucket                                  |

Behaviour worth knowing:

- Tiles are passed through still compressed (`Content-Encoding: gzip`, with
  `encodeBody: "manual"` so the runtime does not gzip them again), with a long
  edge cache (`s-maxage` 30 days), an `ETag` and `304` on `If-None-Match`.
  `/v1/tiles.json` is TileJSON 3.0.0 including `vector_layers` from the archive.
- A tile the archive does not hold, inside its zoom range, is `204`. Outside the
  zoom range, an unknown style, font, sprite or object is `404`. Bad
  coordinates or names are `400` and never reach R2.
- Every path piece is validated against a strict pattern before it can form an
  R2 key, so there is no path traversal.
- Per-IP rate limit on `/v1` through the `RATE_LIMITER` binding (1800 a minute;
  it fails open). Tiles count only when they miss the edge cache, and a request
  with no `CF-Connecting-IP` is not limited. `429` carries `Retry-After`.
- CORS is an allow-list from `ALLOWED_ORIGINS`; first-party apps use an
  allow-listed origin. Every response carries `Vary: Origin`. `?lang=sn` on a style picks the label language.

Use it from MapLibre by style URL:

```ts
new maplibregl.Map({
  container: "map",
  style: "https://maps.nyuchi.com/v1/styles/light.json",
});
```

The credits come from the TileJSON that the style points at, so the attribution
control shows them once. Never write them by hand: they live in
[`src/credits.ts`](src/credits.ts) only.

Keys for outside developers and enterprise customers will follow the Nyuchi
model (`nyk_` / `nys_`, verified through `api.nyuchi.com`). That is not built in
this first slice; see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Configuration

| Name              | Kind    | What it is                                                               |
| ----------------- | ------- | ------------------------------------------------------------------------ |
| `MAPS_BUCKET`     | binding | The R2 bucket `nyuchi-maps` (tiles, fonts and sprites)                   |
| `ASSETS`          | binding | Static assets (`public/`: the map page, MapLibre, bundles)               |
| `RATE_LIMITER`    | binding | Workers rate limiting, 600 requests a minute per client IP               |
| `PUBLIC_BASE_URL` | var     | Public origin for URLs in TileJSON and styles; `https://maps.nyuchi.com` |
| `ALLOWED_ORIGINS` | var     | Comma-separated CORS origins; `https://*.example.com` matches subdomains |
| `TILES_VERSION`   | var     | Part of the edge cache key; bump and deploy when the archive is replaced |
| `TILES_KEY`       | var     | Object key of the archive, `tiles/nyuchi-maps.pmtiles`                   |

There are no secrets. `workers_dev` and preview URLs are off, no route is
enabled and observability is on. `ALLOWED_ORIGINS` in `wrangler.jsonc` is the
production list only; for `wrangler dev` copy `.dev.vars.example` to `.dev.vars`
to add `http://localhost:3000`. Nothing in this repo creates a bucket, a DNS record or a deployment.

Bucket layout:

```text
tiles/nyuchi-maps.pmtiles
fonts/OFL.txt                         copy of licenses/OFL-1.1-Noto-Sans.txt
fonts/{font name}/{range}.pbf         the stacks the styles use:
    Noto Sans Regular, Noto Sans Medium, Noto Sans Italic,
    Noto Sans Devanagari Regular v1
sprites/{light,dark}[@2x].{json,png}
```

To produce the Africa archive see
[`scripts/build-extract.md`](scripts/build-extract.md) (about 5.4 GB at
maximum zoom 14, measured with `--dry-run`).

## Development

```sh
npm ci
npm test            # Workers Vitest suite, stubbed R2 and rate limiter
npm run typecheck
npm run build       # check:web, then wrangler deploy --dry-run: deploys nothing
npm run build:web   # regenerate public/ from web/ and the pinned maplibre-gl
npm run check:web   # fail if public/ is stale (part of build, so part of CI)
npm run dev         # wrangler dev (needs a local R2 archive)
```

Tests include `test/encoding.test.ts`, which runs the real Worker entry in
workerd. To check double compression by hand against a local archive (put one in
the simulated bucket with
`npx wrangler r2 object put nyuchi-maps/tiles/nyuchi-maps.pmtiles --file x.pmtiles --local`):

```sh
npx wrangler dev
curl -s -H 'Accept-Encoding: gzip' --raw http://localhost:8787/v1/tiles/0/0/0.mvt -o t.gz
gzip -t t.gz                      # exits 0: gzip exactly once
gzip -dc t.gz | gzip -t           # must FAIL ("not in gzip format"): the tile is not gzipped twice
```

For `wrangler dev`, set `PUBLIC_BASE_URL=http://localhost:8787` (see
`.dev.vars.example`): the style URLs are built from it and the page's CSP only
allows its own origin. `/` then shows the map once the bucket holds an archive,
sprites and fonts.

Tests run inside workerd with
[`@cloudflare/vitest-pool-workers`](https://developers.cloudflare.com/workers/testing/vitest-integration/).
They build small PMTiles v3 archives in memory, so they cover the real
directory format without any map data. `.npmrc` sets `legacy-peer-deps`.

## CI and releases

- `ci.yml`: tests, typecheck and a build dry run (which also checks that the
  committed `public/` matches `web/` and the pinned MapLibre). Actions are pinned to commit
  SHAs.
- `lint.yml`: the org lint gate (actionlint, JSON validity, prettier,
  markdownlint, yamllint), the identical caller from `nyuchi/.github`.
- `staging-version.yml`: tags each merge to `staging` as the next patch. Inert
  until a `staging` branch exists.

`main` requires a pull request (squash or rebase, linear history, resolved
threads) and the five lint checks. Releases follow the same convention as
`mukoko-api`: `staging` into `main` by squash-merge.

## Licences

- **Code** (the Worker, tests, scripts): Apache-2.0, see [LICENSE](LICENSE).
- **Map data**: the underlying data is OpenStreetMap, under the Open Database
  Licence (ODbL) 1.0. We treat the tile files and the maps rendered from them as
  a Produced Work: credit **"© OpenStreetMap contributors"** wherever a map is
  shown (the TileJSON carries it). Protomaps' own downloads name only that
  attribution. Confirm the classification of the tile archive itself with
  counsel before publishing it for download.
- **Third-party styles, fonts and sprites** keep their upstream licences, listed
  in [NOTICE](NOTICE).

This is not legal advice. Confirm anything contractual with the Bundu
Foundation's counsel.
