import type { MiddlewareHandler } from "hono";
import { jsonError } from "./http";
import type { AppEnv } from "./types";

/**
 * Per-IP limit through the Workers rate limiting binding (RATE_LIMITER).
 * It fails open: a missing binding or a limiter error must never take the
 * map down.
 */
export const rateLimit: MiddlewareHandler<AppEnv> = async (c, next) => {
  const limiter = c.env.RATE_LIMITER;
  if (limiter) {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    try {
      const { success } = await limiter.limit({ key: ip });
      if (!success) {
        return jsonError(429, "rate_limited", { "Retry-After": "60" });
      }
    } catch (err) {
      console.error("rate limiter failed, allowing request", err);
    }
  }
  await next();
};
