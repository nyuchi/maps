import type { DemandLedger } from "./regions/ledger";

export interface Env {
  /** Static assets binding: the map page and its files (public/). */
  ASSETS: Fetcher;
  /** R2 bucket holding the PMTiles archive, glyphs and sprites. */
  MAPS_BUCKET: R2Bucket;
  /** Workers rate limiting binding, keyed by client IP. */
  RATE_LIMITER?: RateLimit;
  /** Public origin for URLs in TileJSON and styles (no trailing slash). */
  PUBLIC_BASE_URL?: string;
  /** Comma-separated first-party origins allowed by CORS. */
  ALLOWED_ORIGINS?: string;
  /** Origin auth mode: "off" (default), "log" or "enforce". */
  ORIGIN_AUTH?: string;
  /** Secret: verification keys as "kid:secret,kid:secret" (see originauth). */
  ORIGIN_AUTH_KEYS?: string;
  /** Allowed clock skew and credential lifetime in seconds (5 to 300, 60). */
  ORIGIN_AUTH_WINDOW_SECONDS?: string;
  /** Object key of the PMTiles archive in the bucket. */
  TILES_KEY?: string;
  /** Bump when the archive is replaced: part of the edge cache key. */
  TILES_VERSION?: string;
  /** On-demand regions: "on" enables them; anything else leaves the Worker as it was. */
  ONDEMAND_REGIONS?: string;
  /** Demand ledger Durable Object (SQLite). */
  DEMAND?: DurableObjectNamespace<DemandLedger>;
  /** Secret: bearer token for /internal/v1/regions (the builder's). */
  BUILDER_TOKEN?: string;
  /** Object key of the regions manifest. Default tiles/regions.json. */
  MANIFEST_KEY?: string;
  /** Seconds the manifest is held in memory. Default 60. */
  MANIFEST_TTL_SECONDS?: string;
  /** Name of the one ledger instance. Default "ledger". */
  LEDGER_NAME?: string;
  /** "upstream" reads a single tile from the planet build; default is a 204. */
  FALLBACK_MODE?: string;
  /** The only host the upstream planet build may be read from. */
  UPSTREAM_ALLOWED_HOST?: string;
  FALLBACK_TIMEOUT_MS?: string;
  /** "0" lets a request without an allowed Origin record demand. */
  DEMAND_REQUIRE_ORIGIN?: string;
  DEMAND_MIN_TILES?: string;
  DEMAND_IP_CELLS_PER_DAY?: string;
  DEMAND_IP_HITS_PER_DAY?: string;
  DEMAND_NEW_CELLS_PER_DAY?: string;
  DEMAND_MAX_PENDING?: string;
  UPSTREAM_TILES_PER_DAY?: string;
  /** Set to "off" to skip the Cache API (tests). */
  EDGE_CACHE?: string;
}

export type AppEnv = { Bindings: Env };
