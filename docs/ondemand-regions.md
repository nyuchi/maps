# On-demand regions

Status: design, written 2026-11-28. The Worker side is built in `src/regions/`
(tests in `test/regions.test.ts`) and the builder is the private repository
`nyuchi/maps-region-builder`. Nothing here is deployed, and no Cloudflare
resource has been created.

The requirement, as the owner stated it: the Worker pulls from OpenStreetMap
when a destination is requested that is not stored, then a service runs to
add that part of the map we do not have stored.

## 1. What "pull from OpenStreetMap" means for vector tiles

### 1.1 What is not allowed

- The OSMF tile usage policy covers `tile.openstreetmap.org`. It prohibits
  fetching tiles you are not currently viewing, pre-seeding areas or zoom
  levels, building tile archives, and wide automated scans; it states that
  offline use is not permitted there, and says heavy use may be blocked
  without notice. It also says vector tiles on `vector.openstreetmap.org` fall
  under a separate policy. Source: <https://operations.osmfoundation.org/policies/tiles/>
  (read 2026-11-28).
- Therefore this project never requests tiles, or tile-generating queries,
  from OSMF servers or from the Overpass API, at any scale. Neither is a
  source for this design.

### 1.2 Route (a), the primary route: the Protomaps daily planet build

- Protomaps publishes a daily planet PMTiles build, OpenStreetMap-derived,
  distributed as an ODbL Produced Work with OpenStreetMap attribution
  required. The schema is the one `@protomaps/basemaps` styles (our styles)
  expect. Source: <https://docs.protomaps.com/basemaps/downloads>
  (read 2026-11-28).
- Verified by me on 2026-11-28 (read-only): `HEAD https://build.protomaps.com/20261126.pmtiles`
  answers `200`, `Accept-Ranges: bytes`, 139,816,078,848 bytes, served by
  Cloudflare with `cf-cache-status: DYNAMIC` (so range reads are not
  answered from a CDN cache). A `Range: bytes=0-126` read returned the
  `PMTiles` magic. The build list at
  <https://build-metadata.protomaps.dev/builds.json> holds 61 entries; the
  latest on that day was `20261127.pmtiles`, version `4.15.2`, with a `b3sum`.
- Protomaps' stated terms are thin. The downloads page lists no formal terms
  and no rate limits, says the URLs may change, says hotlinking to the
  downloads is discouraged, and tells you to copy the tileset into your own
  cloud storage. Daily builds are kept for a week (weekly ones for a month,
  then the latest per version). The hosted API at `api.protomaps.com` has its
  own tile usage policy and is a different product. I did not find a published
  policy that covers production traffic against `build.protomaps.com`.
- Consequence, and the decision: **production tile traffic never reads from
  `build.protomaps.com`.** Only the region builder reads it, and only with
  `pmtiles extract`, which is the documented bulk path for a region. It reads
  the directories and then the needed byte ranges for one z6 cell, once per
  cell and build. A single-tile range read per user request from the Worker is
  kept as an optional, off-by-default, budgeted fallback (section 6.3) and
  needs the owner's explicit decision and, ideally, a note to Protomaps first.
- Measured, dry run, read-only, 2026-11-28, build `20261127`, one z6 cell over
  Singapore (`--bbox=101.25,0,106.875,5.6 --maxzoom=14`): 88,423 region tiles,
  43,816 tile entries, 61 requests, 104 MB transferred, 99 MB archive, about
  9 s. Africa as a whole is 5.4 GB at maxzoom 14 (`scripts/build-extract.md`).
  A land-heavy cell will be larger than an ocean-heavy one; the builder applies
  a per-region size ceiling (section 7).

### 1.3 Route (b), documented alternative: Geofabrik extracts and planetiler

OSM extracts from Geofabrik, tiled with planetiler and the Protomaps profile.
It produces the same schema from the source data, at the cost of a Java build
with real CPU and RAM, and of Geofabrik's download terms. It is not built.
Choose it if Protomaps' builds become unavailable or the owner wants to control
the data date. The builder's `Extractor` trait (section 7) is the seam where it
would plug in.

### 1.4 Attribution and licence

