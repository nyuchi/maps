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
owner provisions the DNS record.

## Routes

| Route                                    | What it serves                                              |
| ---------------------------------------- | ----------------------------------------------------------- |
| `GET /health`                            | Liveness, answered at the edge                              |
| `GET /openapi.json`                      | The OpenAPI 3.1 contract ([`openapi/`](openapi/))           |
| `GET /v1/tiles.json`                     | TileJSON 3.0.0 for the archive, with the credits            |
| `GET /v1/tiles/{z}/{x}/{y}.mvt`          | One tile (the extension follows the archive's tile type)    |
| `GET /v1/styles/{light,dark}.json`       | MapLibre styles that reference only our tiles, fonts, icons |
| `GET /v1/fonts/{stack}/{range}.pbf`      | Glyph PBFs from the bucket                                  |
| `GET /v1/sprites/{name}[@2x].{json,png}` | Sprite index and sheets from the bucket                     |

Behaviour worth knowing:

- Tiles are passed through still compressed (`Content-Encoding: gzip`), with a
  long edge cache (`s-maxage` 30 days), an `ETag` and `304` on `If-None-Match`.
- A tile the archive does not hold, inside its zoom range, is `204`. Outside the
  zoom range, an unknown style, font, sprite or object is `404`. Bad
  coordinates or names are `400` and never reach R2.
- Every path piece is validated against a strict pattern before it can form an
  R2 key, so there is no path traversal.
- Per-IP rate limit on `/v1` through the `RATE_LIMITER` binding (it fails open).
  `429` carries `Retry-After`.
- CORS is an allow-list from `ALLOWED_ORIGINS`; first-party apps use an
  allow-listed origin. `?lang=sn` on a style picks the label language.

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
| `MAPS_BUCKET`     | binding | The R2 bucket (placeholder name in `wrangler.jsonc`, not created)        |
| `RATE_LIMITER`    | binding | Workers rate limiting, 600 requests a minute per client IP               |
| `PUBLIC_BASE_URL` | var     | Public origin for URLs in TileJSON and styles; `https://maps.nyuchi.com` |
| `ALLOWED_ORIGINS` | var     | Comma-separated CORS origins; `https://*.example.com` matches subdomains |
| `TILES_KEY`       | var     | Object key of the archive, `tiles/nyuchi-maps.pmtiles`                   |

There are no secrets. `workers_dev` is off, no route is enabled and observability
is on. Nothing in this repo creates a bucket, a DNS record or a deployment.

Bucket layout:

```text
tiles/nyuchi-maps.pmtiles
fonts/{font name}/{range}.pbf        e.g. fonts/Noto Sans Regular/0-255.pbf
sprites/{light,dark}[@2x].{json,png}
```

To produce a small regional archive (Zimbabwe plus a few cities) see
[`scripts/build-extract.md`](scripts/build-extract.md).

## Development

```sh
npm ci
npm test            # Workers Vitest suite, stubbed R2 and rate limiter
npm run typecheck
npm run build       # wrangler deploy --dry-run: bundles, deploys nothing
npm run dev         # wrangler dev (needs a local R2 archive)
```

Tests run inside workerd with
[`@cloudflare/vitest-pool-workers`](https://developers.cloudflare.com/workers/testing/vitest-integration/).
They build small PMTiles v3 archives in memory, so they cover the real
directory format without any map data. `.npmrc` sets `legacy-peer-deps`.

## CI and releases

- `ci.yml`: tests, typecheck and a build dry run. Actions are pinned to commit
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
- **Map data**: tile files built from OpenStreetMap are a derived database under
  the Open Database Licence (ODbL) 1.0. Credit **"© OpenStreetMap contributors"**
  wherever a map is shown (the TileJSON carries it). Any tile file we publish
  must be offered under the ODbL.
- **Third-party styles, fonts and sprites** keep their upstream licences, listed
  in [NOTICE](NOTICE).

This is not legal advice. Confirm anything contractual with the Bundu
Foundation's counsel.
