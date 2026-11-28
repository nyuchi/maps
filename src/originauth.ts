import type { MiddlewareHandler } from "hono";
import { rebuild } from "./http";
import type { AppEnv, Env } from "./types";

/**
 * Origin authentication: only the Nyuchi Servers API may call /v1 here.
 *
 * `maps.nyuchi.com` has a public hostname (it serves the dashboard), so once
 * every consumer has moved to `api.nyuchi.com`, `/v1/*` must refuse callers
 * that do not come from the Servers API. The credential is a request
 * signature (scheme "v1" below), checked in this middleware, which runs
 * BEFORE any cache lookup, rate limiter or route handler, so a cached tile is
 * never reachable without it.
 *
 * Modes (env ORIGIN_AUTH):
 * - "off" (default, also when unset or empty): this file does nothing.
 * - "log": verify, count and log the outcome, never reject. The response
 *   carries X-Origin-Auth: ok | missing | invalid so the signing side can be
 *   tested end to end.
 * - "enforce": a /v1 request without a valid credential is a 401 problem.
 * - Any other value is treated as "enforce" (fail closed, loudly logged): a
 *   typo must not silently open the origin.
 *
 * Scheme "v1" (the design doc's proposal, extended with a key id and nonce;
 * the Servers API's signer must produce exactly this):
 *
 *   X-Nyuchi-Origin: kid=<key id>,t=<unix seconds>,n=<nonce>,v1=<hex>
 *
 *   v1 = hex( HMAC-SHA256( secret(kid), canonical ) )
 *   canonical = "nyuchi-origin-v1" "\n" METHOD "\n" TARGET "\n" t "\n" n "\n" kid
 *   TARGET    = the request path plus its query string exactly as sent
 *               (no scheme, host or fragment), e.g. /v1/tiles/3/4/5.mvt?x=1
 *
 * See docs/ARCHITECTURE.md for the replay trade-off and the rotation steps.
 */

export const ORIGIN_HEADER = "X-Nyuchi-Origin";
export const RESULT_HEADER = "X-Origin-Auth";

export type OriginAuthMode = "off" | "log" | "enforce";
export type OriginAuthResult = "ok" | "missing" | "invalid";

/** Why a credential was rejected. Logged only; never sent to the caller. */
export type InvalidReason =
  | "malformed"
  | "no_keys"
  | "unknown_key"
  | "expired"
  | "bad_signature"
  | "replayed";

export type Verdict =
  | { result: "ok"; kid: string }
  | { result: "missing" }
  | { result: "invalid"; reason: InvalidReason };

const DEFAULT_WINDOW_SECONDS = 60;
const MIN_WINDOW_SECONDS = 5;
const MAX_WINDOW_SECONDS = 300;
/** Secrets shorter than this are ignored: too weak to be a key. */
const MIN_SECRET_LENGTH = 16;
/** Bound on remembered nonces per isolate (best-effort replay defence). */
const MAX_NONCES = 10_000;

const KID = /^[A-Za-z0-9_-]{1,32}$/;
const NONCE = /^[A-Za-z0-9_-]{16,64}$/;
const SECONDS = /^\d{1,12}$/;
const SIGNATURE = /^[0-9a-f]{64}$/;
const MAX_HEADER_LENGTH = 256;

export function originAuthMode(env: Env): OriginAuthMode {
  const raw = (env.ORIGIN_AUTH ?? "").trim().toLowerCase();
  if (raw === "" || raw === "off") return "off";
  if (raw === "log") return "log";
  if (raw !== "enforce") {
    console.error(
      JSON.stringify({ event: "origin_auth_bad_mode", mode: "enforce" }),
    );
  }
  return "enforce";
}

function windowSeconds(env: Env): number {
  const n = Number(env.ORIGIN_AUTH_WINDOW_SECONDS);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WINDOW_SECONDS;
  return Math.min(MAX_WINDOW_SECONDS, Math.max(MIN_WINDOW_SECONDS, n));
}