`src/credits.ts` stays the one place credits live. The tiles remain an ODbL
Produced Work from OpenStreetMap data, so `© OpenStreetMap contributors` is
unchanged and sufficient on this route; no credit is added or removed by this
feature. Region archives are made from the same build, so the credit applies
to them identically. If route (b) is ever used, the credit stays the same
(OpenStreetMap data, ODbL) and `scripts/build-extract.md` records the source.

## 2. Cloudflare primitives and why the simplest set was chosen

Checked 2026-11-28 against the Cloudflare docs.

| Primitive             | Facts that matter here                                                                                                                                                                                         | Used?                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Queues                | Message 128 KB; retention up to 14 days on Paid (24 h on Free); HTTP pull consumers via `.../queues/{id}/messages/pull` and `/ack`, batch up to 100, visibility timeout up to 12 h, API token with Queues Edit | No: alternative, see below                                           |
| Durable Objects       | SQLite-backed; up to 10 GB per object on Paid; one object has a soft limit of about 1,000 requests a second; available on Free and Paid with the SQLite backend                                                | **Yes**: the demand ledger                                           |
| D1                    | SQLite database over HTTP/binding                                                                                                                                                                              | No: a DO gives the same SQL with serialised writes                   |
| R2 S3 API             | `PutObject` supports `If-Match` and `If-None-Match`, evaluated atomically against committed state; multipart upload is implemented                                                                             | **Yes**: the builder uploads archives (objects over 300 MB need it)  |
| Cloudflare Containers | A way to run the builder on Cloudflare                                                                                                                                                                         | No: the owner runs the builder on their own Coolify (Rust container) |

Why a Durable Object ledger and no Queue:

- The work item is "a z6 cell, once". A queue is at-least-once and does not
  deduplicate, so a ledger is needed in front of it anyway to deduplicate and to
  enforce the caps. Once the ledger exists it can also hand out work with a
  lease, so the queue adds a second piece that must stay consistent with the
  first.
- A queue binding that names a queue that does not exist makes `wrangler
deploy` fail. The ledger needs no resource created before deploy (a Durable
  Object migration is applied by the deploy itself).
- The builder needs no Cloudflare account id, no Queues API token and no
  Cloudflare API at all: one bearer token for three small HTTP calls on our own
  host, plus R2 S3 credentials.
- The Queue design remains valid and is described in section 9.4 for when
  several producers exist.

## 3. Miss detection: stored, empty, or not stored

A tile request is `z/x/y`. The **grid** is the z6 tile pyramid: the cell of a
tile at zoom z of at least 6 is its z6 ancestor, `x >> (z-6)` and `y >> (z-6)`,
written `6/x/y`. 4,096 cells cover the world; a request for any tile of a cell
is demand for that cell, so demand deduplicates by construction.

Coverage comes from one object, the **manifest** `tiles/regions.json`:

```json
{
  "version": 12,
  "grid_zoom": 6,
  "updated": "2026-11-28T10:00:00Z",
  "upstream": { "url": "https://build.protomaps.com/20261127.pmtiles", "build": "20261127" },
  "primary": { "cells": ["6/33/34", "6/33/35"] },
  "regions": [
    {
      "cell": "6/50/31",
      "key": "tiles/regions/6-50-31-20261127.pmtiles",
      "build": "20261127",
      "bytes": 103809024,
      "maxzoom": 14,
      "built": "2026-11-28T10:00:00Z"
    }
  ]
}
```

Classification of a tile with z of at least 6 and at most the region maxzoom
(14):

