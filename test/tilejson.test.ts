import { describe, expect, it } from "vitest";
import { CREDITS } from "../src/credits";
import { StubBucket, buildPmtiles, call, makeEnv } from "./helpers";

function bucketWithArchive() {
  return new StubBucket().put(
    "tiles/test.pmtiles",
    buildPmtiles([{ z: 0, x: 0, y: 0, data: new Uint8Array([1, 2, 3]) }], {
      maxZoom: 14,
      metadata: {
        vector_layers: [{ id: "roads", fields: { kind: "String" } }],
      },
    }),
    "arch1",
  );
}

describe("GET /v1/tiles.json", () => {
  it("returns TileJSON built from the archive header", async () => {
    const res = await call("/v1/tiles.json", makeEnv(bucketWithArchive()));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=86400");
    const tj = (await res.json()) as Record<string, unknown>;
    expect(tj.tilejson).toBe("3.0.0");
    expect(tj.scheme).toBe("xyz");
    expect(tj.tiles).toEqual([
      "https://maps.nyuchi.com/v1/tiles/{z}/{x}/{y}.mvt",
    ]);
    expect(tj.minzoom).toBe(0);
    expect(tj.maxzoom).toBe(14);
    expect(tj.bounds).toEqual([25.2, -22.45, 33.1, -15.55]);
    expect(tj.vector_layers).toEqual([
      { id: "roads", fields: { kind: "String" } },
    ]);
  });

  it("carries every credit exactly once", async () => {
    const res = await call("/v1/tiles.json", makeEnv(bucketWithArchive()));
    const { attribution } = (await res.json()) as { attribution: string };
    for (const c of CREDITS) {
      expect(attribution.split(c.text).length - 1, c.text).toBe(1);
    }
  });

  it("uses PUBLIC_BASE_URL, ignoring a trailing slash", async () => {
    const env = makeEnv(bucketWithArchive(), {
      PUBLIC_BASE_URL: "https://maps.example.test/",
    });
    const tj = (await (await call("/v1/tiles.json", env)).json()) as {
      tiles: string[];
    };
    expect(tj.tiles[0]).toBe(
      "https://maps.example.test/v1/tiles/{z}/{x}/{y}.mvt",
    );
  });

  it("falls back to the request origin when PUBLIC_BASE_URL is unset or invalid", async () => {
    for (const bad of [undefined, "", "not a url", "http://evil.test"]) {
      const env = makeEnv(bucketWithArchive(), { PUBLIC_BASE_URL: bad });
      const tj = (await (await call("/v1/tiles.json", env)).json()) as {
        tiles: string[];
      };
      expect(tj.tiles[0], String(bad)).toBe(
        "https://maps.test/v1/tiles/{z}/{x}/{y}.mvt",
      );
    }
  });

  it("answers 304 for a matching ETag", async () => {
    const env = makeEnv(bucketWithArchive());
    const first = await call("/v1/tiles.json", env);
    const etag = first.headers.get("ETag")!;
    expect(etag).toMatch(/^"[0-9a-f]{24}"$/);
    const res = await call("/v1/tiles.json", env, {
      headers: { "If-None-Match": etag },
    });
    expect(res.status).toBe(304);
  });

  it("answers 503 when the archive is missing", async () => {
    const res = await call("/v1/tiles.json", makeEnv(new StubBucket()));
    expect(res.status).toBe(503);
  });
});

describe("TileJSON vector_layers fallback", () => {
  it("is an empty list when the archive metadata has none", async () => {
    const bucket = new StubBucket().put(
      "tiles/test.pmtiles",
      buildPmtiles([{ z: 0, x: 0, y: 0, data: new Uint8Array([1]) }]),
    );
    const tj = (await (
      await call("/v1/tiles.json", makeEnv(bucket))
    ).json()) as {
      vector_layers: unknown[];
    };
    expect(tj.vector_layers).toEqual([]);
  });
});