// ---- keys -------------------------------------------------------------------

type KeyRing = Map<string, CryptoKey>;

let ringSource: string | undefined;
let ringPromise: Promise<KeyRing> | undefined;

/**
 * ORIGIN_AUTH_KEYS is one Worker secret holding "kid:secret" pairs separated
 * by commas, so a rotation is: add the new pair, switch the signer, remove the
 * old pair. The imported keys are cached for as long as the secret is
 * unchanged.
 */
function keyRing(env: Env): Promise<KeyRing> {
  const source = env.ORIGIN_AUTH_KEYS ?? "";
  if (ringPromise && ringSource === source) return ringPromise;
  ringSource = source;
  ringPromise = (async () => {
    const ring: KeyRing = new Map();
    for (const entry of source.split(",")) {
      const at = entry.indexOf(":");
      if (at < 1) continue;
      const kid = entry.slice(0, at).trim();
      const secret = entry.slice(at + 1).trim();
      if (!KID.test(kid) || secret.length < MIN_SECRET_LENGTH) continue;
      ring.set(
        kid,
        await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(secret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["verify"],
        ),
      );
    }
    return ring;
  })();
  return ringPromise;
}

// A key that matches nothing: an unknown key id costs the same HMAC as a known
// one, so timing does not tell a caller which key ids exist.
let decoyKey: Promise<CryptoKey> | undefined;
function decoy(): Promise<CryptoKey> {
  decoyKey ??= crypto.subtle.importKey(
    "raw",
    crypto.getRandomValues(new Uint8Array(32)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return decoyKey;
}

// ---- replay ------------------------------------------------------------------

/**
 * Best-effort, per isolate only. A Worker is stateless and runs in many
 * isolates, so this does not stop a replay that lands in another isolate or
 * after a restart. What bounds a replay for real is the short validity window
 * plus the signature covering method and target: a captured credential
 * cannot be used for any other request, and only for GET and HEAD of public
 * map data for at most the window. Strict one-time nonces would need shared
 * state (a Durable Object or KV) on every tile request, which costs more than
 * the exposure it removes. The signer must therefore use a fresh nonce for
 * every attempt, retries included.
 */
const seenNonces = new Map<string, number>();

function rememberNonce(key: string, now: number, ttl: number): boolean {
  const until = seenNonces.get(key);
  if (until !== undefined && until > now) return false;
  seenNonces.delete(key);
  if (seenNonces.size >= MAX_NONCES) {
    for (const [k, exp] of seenNonces) {
      if (exp <= now) seenNonces.delete(k);
    }
    // Still full: drop the oldest entries (Map iterates in insertion order).
    for (const k of seenNonces.keys()) {
      if (seenNonces.size < MAX_NONCES) break;
      seenNonces.delete(k);
    }
  }
  seenNonces.set(key, now + ttl);
  return true;
}

/** Test hook: forget every nonce. */
export function resetNonces(): void {
  seenNonces.clear();
}

// ---- verification ------------------------------------------------------------

interface Parsed {
  kid: string;
  t: number;
  tRaw: string;
  n: string;
  sig: Uint8Array;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function parseHeader(value: string): Parsed | null {
  if (value.length > MAX_HEADER_LENGTH) return null;
  const fields = new Map<string, string>();
  for (const part of value.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 1) return null;
    const name = part.slice(0, eq).trim();
    if (fields.has(name)) return null;
    fields.set(name, part.slice(eq + 1).trim());
  }
  const kid = fields.get("kid");
  const t = fields.get("t");
  const n = fields.get("n");
  const v1 = fields.get("v1");
  if (!kid || !t || !n || !v1) return null;
  if (!KID.test(kid) || !SECONDS.test(t) || !NONCE.test(n)) return null;
  if (!SIGNATURE.test(v1)) return null;
  return { kid, t: Number(t), tRaw: t, n, sig: fromHex(v1) };
}

/** The exact string both sides sign. */
export function canonicalString(
  method: string,
  target: string,
  t: string,
  nonce: string,
  kid: string,
): string {
  return ["nyuchi-origin-v1", method.toUpperCase(), target, t, nonce, kid].join(
    "\n",
  );
}

/** Path plus query exactly as the Worker received it. */
export function requestTarget(url: string): string {
  const u = new URL(url);
  return u.pathname + u.search;
}

/**
 * Verify the credential on a request. `nowSeconds` is injectable for tests.
 */
export async function verifyOrigin(
  env: Env,
  request: Request,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<Verdict> {
  const header = request.headers.get(ORIGIN_HEADER);
  if (header === null) return { result: "missing" };

  const parsed = parseHeader(header);
  if (!parsed) return { result: "invalid", reason: "malformed" };

  const ring = await keyRing(env);
  if (ring.size === 0) return { result: "invalid", reason: "no_keys" };

  // Always do the HMAC, whatever else is wrong, so the answer's timing does
  // not separate a bad key id or a stale timestamp from a bad signature.
  const key = ring.get(parsed.kid);
  const data = new TextEncoder().encode(
    canonicalString(
      request.method,
      requestTarget(request.url),
      parsed.tRaw,
      parsed.n,
      parsed.kid,
    ),
  );
  // crypto.subtle.verify compares in constant time.
  const signed = await crypto.subtle.verify(
    "HMAC",
    key ?? (await decoy()),
    parsed.sig,
    data,
  );

  const window = windowSeconds(env);
  if (!key) return { result: "invalid", reason: "unknown_key" };
  if (!signed) return { result: "invalid", reason: "bad_signature" };
  if (Math.abs(nowSeconds - parsed.t) > window) {
    return { result: "invalid", reason: "expired" };
  }
  // Only a correctly signed, in-window credential reaches here, so an
  // attacker cannot fill the nonce table with made-up values.
  if (!rememberNonce(`${parsed.kid}:${parsed.n}`, nowSeconds, window * 2 + 1)) {
    return { result: "invalid", reason: "replayed" };
  }
  return { result: "ok", kid: parsed.kid };
}

// ---- middleware ---------------------------------------------------------------

/** RFC 9457 problem. Never says which part of the credential was wrong. */
function unauthorized(): Response {
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail: "A valid credential is required.",
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/problem+json",
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Nyuchi-Origin realm="maps-origin"',
      },
    },
  );
}

