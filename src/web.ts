import type { Context } from "hono";
import { jsonError } from "./http";
import type { AppEnv } from "./types";

/**
 * Content-Security-Policy for the map page.
 *
 * Everything is same-origin: the page, its script, the vendored MapLibre
 * module and its worker, the style, tiles, glyphs and sprites all come from
 * this Worker. `img-src data:` is for MapLibre's own control icons (inlined in
 * its stylesheet); `blob:` covers the fallback worker MapLibre builds when a
 * module worker is unavailable. No inline script, no inline style, no eval.
 */
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** The HTML names hashed assets, so a short life is enough and safe. */
export const CACHE_HTML = "public, max-age=60, must-revalidate";
/** Content-addressed (hash or version in the path): never changes. */
export const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";
/** favicon, robots.txt: stable names, slow to change. */
export const CACHE_STATIC = "public, max-age=86400";

/**
 * Hashed or versioned paths only: app.<hash>.js|css and anything under
 * assets/vendor/<package>/<version>/. Anything else under /assets is not
 * assumed immutable.
 */
const IMMUTABLE =
  /^\/assets\/(?:app\.[0-9a-f]{10}\.(?:js|css)|vendor\/[a-z0-9-]+\/\d+\.\d+\.\d+\/[A-Za-z0-9._-]+)$/;

type Ctx = Context<AppEnv>;

async function fromAssets(
  c: Ctx,
  cacheControl: string,
  extra?: Record<string, string>,
): Promise<Response> {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.status !== 200 && res.status !== 304) {
    return jsonError(404, "not_found", { "Cache-Control": "no-store" });
  }
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", cacheControl);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  for (const [name, value] of Object.entries(extra ?? {})) {
    headers.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers });
}

/** GET / : the map page. */
export function mapPage(c: Ctx): Promise<Response> {
  return fromAssets(c, CACHE_HTML, {
    "Content-Security-Policy": CSP,
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy":
      "geolocation=(self), camera=(), microphone=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  });
}

/** GET /assets/* : hashed bundles and the vendored MapLibre files. */
export function mapAsset(c: Ctx): Promise<Response> {
  return fromAssets(
    c,
    IMMUTABLE.test(c.req.path) ? CACHE_IMMUTABLE : CACHE_STATIC,
  );
}

/** GET /favicon.svg and /robots.txt. */
export function staticFile(c: Ctx): Promise<Response> {
  return fromAssets(c, CACHE_STATIC);
}
