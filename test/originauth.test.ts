import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalString, resetNonces, verifyOrigin } from "../src/originauth";
import { StubBucket, buildPmtiles, call, makeCtx, makeEnv } from "./helpers";
import type { Env } from "../src/types";

// Placeholders: test-only values, not secrets of any deployment.
const SECRET = "test-secret-0123456789abcdef";
const OTHER_SECRET = "other-secret-0123456789abcdef";
const KEYS = `k1:${SECRET}`;

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

let counter = 0;
/** A fresh 22-character nonce. */
function nonce(): string {
  counter += 1;
  return `n${String(counter).padStart(21, "0")}`;
}

interface SignOptions {
  kid?: string;
  secret?: string;
  t?: number;
  n?: string;
}

/** The reference signer: what the Servers API must produce. */
async function sign(
  method: string,
  target: string,
  opts: SignOptions = {},
): Promise<string> {
  const kid = opts.kid ?? "k1";
  const t = String(opts.t ?? Math.floor(Date.now() / 1000));
  const n = opts.n ?? nonce();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(opts.secret ?? SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(canonicalString(method, target, t, n, kid)),
  );
  return `kid=${kid},t=${t},n=${n},v1=${hex(mac)}`;
}

async function signed(
  path: string,
  opts: SignOptions = {},
  extra: Record<string, string> = {},
  method = "GET",
): Promise<RequestInit> {
  return {
    method,
    headers: { "X-Nyuchi-Origin": await sign(method, path, opts), ...extra },
  };
}

function bucketWithTile() {
  return new StubBucket()
    .put(
      "tiles/test.pmtiles",
      buildPmtiles([{ z: 0, x: 0, y: 0, data: new Uint8Array([1, 2, 3]) }]),
      "arch1",
    )
    .put("sprites/light.json", "{}")
    .put("sprites/light@2x.png", new Uint8Array([9]));
}

const TILE = "/v1/tiles/0/0/0.mvt";

beforeEach(() => {
  resetNonces();
  vi.restoreAllMocks();
});

describe("known-answer vector", () => {
  it("canonical string and signature match the documented example", async () => {
    // docs/ARCHITECTURE.md quotes this vector; the Servers API's tests use it.
    const canonical = canonicalString(
      "GET",
      "/v1/tiles/3/4/5.mvt?x=1",
      "1700000000",
      "AAAAAAAAAAAAAAAAAAAAAA",
      "k1",
    );
    expect(canonical).toBe(
      "nyuchi-origin-v1\nGET\n/v1/tiles/3/4/5.mvt?x=1\n1700000000\nAAAAAAAAAAAAAAAAAAAAAA\nk1",
    );
    const header = await sign("GET", "/v1/tiles/3/4/5.mvt?x=1", {
      t: 1700000000,
      n: "AAAAAAAAAAAAAAAAAAAAAA",
      secret: "test-secret-0123456789abcdef",
    });
    expect(header).toBe(
      "kid=k1,t=1700000000,n=AAAAAAAAAAAAAAAAAAAAAA,v1=1531768216d79431dc3b6689f96c5699c7188dabb7c8506346845d3af0f23ab6",
    );
  });
});