/** A coarse route name for logs: bounded, with no coordinates or query. */
function routeClass(path: string): string {
  const m = /^\/v1\/(?:sources\/[^/]+\/)?([^/.]+)/.exec(path);
  return m ? m[1]! : "other";
}

function log(
  mode: OriginAuthMode,
  c: { req: { method: string; path: string } },
  verdict: Verdict,
): void {
  console.log(
    JSON.stringify({
      event: "origin_auth",
      mode,
      result: verdict.result,
      ...(verdict.result === "invalid" ? { reason: verdict.reason } : {}),
      ...(verdict.result === "ok" ? { kid: verdict.kid } : {}),
      method: c.req.method,
      route: routeClass(c.req.path),
    }),
  );
}

/**
 * Mounted on /v1/* ahead of the rate limiter and every handler (and so ahead
 * of the edge cache read and write in the tile handler). /health, the static
 * map page and /openapi.json are not under /v1 and stay public.
 */
export const originAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const mode = originAuthMode(c.env);
  if (mode === "off") return next();

  const verdict = await verifyOrigin(c.env, c.req.raw);

  if (mode === "enforce") {
    if (verdict.result === "ok") return next();
    log(mode, c, verdict);
    return unauthorized();
  }

  // log mode: count everything, reject nothing, tell the caller the result.
  log(mode, c, verdict);
  await next();
  // Responses from the Cache API have immutable headers: rebuild first.
  const res = rebuild(c.res);
  res.headers.set(RESULT_HEADER, verdict.result);
  c.res = res;
};
