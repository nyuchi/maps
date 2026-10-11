import type { Context } from "hono";
import type { AppEnv, Env } from "./types";

/** Tiles are immutable between archive refreshes: cache for a long time. */
export const CACHE_TILE =
  "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400";
/** A tile the archive does not hold; short so a refresh shows up soon. */
export const CACHE_EMPTY = "public, max-age=3600, s-maxage=86400";
/** Out of range or unknown: cache briefly, never forever. */
export const CACHE_MISS = "public, max-age=300, s-maxage=3600";
/** Styles, TileJSON, sprites, fonts: change on our releases only. */
export const CACHE_ASSET =
  "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400";
export const NO_STORE = "no-store";

export function baseUrl(env: Env, requestUrl: string): string {
  const configured = env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (configured) {
    try {
      const u = new URL(configured);
      const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
      if ((u.protocol === "https:" || local) && u.pathname === "/") {
        return u.origin;
      }
    } catch {
      // fall through to the request origin
    }
  }
  return new URL(requestUrl).origin;
}

export function jsonError(
  status: number,
  error: string,
  extra?: HeadersInit,
): Response {
  const headers = new Headers(extra);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", NO_STORE);
  return new Response(JSON.stringify({ error }), { status, headers });
}

/** True when an If-None-Match header lists (or wildcards) this ETag. */
export function etagMatches(
  header: string | null | undefined,
  etag: string,
): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  const bare = etag.replace(/^W\//, "");
  return header
    .split(",")
    .map((t) => t.trim().replace(/^W\//, ""))
    .includes(bare);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** JSON response with a content-hash ETag and 304 handling. */
export async function jsonResponse(
  c: Context<AppEnv>,
  body: unknown,
  cacheControl: string,
  contentType = "application/json; charset=utf-8",
): Promise<Response> {
  const text = JSON.stringify(body);
  const etag = `"${await sha256Hex(text)}"`;
  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    ETag: etag,
  });
  if (etagMatches(c.req.header("If-None-Match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(text, { status: 200, headers });
}
