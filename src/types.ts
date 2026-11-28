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
  /** Set to "off" to skip the Cache API (tests). */
  EDGE_CACHE?: string;
}

export type AppEnv = { Bindings: Env };