1. Its cell is in `primary.cells` (or, when the manifest lists none, inside the
   primary archive's header bounds): **stored in the primary archive.** An
   absent tile is a real `204`, as today.
2. Its cell has a `regions` entry: **stored in that region archive.** An absent
   tile is a real `204`.
3. Otherwise: **not stored.** Demand is recorded (section 4) and the answer is
   a fallback (section 5).

Tiles below z6 and above the region maxzoom keep today's behaviour
(primary archive, `204` or `404 zoom_out_of_range`); they never create demand.

The primary archive's coverage is a list of cells because its header bounds are
a single rectangle: the Africa extract's rectangle contains southern Europe and
part of Arabia, which are not in the extract, and when South East Asia is added
to the same archive one rectangle would swallow India. A cell list is exact.
The builder prints it (`maps-region-builder primary-coverage --region file.geojson`)
and the owner puts it in the manifest when the archive is built. Until that is
done the header bounds are used and that imprecision is the known cost.

The manifest is read through the R2 binding and held in memory for 60 seconds
per isolate. A failed or invalid read keeps the last good copy; with none, the
manifest is empty (everything is classified by the primary archive alone) and a
log line says so. A missing manifest object is valid and means "no regions yet".

## 4. Recording demand

On a not-stored request the Worker, without delaying the answer
(`ctx.waitUntil`), asks the ledger Durable Object to record the demand. The
ledger is a single SQLite-backed object (`DemandLedger`, one instance), reached
only on a not-stored miss; a per-isolate memory of cells recently reported
keeps repeated tiles of the same cell from calling it at all.

Recording is idempotent and bounded:

| Rule                | Default (all are vars)                                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Valid input only    | Demand is recorded only after `parseTile` accepts the request, the zoom is within 6 to 14 and the extension matches the primary archive. 400/404 never record.                                                                                                                              |
| Origin check        | The request must carry an allowed `Origin` (the `ALLOWED_ORIGINS` list) or a `Sec-Fetch-Site: same-origin` fetch from the map page (which sends no Origin). A server-to-server call with neither is answered but never records. Spoofable by a script, so it is one layer, not the defence. |
| Distinct tiles      | A cell becomes pending only after `DEMAND_MIN_TILES` (3) distinct tiles in it have been requested. One stray tile does not trigger a region.                                                                                                                                                |
| Per client, per day | `DEMAND_IP_CELLS_PER_DAY` (5) cells promoted and `DEMAND_IP_HITS_PER_DAY` (300) recorded hits per client. The client is a SHA-256 of IP and day, truncated; the raw address is never stored.                                                                                                |
| Global, per day     | `DEMAND_NEW_CELLS_PER_DAY` (40) newly pending cells.                                                                                                                                                                                                                                        |
| Backlog             | `DEMAND_MAX_PENDING` (100) cells pending or building at once.                                                                                                                                                                                                                               |
| Dead cells          | A cell in the `dead` state is never re-queued by demand; only the owner re-arms it (section 8).                                                                                                                                                                                             |
| Kill switch         | `ONDEMAND_REGIONS` unset or `off` disables recording, the ledger and the manifest read. Behaviour is then byte-identical to today.                                                                                                                                                          |

Outcomes (`recorded`, `duplicate`, `below_threshold`, `ip_capped`,
`global_capped`, `backlog_full`, `known`) are counted by the ledger per day and
exposed to the builder, which exports them as Prometheus counters.

The ledger is also the builder's work queue (section 7). Cell states:
`observed`, `pending`, `building` (with a lease), `done`, `dead`.

## 5. What the user gets while the region is missing

### 5.1 Answer

`FALLBACK_MODE` selects the answer for a not-stored tile:

- `empty` (default): `204`, `Cache-Control: public, max-age=30, s-maxage=60`,
  `X-Tile-Source: none`. The map shows its background until the region lands.
- `upstream` (optional, off until the owner decides, section 6.3): one tile
  read from the planet build by HTTP range requests, answered `200` with
  `Cache-Control: public, max-age=60, s-maxage=120`, `X-Tile-Source: upstream`.

Nothing waits on the builder. The upstream read has a hard budget of
`FALLBACK_TIMEOUT_MS` (1500 ms); on timeout or any error the answer is the
`empty` one. Overzoom from a stored ancestor was considered and rejected: below
z6 the primary archive does not hold ancestors for an unstored area, and any
ancestor at z6 or above is the cell itself.

### 5.2 Caching so a fill is not hidden

- Fallback answers are short-lived by header (above), never the 30-day tile
  header, so a browser or the edge forgets them within a minute or two.
- The classification happens before the cache lookup of a stored tile (apart
  from the primary key, which only ever holds primary tiles). A region that has
  landed therefore sends the request down the region path, which has its own
  cache key, and the old fallback entry is never consulted.
- Edge cache keys: primary tiles keep today's key `origin+path?v=TILES_VERSION`
  (nothing already cached is retired). Region tiles use
  `origin+path?v=TILES_VERSION&r=<region object key>`; a rebuild writes a new
  key (the build date is in it), so tiles cached from the old archive are
  retired by construction. Fallback tiles use
  `origin+path?v=TILES_VERSION&fb=<manifest version>`.
- Browser-held `200` region tiles carry the normal tile header. The cost of an
  upgrade of a region to a newer build is that browsers may hold a tile for up
  to a day (`max-age=86400`), the same as for the primary archive.

## 6. Upstream fallback in detail (optional)

### 6.1 Where the URL comes from

`manifest.upstream.url` (the builder writes the latest build it used; builds
older than a week disappear upstream). It is used only when
`FALLBACK_MODE=upstream` and only against the host named by
`UPSTREAM_ALLOWED_HOST` (a var, no default), so a bad manifest cannot make the
Worker fetch from an arbitrary host.

### 6.2 Reads

The `pmtiles` library, through a range-fetch source, reads the header and
directories (cached per isolate) and one tile. All requests are `GET` with
`Range`, never a full download.

### 6.3 Budget, and why it is off by default

`cf-cache-status: DYNAMIC` on the build means every range read goes to the
origin. At map-browsing volumes that is heavy use of a third party that asks
for no hotlinking, so: a daily budget `UPSTREAM_TILES_PER_DAY` (2000) enforced
by the ledger, one fetch per distinct tile per fallback TTL by the edge cache,
and the default `empty`. The owner's decision, and ideally a courtesy note to
Protomaps, comes before turning it on.

## 7. The region builder (`nyuchi/maps-region-builder`)

A Rust service, private first, Apache-2.0, run as a container on the owner's
Coolify. It is the only thing that reads the planet build.

### 7.1 Protocol with the Worker

Five calls, all `Authorization: Bearer <BUILDER_TOKEN>`, on
`/internal/v1/regions/`. The token is a Worker secret; if it is not set the
routes answer `404` (disabled). They are not in the public OpenAPI file. Auth
failures are rate limited like any other request.

| Call            | Request                                            | Response                                                                                          |
| --------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `POST claim`    | `{ "worker": "id", "lease_seconds": 3600 }`        | `200 { lease, cell, bbox, maxzoom }` for the oldest due pending cell, or `204`                    |
| `POST complete` | `{ lease, cell, key, bytes, build, upstream_url }` | `200 { manifest_version }` after the Worker has read the archive's header from R2 and verified it |
| `POST fail`     | `{ lease, cell, error, permanent }`                | `200`; schedules a retry with exponential backoff, or marks the cell `dead`                       |
| `GET state`     | none                                               | `{ pending, building, done, dead, counters{...}, caps{...}, manifest_version }` for `/metrics`    |

The Worker is the **only writer of `tiles/regions.json`**. A Durable Object
serialises writes, so two completions can never lose each other's entry; the
manifest write is a single R2 `put` of a new version and is visible to every
isolate within 60 seconds. `complete` is idempotent. The builder therefore needs
S3 credentials only for `tiles/regions/*` objects, not for the manifest.
This differs from "the builder updates the manifest object" in the brief; the
reason is exactly that atomicity and locking come for free from the ledger, and
a conditional S3 write loop is replaced by one verified call.

### 7.2 Locking, retries, budgets

- Lock: the lease in the ledger. A cell is leased to one worker for
  `lease_seconds`; the builder renews nothing and a lease that lapses makes
  the cell claimable again. Uploads are to a key containing the build date and
  use `If-None-Match: *`, so a repeated upload of the same cell and build is
  detected and skipped.
- Concurrency: `MAX_CONCURRENT_BUILDS` (default 1).
- Retries: failures call `fail`; the ledger backs off 5 min, 30 min, 3 h,
  then marks `dead` after `MAX_ATTEMPTS` (4). `permanent: true` (bad region,
  validation failure) goes dead at once.
- Budgets: `MAX_REGIONS_PER_DAY` (default 10), `MAX_REGION_BYTES` (default
  1 GiB, enforced from the dry run before any download), and
  `MAX_STORED_BYTES` (default 50 GiB, from the sum of sizes in the manifest it
  last saw). A budget hit pauses claiming and is a metric, not an error.
- Planning: cell to bbox by Web Mercator tile bounds, `maxzoom` 14. The plan is
  confirmed with a dry run (`pmtiles extract --dry-run`), whose tile count and
  size feed the size ceiling.
- Extraction: `Extractor` is a trait. The shipped implementation runs the
  **go-pmtiles CLI**, which is Go, third party (Protomaps, BSD-3-Clause), and
  baked into the container image at a pinned version and checksum. This is
  honest about the trade: a pure Rust `extract` would re-implement the clustered
  range planner and is not worth it for one cell at a time; the CLI is the
  tool Protomaps documents. The Rust code owns everything around it:
  planning, locking, validation, upload, metrics. JS is not used anywhere.
- Validation: the output must be a PMTiles v3 archive, MVT, gzip tile
  compression, `maxzoom` 14, bounds inside the cell's bbox with a margin, with
  tile counts above zero and below a ceiling, and `pmtiles verify` clean.
- Latest build: read from `builds.json` (URL configured), newest first; the
  chosen build must be at least `BUILD_MIN_AGE_HOURS` old and its `b3sum` is
  recorded.

### 7.3 Operability

`/healthz` (liveness plus last-poll age) and `/metrics` (Prometheus text) on
`LISTEN_ADDR`. Metrics: `maps_region_builder_queue_depth{state}`,
`..._builds_total{result}`, `..._last_success_timestamp_seconds`,
`..._stored_bytes`, `..._upstream_errors_total`, `..._budget_paused{budget}`,
`..._worker_demand_total{outcome}`, `..._build_info`. The owner's Prometheus
discovers it by the usual Coolify scrape; this design does not touch the
monitoring repositories.

Nothing owner-specific is in the code or the image: hostnames, buckets and
tokens are environment variables; examples use placeholders; a test bans
private IPs and 32-hex ids from the tree. Secrets come as files or environment
variables from Coolify. The container is non-root.

## 8. Re-arming and refreshing

- A `dead` cell is re-armed by the owner with `POST rearm`, through the builder CLI (`maps-region-builder rearm
6/50/31`), which uses the same token.
- Refreshing a region to a newer build is not automatic. It is the same
  `claim` flow with `refresh` requested by the owner; the new object key
  carries the new build date and the manifest swap retires the old one's cache
  entries. Old region objects are removed by a separate, manual, listed step
  (never by the builder without being asked).

## 9. Observability

### 9.1 Worker

One JSON line per event with `console.log`, picked up by Workers Observability
(already `enabled` in `wrangler.jsonc`):

Per-tile events are deliberately not logged (volume); the response header
`X-Tile-Source` says where a tile came from.

- `{"event":"maps.demand","outcome":"recorded|...","cell":"6/50/31"}` per
  ledger call;
- `{"event":"maps.fallback","mode":"empty|upstream","result":"served|timeout|error|budget","cell":".."}`
  per fallback answer;
- `{"event":"maps.manifest","result":"loaded|stale|invalid|missing","version":12}`.

### 9.2 Builder and Grafana

The builder's `/metrics` carries the ledger's counters and queue depth (from
`GET state`), so one Prometheus target describes the whole feature. Panels and
alerts the owner could add, as text only:

- Panel: `maps_region_builder_queue_depth` by `state`; builds per hour,
  `increase(maps_region_builder_builds_total[1h])` by `result`; stored bytes.
- Alert: `maps_region_builder_queue_depth{state="pending"} > 0` for 2 h while
  `time() - maps_region_builder_last_success_timestamp_seconds > 7200`
  (demand is waiting and nothing builds).
- Alert: `increase(maps_region_builder_builds_total{result="failed"}[1h]) >= 3`.
- Alert: `maps_region_builder_queue_depth{state="dead"} > 0`.
- Alert: `rate(maps_region_builder_worker_demand_total{outcome=~".*capped|backlog_full"}[15m]) > 0`
  (caps are being hit: abuse or a real surge).

### 9.3 Cost

Durable Object requests are one call per not-stored cell per isolate per few
minutes plus the builder's polling (default 30 s, so about 2,900 a day). R2:
Class A operations from multipart uploads (a 100 MB archive is a few dozen
parts) and storage at the current R2 rate; the global per-day caps put a
ceiling on storage growth: 40 cells a day times the size ceiling. Check the
current Cloudflare price list before enabling; I did not price it here.

### 9.4 Alternative: a Queue

When more than one producer needs to publish demand, put a Queue in front of
the ledger: the Worker sends the cell id, a Worker consumer (or an HTTP pull
consumer: `POST /accounts/{id}/queues/{id}/messages/pull` and `/ack`, API
token with Queues Edit) writes it to the ledger, which still deduplicates and
caps. Not needed now.

## 10. What the owner or parent must create

All of this is listed here and **none of it has been run**. Use the Cloudflare
account, bucket and host already chosen for the service; the placeholders below
are not values.

1. R2 S3 credentials for the builder: an R2 API token scoped to the one bucket
   with Object Read and Write (R2 tokens are per bucket, not per prefix, so the
   builder is trusted with the whole bucket; the manifest and the primary
   archive are protected by convention and by the builder only ever writing
   `tiles/regions/`).
   Dry-run: `cf r2 bucket list` to confirm the bucket name, then create the
   token in the dashboard (R2, Manage API tokens) and note the endpoint
   `https://<account-id>.r2.cloudflarestorage.com`.
   Rollback: delete the token.
2. The builder token, generated by the owner and set as a Worker secret:
   `openssl rand -hex 32 | npx wrangler secret put BUILDER_TOKEN` (the same
   value goes to Coolify as a secret environment variable).
   Dry-run: `npx wrangler secret list` shows names only.
   Rollback: `npx wrangler secret delete BUILDER_TOKEN` (the internal routes
   then answer 404).
3. Deploy the Worker with the follow-up PR. The deploy applies the Durable
   Object migration (class `DemandLedger`, SQLite) by itself. Dry-run first:
   `npx wrangler deploy --dry-run --outdir dist`, then `npx wrangler versions upload`
   if a gradual rollout is wanted. Rollback: `npx wrangler rollback`; the
   migration is not undone but the class sits unused when `ONDEMAND_REGIONS`
   is `off`.
4. Enable the feature after the builder is up: set `ONDEMAND_REGIONS` to `on`
   in `wrangler.jsonc` and deploy. Rollback: set it back to `off` and deploy;
   behaviour returns to today's exactly.
5. Seed the manifest once with the primary coverage (and `upstream` if wanted):
   `maps-region-builder primary-coverage --region scripts/extract-regions.geojson > primary.json`,
   merge into a first `regions.json`, upload with
   `npx wrangler r2 object put "<bucket>/tiles/regions.json" --file regions.json --remote`.
   Rollback: delete the object (an empty manifest is valid).
6. Run the builder on Coolify from the container image with the environment
   variables in the builder's README; open `/metrics` to Prometheus.
7. If Protomaps' builds are to be fetched by the Worker (`FALLBACK_MODE=upstream`),
   the owner decides first; set `UPSTREAM_ALLOWED_HOST`.

Not created by this work: queues, buckets, DNS, routes, tokens, Access
applications, Containers, D1 databases.

## 11. Not verified

- No Worker or builder code has run against real Cloudflare, real R2 or the
  Protomaps build beyond the read-only checks in section 1.2.
- Protomaps' production-traffic terms are unknown; section 1.2 states what was
  found.
- The Durable Object throughput and cost under real traffic are unmeasured.
- The prices are not looked up.

## 12. Open questions

1. Is the optional single-tile upstream fallback wanted at all, given the
   Protomaps position on hotlinking? The default answer is `204`.
2. A dead or never-built cell shows a blank base map indefinitely. Should the
   style show a message, or should an operator be paged?
3. The size ceiling, the global daily cap and the storage budget are guesses
   to be set by the owner.
4. Whether the primary archive's polygon should be kept as cells in the
   manifest long term or replaced by splitting the primary into regions too.