describe("ORIGIN_AUTH=off (the default)", () => {
  it("serves /v1 with no credential, as before", async () => {
    const env = makeEnv(bucketWithTile());
    expect(env.ORIGIN_AUTH).toBeUndefined();
    expect((await call(TILE, env)).status).toBe(200);
    expect((await call("/v1/tiles.json", env)).status).toBe(200);
  });

  it("treats an empty or 'off' value the same, and adds no header", async () => {
    for (const v of ["", "off", "OFF", " off "]) {
      const res = await call(
        TILE,
        makeEnv(bucketWithTile(), { ORIGIN_AUTH: v }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Origin-Auth")).toBeNull();
    }
  });

  it("ignores a credential entirely, even a bad one", async () => {
    const res = await call(TILE, makeEnv(bucketWithTile()), {
      headers: { "X-Nyuchi-Origin": "garbage" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Origin-Auth")).toBeNull();
  });
});

describe("ORIGIN_AUTH=log", () => {
  const env = () =>
    makeEnv(bucketWithTile(), { ORIGIN_AUTH: "log", ORIGIN_AUTH_KEYS: KEYS });

  it("serves a valid request and reports ok", async () => {
    const res = await call(TILE, env(), await signed(TILE));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Origin-Auth")).toBe("ok");
  });

  it("serves a request with no credential and reports missing", async () => {
    const res = await call(TILE, env());
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Origin-Auth")).toBe("missing");
  });

  it("serves a bad credential and reports only 'invalid'", async () => {
    const init = await signed(TILE, { secret: OTHER_SECRET });
    const res = await call(TILE, env(), init);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Origin-Auth")).toBe("invalid");
  });

  it("reports on non-tile routes and error responses too", async () => {
    const res = await call("/v1/sprites/nope.png", env());
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Origin-Auth")).toBe("missing");
  });

  it("does not add the header outside /v1", async () => {
    const res = await call("/health", env());
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Origin-Auth")).toBeNull();
  });

  it("logs one structured line with no path, query, key or signature", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const target = `${TILE}?key=SECRETKEYVALUE`;
    await call(target, env(), await signed(target));
    await call(TILE, env());
    const lines = spy.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({
      event: "origin_auth",
      mode: "log",
      result: "ok",
      kid: "k1",
      method: "GET",
      route: "tiles",
    });
    expect(JSON.parse(lines[1]!)).toMatchObject({ result: "missing" });
    for (const line of lines) {
      expect(line).not.toContain("SECRETKEYVALUE");
      expect(line).not.toContain(SECRET);
      expect(line).not.toContain("v1=");
    }
  });

  it("logs the reason for a rejection-to-be", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await call(
      TILE,
      env(),
      await signed(TILE, { t: Math.floor(Date.now() / 1000) - 600 }),
    );
    expect(JSON.parse(String(spy.mock.calls[0]![0]))).toMatchObject({
      result: "invalid",
      reason: "expired",
    });
  });
});

describe("ORIGIN_AUTH=enforce", () => {
  const env = (extra: Partial<Env> = {}) =>
    makeEnv(bucketWithTile(), {
      ORIGIN_AUTH: "enforce",
      ORIGIN_AUTH_KEYS: KEYS,
      ...extra,
    });

  it("serves a validly signed request", async () => {
    const res = await call(TILE, env(), await signed(TILE));
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(res.headers.get("X-Origin-Auth")).toBeNull();
  });

  it("signs the query string: a signed query serves, another does not", async () => {
    const target = `${TILE}?v=1`;
    expect((await call(target, env(), await signed(target))).status).toBe(200);
    const init = await signed(target);
    expect((await call(`${TILE}?v=2`, env(), init)).status).toBe(401);
  });

  it("rejects a missing credential with an RFC 9457 problem", async () => {
    const res = await call(TILE, env());
    expect(res.status).toBe(401);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("WWW-Authenticate")).toContain("Nyuchi-Origin");
    expect(await res.json()).toEqual({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail: "A valid credential is required.",
    });
  });

  it("gives the same answer for every kind of failure", async () => {
    const now = Math.floor(Date.now() / 1000);
    const cases: Array<Promise<RequestInit> | RequestInit | undefined> = [
      undefined,
      signed(TILE, { t: now - 120 }), // expired
      signed(TILE, { t: now + 120 }), // from the future
      signed(TILE, { secret: OTHER_SECRET }), // wrong key
      signed(TILE, { kid: "k9" }), // unknown key id
      { headers: { "X-Nyuchi-Origin": "garbage" } },
      { headers: { "X-Nyuchi-Origin": "kid=k1,t=1,n=short,v1=00" } },
    ];
    const bodies = new Set<string>();
    for (const init of cases) {
      const res = await call(TILE, env(), await init);
      expect(res.status).toBe(401);
      expect(res.headers.get("X-Origin-Auth")).toBeNull();
      bodies.add(await res.text());
    }
    expect(bodies.size).toBe(1);
  });

  it("rejects a tampered path, method and timestamp", async () => {
    const init = await signed(TILE);
    expect((await call("/v1/tiles.json", env(), init)).status).toBe(401);

    // A signature for GET does not authorise HEAD.
    const head = await call(TILE, env(), {
      method: "HEAD",
      headers: (await signed(TILE)).headers,
    });
    expect(head.status).toBe(401);

    const h = (await sign("GET", TILE)).replace(/t=\d+/, "t=1");
    const res = await call(TILE, env(), { headers: { "X-Nyuchi-Origin": h } });
    expect(res.status).toBe(401);
  });

  it("rejects a flipped signature bit", async () => {
    const h = await sign("GET", TILE);
    const flipped = h.replace(
      /v1=(.)/,
      (_, d: string) => `v1=${d === "0" ? "1" : "0"}`,
    );
    const res = await call(TILE, env(), {
      headers: { "X-Nyuchi-Origin": flipped },
    });
    expect(res.status).toBe(401);
  });

  it("accepts HEAD when the signature is for HEAD", async () => {
    const res = await call(TILE, env(), await signed(TILE, {}, {}, "HEAD"));
    expect(res.status).toBe(200);
  });

  it("rejects an expired credential and accepts one just inside the window", async () => {
    const now = Math.floor(Date.now() / 1000);
    expect(
      (await call(TILE, env(), await signed(TILE, { t: now - 61 }))).status,
    ).toBe(401);
    expect(
      (await call(TILE, env(), await signed(TILE, { t: now - 50 }))).status,
    ).toBe(200);
    expect(
      (await call(TILE, env(), await signed(TILE, { t: now + 50 }))).status,
    ).toBe(200);
  });

  it("honours ORIGIN_AUTH_WINDOW_SECONDS within its bounds", async () => {
    const now = Math.floor(Date.now() / 1000);
    const wide = env({ ORIGIN_AUTH_WINDOW_SECONDS: "600" }); // capped at 300
    expect(
      (await call(TILE, wide, await signed(TILE, { t: now - 250 }))).status,
    ).toBe(200);
    expect(
      (await call(TILE, wide, await signed(TILE, { t: now - 350 }))).status,
    ).toBe(401);
    const narrow = env({ ORIGIN_AUTH_WINDOW_SECONDS: "1" }); // raised to 5
    expect(
      (await call(TILE, narrow, await signed(TILE, { t: now - 3 }))).status,
    ).toBe(200);
  });

  it("rejects a replayed nonce (best effort, per isolate)", async () => {
    const init = await signed(TILE, { n: "REPLAYNONCE0000000000" });
    expect((await call(TILE, env(), init)).status).toBe(200);
    expect((await call(TILE, env(), init)).status).toBe(401);
    // A fresh nonce for the same request is fine.
    expect((await call(TILE, env(), await signed(TILE))).status).toBe(200);
  });

  it("does not remember the nonce of a request that failed verification", async () => {
    const n = "NONCEFORBADSIG000000";
    const bad = await signed(TILE, { n, secret: OTHER_SECRET });
    expect((await call(TILE, env(), bad)).status).toBe(401);
    const good = await signed(TILE, { n });
    expect((await call(TILE, env(), good)).status).toBe(200);
  });

  it("verifies against any key in the ring, so a rotation has no gap", async () => {
    const both = env({ ORIGIN_AUTH_KEYS: `k1:${SECRET},k2:${OTHER_SECRET}` });
    expect((await call(TILE, both, await signed(TILE))).status).toBe(200);
    expect(
      (
        await call(
          TILE,
          both,
          await signed(TILE, { kid: "k2", secret: OTHER_SECRET }),
        )
      ).status,
    ).toBe(200);
    // The old key removed from the ring: its signatures stop working.
    const onlyNew = env({ ORIGIN_AUTH_KEYS: `k2:${OTHER_SECRET}` });
    expect((await call(TILE, onlyNew, await signed(TILE))).status).toBe(401);
  });

  it("ignores weak or malformed entries in the key ring", async () => {
    const weak = env({ ORIGIN_AUTH_KEYS: "k1:short,,nocolon,:x,k2" });
    expect(
      (await call(TILE, weak, await signed(TILE, { secret: "short" }))).status,
    ).toBe(401);
  });

  it("fails closed when no keys are configured", async () => {
    const res = await call(
      TILE,
      env({ ORIGIN_AUTH_KEYS: undefined }),
      await signed(TILE),
    );
    expect(res.status).toBe(401);
  });

  it("treats an unrecognised mode as enforce", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call(TILE, env({ ORIGIN_AUTH: "enforced" }));
    expect(res.status).toBe(401);
  });

  it("guards every /v1 route, including unknown ones", async () => {
    for (const path of [
      "/v1/tiles.json",
      "/v1/styles/light.json",
      "/v1/fonts/Noto%20Sans%20Regular/0-255.pbf",
      "/v1/sprites/light.json",
      "/v1/sprites/light@2x.png",
      "/v1/sources/default/tiles.json",
      "/v1/nothing-here",
    ]) {
      const res = await call(path, env());
      expect(res.status, path).toBe(401);
    }
    expect(
      (
        await call(
          "/v1/sprites/light@2x.png",
          env(),
          await signed("/v1/sprites/light@2x.png"),
        )
      ).status,
    ).toBe(200);
  });

  it("keeps the public routes public", async () => {
    const e = env({
      ASSETS: {
        fetch: async () => new Response("x", { headers: { ETag: '"a"' } }),
      } as unknown as Fetcher,
    });
    for (const path of [
      "/health",
      "/",
      "/openapi.json",
      "/assets/app.js",
      "/favicon.svg",
      "/robots.txt",
    ]) {
      const res = await call(path, e);
      expect(res.status, path).not.toBe(401);
    }
    expect((await call("/health", e)).status).toBe(200);
    expect((await call("/openapi.json", e)).status).toBe(200);
  });

  it("answers CORS preflight as before, with no data behind it", async () => {
    const res = await call(TILE, env(), {
      method: "OPTIONS",
      headers: {
        Origin: "https://weather.mukoko.com",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://weather.mukoko.com",
    );
  });

  it("still sets CORS and Vary on a 401 and on a served tile", async () => {
    const origin = "https://weather.mukoko.com";
    const denied = await call(TILE, env(), { headers: { Origin: origin } });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("Vary")).toContain("Origin");
    const ok = await call(
      TILE,
      env(),
      await signed(TILE, {}, { Origin: origin }),
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  });

  it("still applies the rate limiter to authenticated requests", async () => {
    const limited = env({
      RATE_LIMITER: { limit: async () => ({ success: false }) },
    });
    const res = await call(
      "/v1/tiles.json",
      limited,
      await signed("/v1/tiles.json", {}, { "CF-Connecting-IP": "203.0.113.7" }),
    );
    expect(res.status).toBe(429);
  });

  it("rejects before the rate limiter, so unsigned calls spend no budget", async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const e = env({ RATE_LIMITER: { limit } });
    const ip = { "CF-Connecting-IP": "203.0.113.7" };
    await call("/v1/tiles.json", e, { headers: ip });
    expect(limit).not.toHaveBeenCalled();
    await call("/v1/tiles.json", e, await signed("/v1/tiles.json", {}, ip));
    expect(limit).toHaveBeenCalledTimes(1);
  });
});

describe("edge cache cannot bypass the credential", () => {
  it("never serves a cached tile to an unauthenticated request", async () => {
    const bucket = bucketWithTile();
    const e = makeEnv(bucket, {
      ORIGIN_AUTH: "enforce",
      ORIGIN_AUTH_KEYS: KEYS,
      EDGE_CACHE: "on",
      TILES_VERSION: "v-auth-1",
    });
    const { ctx, settle } = makeCtx();

    const first = await call(TILE, e, await signed(TILE), ctx);
    expect(first.status).toBe(200);
    await first.arrayBuffer();
    await settle();

    // Proof the tile is in the cache: a signed repeat is served without R2.
    const reads = bucket.gets.length;
    const warm = await call(TILE, e, await signed(TILE), ctx);
    expect(warm.status).toBe(200);
    await warm.arrayBuffer();
    expect(bucket.gets.length).toBe(reads);

    // Now every kind of caller without a valid credential is refused.
    const attempts: RequestInit[] = [
      {},
      { headers: { "If-None-Match": '"arch1:0/0/0"' } },
      { headers: { Origin: "https://weather.mukoko.com" } },
      {
        headers: {
          "X-Nyuchi-Origin":
            "kid=k1,t=1,n=aaaaaaaaaaaaaaaaaaaa,v1=" + "0".repeat(64),
        },
      },
      await signed(TILE, { secret: OTHER_SECRET }),
      await signed(TILE, { t: Math.floor(Date.now() / 1000) - 600 }),
    ];
    for (const init of attempts) {
      const res = await call(TILE, e, init, ctx);
      expect(res.status).toBe(401);
      expect(res.headers.get("Content-Encoding")).toBeNull();
      expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    }
    // A query string does not move the request onto another cache key.
    expect((await call(`${TILE}?r=1`, e, {}, ctx)).status).toBe(401);
  });

  it("does not cache a 401 for a later authorised caller", async () => {
    const e = makeEnv(bucketWithTile(), {
      ORIGIN_AUTH: "enforce",
      ORIGIN_AUTH_KEYS: KEYS,
      EDGE_CACHE: "on",
      TILES_VERSION: "v-auth-2",
    });
    const { ctx, settle } = makeCtx();
    expect((await call(TILE, e, {}, ctx)).status).toBe(401);
    await settle();
    const ok = await call(TILE, e, await signed(TILE), ctx);
    expect(ok.status).toBe(200);
  });

  it("log mode serves an unsigned request from cache and still reports it", async () => {
    const e = makeEnv(bucketWithTile(), {
      ORIGIN_AUTH: "log",
      ORIGIN_AUTH_KEYS: KEYS,
      EDGE_CACHE: "on",
      TILES_VERSION: "v-auth-3",
    });
    const { ctx, settle } = makeCtx();
    await (await call(TILE, e, await signed(TILE), ctx)).arrayBuffer();
    await settle();
    const res = await call(TILE, e, {}, ctx);
    expect(res.status).toBe(200);
    // The cached object never carries the per-request header.
    expect(res.headers.get("X-Origin-Auth")).toBe("missing");
    const again = await call(TILE, e, await signed(TILE), ctx);
    expect(again.headers.get("X-Origin-Auth")).toBe("ok");
  });
});

describe("verifyOrigin", () => {
  it("is a pure function of env, request and the clock", async () => {
    const env = makeEnv(bucketWithTile(), { ORIGIN_AUTH_KEYS: KEYS });
    const url = `https://maps.test${TILE}`;
    const h = await sign("GET", TILE, { t: 1_700_000_000 });
    const req = () => new Request(url, { headers: { "X-Nyuchi-Origin": h } });
    expect((await verifyOrigin(env, req(), 1_700_000_030)).result).toBe("ok");
    resetNonces();
    expect(await verifyOrigin(env, req(), 1_700_000_090)).toEqual({
      result: "invalid",
      reason: "expired",
    });
  });
});
