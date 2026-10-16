import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { responseInit } from "../src/http";
import { buildPmtiles, gzip } from "./helpers";

// These run the real Worker entry (src/index.ts) in workerd with miniflare's
// simulated R2, so the runtime's own response pipeline is in play. The other
// suites call app.fetch directly, which never reaches it.

const TILE = new TextEncoder().encode("plain-mvt-tile-bytes");
const KEY = "tiles/nyuchi-maps.pmtiles";
const ORIGIN = "https://weather.mukoko.com";

describe("responseInit", () => {
  it("sets encodeBody manual only when a Content-Encoding is present", () => {
    const gz = responseInit(200, new Headers({ "Content-Encoding": "gzip" }));
    expect(gz.encodeBody).toBe("manual");
    const plain = responseInit(200, new Headers({ "Content-Type": "x/y" }));
    expect(plain.encodeBody).toBeUndefined();
  });
});

describe("gzip tiles through the real runtime", () => {
  async function seed() {
    const data = await gzip(TILE);
    await env.MAPS_BUCKET.put(
      KEY,
      buildPmtiles([{ z: 0, x: 0, y: 0, data }], { tileCompression: 2 }),
    );
  }

  async function fetchTile(path: string, headers: HeadersInit = {}) {
    return SELF.fetch(`https://maps.nyuchi.com${path}`, { headers });
  }

  it("is gzipped exactly once: one decode yields the tile, not gzip again", async () => {
    await seed();
    const res = await fetchTile("/v1/tiles/0/0/0.mvt", {
      "Accept-Encoding": "gzip",
    });
    expect(res.status).toBe(200);
    const body = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(body)).toBe("plain-mvt-tile-bytes");
  });

  it("stays single-gzip with a CORS rebuild and on an edge-cache hit", async () => {
    await seed();
    const path = "/v1/tiles/0/0/0.mvt";
    const headers = { Origin: ORIGIN, "Accept-Encoding": "gzip" };
    const miss = await fetchTile(path, headers);
    expect(miss.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(await miss.text()).toBe("plain-mvt-tile-bytes");

    // Retire the object: only the edge cache can answer now. The Cache API
    // write is asynchronous, so allow a few tries.
    await env.MAPS_BUCKET.delete(KEY);
    let hit: Response | undefined;
    for (let i = 0; i < 20; i++) {
      const res = await fetchTile(path, headers);
      if (res.status === 200) {
        hit = res;
        break;
      }
      await res.arrayBuffer();
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(hit, "edge cache never answered").toBeDefined();
    expect(hit!.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(await hit!.text()).toBe("plain-mvt-tile-bytes");
  });
});
