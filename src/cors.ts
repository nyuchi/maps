import type { MiddlewareHandler } from "hono";
import { jsonError, rebuild } from "./http";
import type { AppEnv } from "./types";

/** Split the ALLOWED_ORIGINS var into trimmed, non-empty entries. */
export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/**
 * Exact match, or "https://*.example.com" to match any one-or-more-label
 * subdomain (never the bare apex, never a different suffix).
 */
export function isOriginAllowed(origin: string, allowed: string[]): boolean {
  for (const entry of allowed) {
    if (entry === origin) return true;
    const star = entry.indexOf("*.");
    if (star > 0 && entry.slice(0, star).endsWith("//")) {
      const scheme = entry.slice(0, star);
      const suffix = entry.slice(star + 1); // ".example.com"
      if (
        origin.startsWith(scheme) &&
        origin.endsWith(suffix) &&
        origin.length > scheme.length + suffix.length &&
        !origin.slice(scheme.length, -suffix.length).includes("/")
      ) {
        return true;
      }
    }
  }
  return false;
}

const ALLOW_METHODS = "GET, HEAD, OPTIONS";
const EXPOSE = "ETag, Content-Length, Content-Encoding";

/**
 * CORS allow-list. Requests without an Origin header (servers, curl) are
 * not browsers and pass untouched. A browser origin outside the list gets
 * no Access-Control-Allow-Origin, so the browser refuses the response; its
 * preflight is answered 403.
 */
export const cors: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header("Origin");
  const allowed = parseAllowedOrigins(c.env.ALLOWED_ORIGINS);
  const ok = origin !== undefined && isOriginAllowed(origin, allowed);

  if (c.req.method === "OPTIONS") {
    if (!ok) return jsonError(403, "origin_not_allowed", { Vary: "Origin" });
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": ALLOW_METHODS,
        "Access-Control-Allow-Headers":
          c.req.header("Access-Control-Request-Headers") ?? "",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
    });
  }

  await next();

  // Rebuild the response: ones from the Cache API have immutable headers.
  // rebuild() keeps encodeBody "manual" for already-compressed tiles.
  const res = rebuild(c.res);
  // Always vary on Origin: the same URL answers differently per origin.
  res.headers.append("Vary", "Origin");
  if (origin !== undefined && ok) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Expose-Headers", EXPOSE);
  }
  c.res = res;
};
