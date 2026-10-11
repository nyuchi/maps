import { describe, expect, it } from "vitest";
import { StubBucket, call, makeEnv } from "./helpers";

const EXPECTED_PATHS = [
  "/health",
  "/openapi.json",
  "/v1/fonts/{stack}/{range}.pbf",
  "/v1/sprites/{name}.{ext}",
  "/v1/styles/{name}.json",
  "/v1/tiles.json",
  "/v1/tiles/{z}/{x}/{y}.{ext}",
];

describe("service documents", () => {
  it("GET /health", async () => {
    const res = await call("/health", makeEnv(new StubBucket()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "nyuchi-maps" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("GET /openapi.json documents every route", async () => {
    const res = await call("/openapi.json", makeEnv(new StubBucket()));
    expect(res.status).toBe(200);
    const spec = (await res.json()) as {
      openapi: string;
      paths: Record<string, Record<string, { operationId: string }>>;
    };
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths).sort()).toEqual(EXPECTED_PATHS);
    const ids = Object.values(spec.paths).map((p) => p.get?.operationId);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("answers unknown paths with a JSON 404", async () => {
    const res = await call("/nope", makeEnv(new StubBucket()));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
