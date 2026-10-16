import type { Context, MiddlewareHandler } from "hono";
import { jsonError } from "./http";
import type { AppEnv } from "./types";

/**
 * Per-IP limit through the Workers rate limiting binding (RATE_LIMITER).
 *
 * - It fails open: a missing binding or a limiter error must never take the
 *   map down.
 * - A request with no CF-Connecting-IP (never the case behind Cloudflare;
 *   local dev and tests only) has nothing to key on, so it is not limited
 *   rather than sharing one global "unknown" bucket that could throttle
 *   everyone at once.
 * - Tile requests are limited only when they miss the edge cache (see
 *   tilesAreLimitedOnMiss below): cache hits cost the origin nothing, and
 *   many users behind one carrier-grade NAT address must not exhaust the
 *   limit just by loading cached tiles.
 */
export async function checkRateLimit(
  c: Context<AppEnv>,
): Promise<Response | null> {
  const limiter = c.env.RATE_LIMITER;
  const ip = c.req.header("CF-Connecting-IP");
  if (!limiter || !ip) return null;
  try {
    const { success } = await limiter.limit({ key: ip });
    if (!success)
      return jsonError(429, "rate_limited", { "Retry-After": "60" });
  } catch (err) {
    console.error("rate limiter failed, allowing request", err);
  }
  return null;
}

/** Tile routes do their own check, after the edge cache lookup. */
const TILE_PATH = /^\/v1\/(sources\/[^/]+\/)?tiles\/[^/]+\/[^/]+\/[^/]+$/;

export const tilesAreLimitedOnMiss = (path: string): boolean =>
  TILE_PATH.test(path);

/** Limit every /v1 route except tiles, which limit themselves on a miss. */
export const rateLimit: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!tilesAreLimitedOnMiss(c.req.path)) {
    const limited = await checkRateLimit(c);
    if (limited) return limited;
  }
  await next();
};
