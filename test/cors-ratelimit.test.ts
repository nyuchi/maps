import { describe, expect, it } from "vitest";
import { isOriginAllowed, parseAllowedOrigins } from "../src/cors";
import { StubBucket, buildPmtiles, call, makeEnv } from "./helpers";

const bucket = () =>
  new StubBucket().put(
    "tiles/test.pmtiles",
    buildPmtiles([{ z: 0, x: 0, y: 0, data: new Uint8Array([1]) }]),
  );

describe("isOriginAllowed", () => {
  const allowed = parseAllowedOrigins(
    " https://weather.mukoko.com/ , http://localhost:3000,https://*.nyuchi.com ,",
  );

  it("parses the list", () => {
    expect(allowed).toEqual([
      "https://weather.mukoko.com",
      "http://localhost:3000",
      "https://*.nyuchi.com",
    ]);
  });

  it("matches exactly and by subdomain wildcard", () => {
    expect(isOriginAllowed("https://weather.mukoko.com", allowed)).toBe(true);
    expect(isOriginAllowed("https://console.nyuchi.com", allowed)).toBe(true);
    expect(isOriginAllowed("https://a.b.nyuchi.com", allowed)).toBe(true);
  });

  it.each([
    "https://nyuchi.com", // apex is not a subdomain
    "https://evilnyuchi.com",
    "https://nyuchi.com.evil.test",
    "http://console.nyuchi.com", // wrong scheme
    "https://weather.mukoko.com.evil.test",
    "http://localhost:3001",
    "null",
  ])("rejects %s", (origin) => {
    expect(isOriginAllowed(origin, allowed)).toBe(false);
  });

  it("allows nothing when the var is empty", () => {
    expect(isOriginAllowed("https://weather.mukoko.com", [])).toBe(false);
  });
});

describe("CORS headers", () => {
  it("echoes an allowed origin", async () => {
    const res = await call("/health", makeEnv(bucket()), {
      headers: { Origin: "https://weather.mukoko.com" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://weather.mukoko.com",
    );
    expect(res.headers.get("Vary")).toContain("Origin");
  });

  it("omits the header for other origins and for no origin", async () => {
    const other = await call("/health", makeEnv(bucket()), {
      headers: { Origin: "https://evil.test" },
    });
    expect(other.status).toBe(200);
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const none = await call("/health", makeEnv(bucket()));
    expect(none.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("answers preflight 204 for allowed and 403 for others", async () => {
    const ok = await call("/v1/tiles/0/0/0.mvt", makeEnv(bucket()), {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    const bad = await call("/v1/tiles/0/0/0.mvt", makeEnv(bucket()), {
      method: "OPTIONS",
      headers: { Origin: "https://evil.test" },
    });
    expect(bad.status).toBe(403);
  });

  it("also covers error responses", async () => {
    const res = await call("/v1/tiles/99/0/0.mvt", makeEnv(bucket()), {
      headers: { Origin: "https://weather.mukoko.com" },
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://weather.mukoko.com",
    );
  });
});

describe("rate limiting", () => {
  it("answers 429 with Retry-After when the limiter refuses", async () => {
    const env = makeEnv(bucket(), {
      RATE_LIMITER: { limit: async () => ({ success: false }) },
    });
    const res = await call("/v1/tiles/0/0/0.mvt", env);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(await res.json()).toEqual({ error: "rate_limited" });
  });

  it("keys the limit by client IP", async () => {
    const keys: string[] = [];
    const env = makeEnv(bucket(), {
      RATE_LIMITER: {
        limit: async ({ key }) => (keys.push(key), { success: true }),
      },
    });
    await call("/v1/tiles/0/0/0.mvt", env, {
      headers: { "CF-Connecting-IP": "203.0.113.7" },
    });
    expect(keys).toEqual(["203.0.113.7"]);
  });

  it("never limits /health", async () => {
    const env = makeEnv(bucket(), {
      RATE_LIMITER: { limit: async () => ({ success: false }) },
    });
    expect((await call("/health", env)).status).toBe(200);
  });

  it("fails open when the limiter errors or is absent", async () => {
    const broken = makeEnv(bucket(), {
      RATE_LIMITER: {
        limit: async () => {
          throw new Error("boom");
        },
      },
    });
    expect((await call("/v1/tiles/0/0/0.mvt", broken)).status).toBe(200);
    const absent = makeEnv(bucket(), { RATE_LIMITER: undefined });
    expect((await call("/v1/tiles/0/0/0.mvt", absent)).status).toBe(200);
  });
});
