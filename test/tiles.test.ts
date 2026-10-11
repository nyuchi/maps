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
    const res = await call("/v1/tiles/2/1/1.mvt", env, {
      headers: { "If-None-Match": etag },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("ETag")).toBe(etag);
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
  });

  it("answers 404 when the extension does not match the archive", async () => {
    const { bucket } = await archiveBucket();
    const res = await call("/v1/tiles/0/0/0.png", makeEnv(bucket));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "format_mismatch" });
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

  it("never reads R2 for dot-segment paths (the URL is normalised away)", async () => {
    const { bucket } = await archiveBucket();
    const res = await call("/v1/tiles/0/%2e%2e/0.mvt", makeEnv(bucket));
    expect([400, 404]).toContain(res.status);
    expect(bucket.gets).toHaveLength(0);
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

  it("serves a repeat request from the edge cache", async () => {
    const { bucket } = await archiveBucket();
    const env = makeEnv(bucket, { EDGE_CACHE: "on" });
    const { ctx, settle } = makeCtx();
    const path = "/v1/tiles/0/0/0.mvt?edge-cache-test=1";
    const first = await call(path, env, undefined, ctx);
    expect(first.status).toBe(200);
    await first.arrayBuffer();
    await settle();
    const readsAfterFirst = bucket.gets.length;
    const second = await call(path, env, undefined, ctx);
    expect(second.status).toBe(200);
    expect(bucket.gets.length).toBe(readsAfterFirst);
  });
});
