export interface Env {
  /** R2 bucket holding the PMTiles archive, glyphs and sprites. */
  MAPS_BUCKET: R2Bucket;
  /** Workers rate limiting binding, keyed by client IP. */
  RATE_LIMITER?: RateLimit;
  /** Public origin for URLs in TileJSON and styles (no trailing slash). */
  PUBLIC_BASE_URL?: string;
  /** Comma-separated first-party origins allowed by CORS. */
  ALLOWED_ORIGINS?: string;
  /** Object key of the PMTiles archive in the bucket. */
  TILES_KEY?: string;
  /** Set to "off" to skip the Cache API (tests). */
  EDGE_CACHE?: string;
}

export type AppEnv = { Bindings: Env };
