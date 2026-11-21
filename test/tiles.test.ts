import { describe, expect, it } from "vitest";
import {
  StubBucket,
  buildPmtiles,
  call,
  gzip,
  makeCtx,
  makeEnv,
} from "./helpers";

const MVT = new TextEncoder().encode("fake-mvt-tile-bytes");

async function archiveBucket(
  opts: { compress?: boolean; tileType?: number } = {},
) {
  const compress = opts.compress ?? true;
  const data = compress ? await gzip(MVT) : MVT;
  const bucket = new StubBucket().put(
    "tiles/test.pmtiles",
    buildPmtiles(
      [
        { z: 0, x: 0, y: 0, data },
        { z: 2, x: 1, y: 1, data },
      ],
      {
        tileCompression: compress ? 2 : 1,
        tileType: opts.tileType ?? 1,
        maxZoom: 3,
      },
    ),
    "arch1",
  );
  return { bucket, data };
}

describe("GET /v1/tiles/{z}/{x}/{y}.mvt", () => {
  it("serves a tile with the compressed bytes passed through", async () => {
    const { bucket, data } = await archiveBucket();
    const res = await call("/v1/tiles/2/1/1.mvt", makeEnv(bucket));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.mapbox-vector-tile",
    );
    expect(res.headers.get("Content-Encoding")).toBe("gzip");
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=2592000");
    expect(res.headers.get("ETag")).toBe('"arch1:2/1/1"');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(data);
  });

  it("serves uncompressed archives without Content-Encoding", async () => {
    const { bucket, data } = await archiveBucket({ compress: false });
    const res = await call("/v1/tiles/0/0/0.mvt", makeEnv(bucket));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Encoding")).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(data);
  });

  it("only ever reads the archive with range requests", async () => {
    const { bucket } = await archiveBucket();
    await call("/v1/tiles/2/1/1.mvt", makeEnv(bucket));
    const archiveReads = bucket.gets.filter((g) => g.key.endsWith(".pmtiles"));
    expect(archiveReads.length).toBeGreaterThan(1);
    expect(archiveReads.every((g) => g.range !== undefined)).toBe(true);
  });

  it("answers 304 when If-None-Match matches", async () => {
    const { bucket } = await archiveBucket();
    const env = makeEnv(bucket);
    const first = await call("/v1/tiles/2/1/1.mvt", env);
    const etag = first.headers.get("ETag")!;
    const reads = bucket.gets.length;
    const res = await call("/v1/tiles/2/1/1.mvt", env, {
      headers: { "If-None-Match": etag },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("ETag")).toBe(etag);
    // Answered from the cached header: no directory or tile read from R2.
    expect(bucket.gets.length).toBe(reads);
  });

  it("answers 204 for a tile the archive does not hold", async () => {
    const { bucket } = await archiveBucket();
    const res = await call("/v1/tiles/2/3/3.mvt", makeEnv(bucket));
    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toContain("max-age=3600");
    expect(await res.text()).toBe("");
  });

  it("answers 404 outside the archive's zoom range", async () => {
    const { bucket } = await archiveBucket();
    const res = await call("/v1/tiles/5/0/0.mvt", makeEnv(bucket));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "zoom_out_of_range" });
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=300, s-maxage=3600",
    );
  });

  it("answers 404 when the extension does not match the archive", async () => {
    const { bucket } = await archiveBucket();
    const res = await call("/v1/tiles/0/0/0.png", makeEnv(bucket));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "format_mismatch" });
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=300, s-maxage=3600",
    );
  });

  it.each([
    "/v1/tiles/23/0/0.mvt",
    "/v1/tiles/1/2/0.mvt",
    "/v1/tiles/x/0/0.mvt",
    "/v1/tiles/01/0/0.mvt",
    "/v1/tiles/0/0/0.exe",
    "/v1/tiles/0/0/0",
    "/v1/tiles/0/0/..%2F..%2F0.mvt",
  ])("rejects %s with 400 and never reads R2", async (path) => {
    const { bucket } = await archiveBucket();
    const res = await call(path, makeEnv(bucket));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_tile_coordinates" });
    expect(bucket.gets).toHaveLength(0);
  });

  it("404s a dot-segment path (normalised away by the URL) with no R2 read", async () => {
    const { bucket } = await archiveBucket();
    const res = await call("/v1/tiles/0/%2e%2e/0.mvt", makeEnv(bucket));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(bucket.gets).toHaveLength(0);
  });

  it.each(["%2f", "%5c", "%2e%2e%2f", "..%5c"])(
    "400s an encoded separator %s in a tile file with no R2 read",
    async (piece) => {
      const { bucket } = await archiveBucket();
      const res = await call(`/v1/tiles/0/0/${piece}0.mvt`, makeEnv(bucket));
      expect(res.status).toBe(400);
      expect(bucket.gets).toHaveLength(0);
    },
  );

  it("recovers after the archive was missing: 503, then 200 once uploaded", async () => {
    const bucket = new StubBucket();
    const env = makeEnv(bucket);
    const missing = await call("/v1/tiles/0/0/0.mvt", env);
    expect(missing.status).toBe(503);
    const { bucket: full } = await archiveBucket();
    bucket.put(
      "tiles/test.pmtiles",
      full.objects.get("tiles/test.pmtiles")!.data,
      "arch1",
    );
    const ok = await call("/v1/tiles/0/0/0.mvt", env);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("ETag")).toBe('"arch1:0/0/0"');
  });

  it("recovers after a transient R2 error: 500, then 200", async () => {
    const { bucket } = await archiveBucket();
    const env = makeEnv(bucket);
    bucket.failNext = new Error("R2 hiccup");
    expect((await call("/v1/tiles/0/0/0.mvt", env)).status).toBe(500);
    expect((await call("/v1/tiles/0/0/0.mvt", env)).status).toBe(200);
  });

  it("answers 503 when the archive is not in the bucket", async () => {
    const res = await call("/v1/tiles/0/0/0.mvt", makeEnv(new StubBucket()));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "archive_unavailable" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers 500 for tile compression it cannot pass through", async () => {
    const bucket = new StubBucket().put(
      "tiles/test.pmtiles",
      buildPmtiles([{ z: 0, x: 0, y: 0, data: MVT }], { tileCompression: 4 }),
    );
    const res = await call("/v1/tiles/0/0/0.mvt", makeEnv(bucket));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "unsupported_tile_compression" });
  });

  it("serves a repeat request from the edge cache, whatever the query string", async () => {
    const { bucket } = await archiveBucket();
    const env = makeEnv(bucket, {
      EDGE_CACHE: "on",
      TILES_VERSION: "v-edge-1",
    });
    const { ctx, settle } = makeCtx();
    const path = "/v1/tiles/2/1/1.mvt";
    const first = await call(path, env, undefined, ctx);
    expect(first.status).toBe(200);
    await first.arrayBuffer();
    await settle();
    const readsAfterFirst = bucket.gets.length;
    const second = await call(
      `${path}?r=${Math.random()}`,
      env,
      undefined,
      ctx,
    );
    expect(second.status).toBe(200);
    expect(bucket.gets.length).toBe(readsAfterFirst);
  });

  it("keys the edge cache by TILES_VERSION: a new version misses", async () => {
    const { bucket } = await archiveBucket();
    const { ctx, settle } = makeCtx();
    const path = "/v1/tiles/2/1/1.mvt";
    const a = makeEnv(bucket, { EDGE_CACHE: "on", TILES_VERSION: "v-edge-2" });
    await (await call(path, a, undefined, ctx)).arrayBuffer();
    await settle();
    const reads = bucket.gets.length;
    const b = makeEnv(bucket, { EDGE_CACHE: "on", TILES_VERSION: "v-edge-3" });
    const res = await call(path, b, undefined, ctx);
    expect(res.status).toBe(200);
    expect(bucket.gets.length).toBeGreaterThan(reads);
  });
});
