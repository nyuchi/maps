import { describe, expect, it } from "vitest";
import { DEFAULT_SOURCE_ID, SOURCES } from "../src/sources";
import {
  StubBucket,
  buildPmtiles,
  call,
  createApp,
  makeEnv,
  type SourceDef,
} from "./helpers";

const BASE_TILE = new Uint8Array([1, 1, 1]);
const OVERLAY_TILE = new Uint8Array([9, 9, 9, 9]);

// A second source exists only inside this test: no overlay is built or
// registered in the shipped code.
const overlay: SourceDef = {
  id: "overlay",
  defaultKey: "tiles/overlay.pmtiles",
  creditIds: ["osm"],
};
const worker = createApp({ ...SOURCES, overlay });

function bucket() {
  return new StubBucket()
    .put(
      "tiles/test.pmtiles",
      buildPmtiles([{ z: 0, x: 0, y: 0, data: BASE_TILE }]),
      "base1",
    )
    .put(
      "tiles/overlay.pmtiles",
      buildPmtiles([{ z: 0, x: 0, y: 0, data: OVERLAY_TILE }], { maxZoom: 6 }),
      "over1",
    );
}

const get = (path: string, b = bucket()) =>
  call(path, makeEnv(b), undefined, undefined, worker);

describe("tile sources", () => {
  it("ships exactly one source: the base map", () => {
    expect(Object.keys(SOURCES)).toEqual([DEFAULT_SOURCE_ID]);
  });

  it("serves each source from its own archive", async () => {
    const b = bucket();
    const base = await get("/v1/tiles/0/0/0.mvt", b);
    const over = await get("/v1/sources/overlay/tiles/0/0/0.mvt", b);
    expect(new Uint8Array(await base.arrayBuffer())).toEqual(BASE_TILE);
    expect(new Uint8Array(await over.arrayBuffer())).toEqual(OVERLAY_TILE);
    expect(base.headers.get("ETag")).toContain("base1");
    expect(over.headers.get("ETag")).toContain("over1");
  });

  it("gives each source its own TileJSON, URLs and credits", async () => {
    const b = bucket();
    const base = (await (await get("/v1/tiles.json", b)).json()) as any;
    const over = (await (
      await get("/v1/sources/overlay/tiles.json", b)
    ).json()) as any;
    expect(base.tiles[0]).toBe(
      "https://maps.nyuchi.com/v1/tiles/{z}/{x}/{y}.mvt",
    );
    expect(over.tiles[0]).toBe(
      "https://maps.nyuchi.com/v1/sources/overlay/tiles/{z}/{x}/{y}.mvt",
    );
    expect(over.maxzoom).toBe(6);
    expect(base.attribution).toContain("Nyuchi Maps");
    expect(over.attribution).toContain("OpenStreetMap contributors");
    expect(over.attribution).not.toContain("Nyuchi Maps</a>");
  });

  it("also reaches the base map by id", async () => {
    const res = await get("/v1/sources/basemap/tiles/0/0/0.mvt");
    expect(res.status).toBe(200);
  });

  it("404s unknown, malformed and inherited-property source ids", async () => {
    for (const id of ["nope", "Overlay", "constructor", "__proto__"]) {
      const a = await get(`/v1/sources/${id}/tiles.json`);
      const t = await get(`/v1/sources/${id}/tiles/0/0/0.mvt`);
      expect([a.status, t.status], id).toEqual([404, 404]);
    }
  });

  it("validates tile coordinates for every source", async () => {
    const b = bucket();
    const res = await get("/v1/sources/overlay/tiles/99/0/0.mvt", b);
    expect(res.status).toBe(400);
    expect(b.gets).toHaveLength(0);
  });
});
