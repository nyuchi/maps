import type { Context, Hono } from "hono";
import { parseAllowedOrigins } from "./cors";
import { jsonError } from "./http";
import type { AppEnv } from "./types";

/**
 * Content-Security-Policy for the dashboard pages.
 *
 * Everything is same-origin: the pages, their scripts, the vendored MapLibre
 * module and its worker, the style, tiles, glyphs and sprites all come from
 * this Worker. `img-src data:` is for MapLibre's own control icons (inlined in
 * its stylesheet); `blob:` covers the fallback worker MapLibre builds when a
 * module worker is unavailable. `frame-src 'self'` is for the Embed builder's
 * live preview, which frames this site's own /embed/ page. No inline script,
 * no inline style, no eval, no third-party origin.
 */
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "manifest-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * Content-Security-Policy for /embed/, the page other sites may frame. It is
 * the dashboard's policy without frame-src (the page frames nothing), and its
 * `frame-ancestors` is the ONE gate for who may embed it:
 *
 *   'self'                  the Embed builder's preview, always
 *   each ALLOWED_ORIGINS    the first-party sites that already may call /v1
 *
 * Nothing in the request can add to this list: not the query string, not a
 * header, not the Referer. A per-key list of allowed sites arrives with the
 * Maps API (docs/console-design.md, section 6); until then this is a
 * configured allow-list and nothing more.
 */
export function embedCsp(allowedOrigins: string | undefined): string {
  const ancestors = ["'self'", ...frameSources(allowedOrigins)];
  return [
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
    `frame-ancestors ${ancestors.join(" ")}`,
  ].join("; ");
}

/**
 * ALLOWED_ORIGINS entries that are valid CSP host-sources: a scheme, a host
 * (optionally one leading "*." label) and an optional port. Anything else (a
 * path, a space, a semicolon) is dropped, so a bad entry cannot add a
 * directive or widen the policy.
 */
export function frameSources(value: string | undefined): string[] {
  const source =
    /^https?:\/\/(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::\d{1,5})?$/;
  return [...new Set(parseAllowedOrigins(value).filter((o) => source.test(o)))];
}

/** The HTML names hashed assets, so a short life is enough and safe. */
export const CACHE_HTML = "public, max-age=60, must-revalidate";
/** Content-addressed (hash or version in the path): never changes. */
export const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";
/** favicons, robots.txt: stable names, slow to change. */
export const CACHE_STATIC = "public, max-age=86400";

/** The dashboard pages, each a directory index built by site/. */
export const PAGES = [
  "/",
  "/explorer/",
  "/endpoints/",
  "/embed-builder/",
  "/docs/",
  "/status/",
] as const;

/**
 * Hashed or versioned paths only: everything Astro emits under
 * assets/site/ (every file name carries an 8-character content hash) and
 * anything under assets/vendor/<package>/<version>/. Anything else under
 * /assets is not assumed immutable.
 */
const IMMUTABLE =
  /^\/assets\/(?:site\/[A-Za-z0-9._-]+\.[A-Za-z0-9_-]{8}\.(?:js|css|png)|vendor\/[a-z0-9-]+\/\d+\.\d+\.\d+\/[A-Za-z0-9._-]+)$/;

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

/** GET on a dashboard page. */
export function sitePage(c: Ctx): Promise<Response> {
  return fromAssets(c, CACHE_HTML, {
    "Content-Security-Policy": CSP,
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy":
      "geolocation=(self), camera=(), microphone=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  });
}

/**
 * GET /embed/ : the embeddable map. Other sites may frame it only if their
 * origin is in the policy built by embedCsp(); CORP is relaxed because a
 * document that may be framed has to be loadable across origins, and
 * frame-ancestors is what decides who may do that.
 */
export function embedPage(c: Ctx): Promise<Response> {
  return fromAssets(c, CACHE_HTML, {
    "Content-Security-Policy": embedCsp(c.env.ALLOWED_ORIGINS),
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy":
      "geolocation=(), camera=(), microphone=(), payment=(), usb=()",
    "Cross-Origin-Resource-Policy": "cross-origin",
  });
}

/** GET /assets/* : hashed bundles and the vendored MapLibre files. */
export function siteAsset(c: Ctx): Promise<Response> {
  return fromAssets(
    c,
    IMMUTABLE.test(c.req.path) ? CACHE_IMMUTABLE : CACHE_STATIC,
  );
}

/** GET /favicon*.png and /robots.txt. */
export function staticFile(c: Ctx): Promise<Response> {
  return fromAssets(c, CACHE_STATIC);
}

/**
 * The dashboard's routes, in one place: the pages (with a redirect from the
 * form without the trailing slash), the embed page, /assets/*, the favicons
 * and robots.txt. /v1, /health and /openapi.json are not touched here.
 */
export function registerWebRoutes(app: Hono<AppEnv>): void {
  for (const path of PAGES) {
    app.get(path, sitePage);
    if (path !== "/") {
      const bare = path.slice(0, -1);
      app.get(bare, (c) => {
        const url = new URL(c.req.url);
        url.pathname = path;
        return c.redirect(url.toString(), 308);
      });
    }
  }
  app.get("/embed/", embedPage);
  app.get("/embed", (c) => {
    const url = new URL(c.req.url);
    url.pathname = "/embed/";
    return c.redirect(url.toString(), 308);
  });
  app.get("/assets/*", siteAsset);
  app.get("/favicon.png", staticFile);
  app.get("/favicon-dark.png", staticFile);
  app.get("/robots.txt", staticFile);
}
