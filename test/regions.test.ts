import { env as workerEnv } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetRecentDemand } from "../src/regions/demand";
import { forgetUpstreamReaders } from "../src/regions/fallback";
import { cellBbox, cellId, cellOf, parseCell } from "../src/regions/grid";
import { parseManifest, loadManifest } from "../src/regions/manifest";
import type { Env } from "../src/types";
import {
  BASE,
  StubBucket,
  buildPmtiles,
  call,
  gzip,
  makeCtx,
  makeEnv,
} from "./helpers";

const ORIGIN = {
  Origin: "https://weather.mukoko.com",
  "CF-Connecting-IP": "198.51.100.7",
};
const TOKEN = "test-builder-token";
const MVT = new TextEncoder().encode("fake-mvt-tile-bytes");

/** The tile of zoom z that holds a point. */
function tileAt(z: number, lon: number, lat: number) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n);
  return { z, x, y };
}

const path = (t: { z: number; x: number; y: number }) =>
  `/v1/tiles/${t.z}/${t.x}/${t.y}.mvt`;

// Harare (inside the primary archive's cell) and Singapore (not stored).
const HARARE = tileAt(8, 31.05, -17.83);
const SG = tileAt(8, 103.8, 1.35);
const SG_CELL = cellId(cellOf(SG.z, SG.x, SG.y));
const HARARE_CELL = cellId(cellOf(HARARE.z, HARARE.x, HARARE.y));
// Two more tiles of the Singapore cell, for the distinct-tile threshold.
const SG2 = { z: 8, x: SG.x - 1, y: SG.y - 1 };
const SG3 = { z: 8, x: SG.x + 1, y: SG.y - 2 };

let ledgerCounter = 0;

function renv(overrides: Partial<Env> = {}): Env {
  return makeEnv(new StubBucket(), {
    MAPS_BUCKET: workerEnv.MAPS_BUCKET,
    DEMAND: workerEnv.DEMAND,
    ONDEMAND_REGIONS: "on",
    MANIFEST_TTL_SECONDS: "0",
    DEMAND_MIN_TILES: "1",
    LEDGER_NAME: `test-ledger-${(ledgerCounter += 1)}-${crypto.randomUUID()}`,
    BUILDER_TOKEN: TOKEN,
    ...overrides,
  });
}

function ledger(env: Env) {
  return env.DEMAND!.get(env.DEMAND!.idFromName(env.LEDGER_NAME!));
}

async function wipeBucket() {
  const listed = await workerEnv.MAPS_BUCKET.list();
  await Promise.all(
    listed.objects.map((o) => workerEnv.MAPS_BUCKET.delete(o.key)),
  );
}

async function putPrimary() {
  const data = await gzip(MVT);
  await workerEnv.MAPS_BUCKET.put(
    "tiles/test.pmtiles",
    buildPmtiles(
      [
        { z: 6, x: 37, y: 35, data },
        { z: HARARE.z, x: HARARE.x, y: HARARE.y, data },
      ],
      { tileCompression: 2, maxZoom: 14 },
    ),
  );
  return data;
}

async function putManifest(extra: Record<string, unknown> = {}, version = 1) {
  await workerEnv.MAPS_BUCKET.put(
    "tiles/regions.json",
    JSON.stringify({
      version,
      grid_zoom: 6,
      updated: "2026-11-28T00:00:00Z",
      primary: { cells: [HARARE_CELL] },
      regions: [],
      ...extra,
    }),
  );
}

async function putRegion(key: string, bounds = cellBbox(parseCell(SG_CELL)!)) {
  const data = await gzip(new TextEncoder().encode("region-tile-bytes"));
  await workerEnv.MAPS_BUCKET.put(
    key,
    buildPmtiles([{ z: SG.z, x: SG.x, y: SG.y, data }], {
      tileCompression: 2,
      minZoom: 0,
      maxZoom: 14,
      bounds,
    }),
  );
  return data;
}

const auth = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};
const post = (
  p: string,
  body: unknown,
  env: Env,
  headers: Record<string, string> = auth,
) =>
  call(`/internal/v1/regions${p}`, env, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

async function tile(
  t: { z: number; x: number; y: number },
  env: Env,
  headers: Record<string, string> = ORIGIN,
) {
  const { ctx, settle } = makeCtx();
  const res = await call(path(t), env, { headers }, ctx);
  await settle();
  return res;
}

beforeEach(async () => {
  forgetRecentDemand();
  forgetUpstreamReaders();
  await wipeBucket();
});
afterEach(() => vi.unstubAllGlobals());

describe("grid", () => {
  it("maps a tile to its z6 ancestor and back to a bbox", () => {
    expect(cellOf(8, 201, 127)).toEqual({ x: 50, y: 31 });
    expect(cellOf(6, 50, 31)).toEqual({ x: 50, y: 31 });
    expect(cellOf(14, 12900, 8100)).toEqual({ x: 50, y: 31 });
    const [w, s, e, n] = cellBbox({ x: 50, y: 31 });
    expect(w).toBeCloseTo(101.25);
    expect(e).toBeCloseTo(106.875);
    expect(s).toBeCloseTo(0, 5);
    expect(n).toBeCloseTo(5.6, 1);
    expect(parseCell("6/64/0")).toBeNull();
    expect(parseCell("7/1/1")).toBeNull();
  });
});

describe("manifest", () => {
  it("rejects anything that is not a valid manifest", () => {
    const ok = {
      version: 2,
      grid_zoom: 6,
      regions: [
        { cell: "6/50/31", key: "tiles/regions/6-50-31-20261127.pmtiles" },
      ],
    };
    expect(parseManifest(JSON.stringify(ok))?.regions).toHaveLength(1);
    expect(parseManifest("not json")).toBeNull();
    expect(parseManifest(JSON.stringify({ ...ok, grid_zoom: 7 }))).toBeNull();
    // A key outside the prefix, or for another cell, is refused.
    for (const key of [
      "tiles/nyuchi-maps.pmtiles",
      "tiles/regions/6-50-32-20261127.pmtiles",
      "tiles/regions/../x.pmtiles",
    ]) {
      expect(
        parseManifest(
          JSON.stringify({ ...ok, regions: [{ cell: "6/50/31", key }] }),
        ),
      ).toBeNull();
    }
  });

  it("keeps the last good manifest when a later read is invalid", async () => {
    const bucket = new StubBucket();
    const env = makeEnv(bucket, { MANIFEST_TTL_SECONDS: "0" });
    bucket.put(
      "tiles/regions.json",
      JSON.stringify({ version: 4, grid_zoom: 6, regions: [] }),
    );
    expect((await loadManifest(env)).manifest.version).toBe(4);
    bucket.put("tiles/regions.json", "{broken");
    expect((await loadManifest(env)).manifest.version).toBe(4);
  });

  it("treats a missing manifest as no regions", async () => {
    const env = makeEnv(new StubBucket(), { MANIFEST_TTL_SECONDS: "0" });
    expect((await loadManifest(env)).manifest.regions).toEqual([]);
  });
});

describe("tiles with regions on", () => {
  it("serves a stored tile and labels its source", async () => {
    const data = await putPrimary();
    await putManifest();
    const res = await tile(HARARE, renv());
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Tile-Source")).toBe("primary");
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=2592000");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(data);
  });

  it("answers 204 for an empty tile inside coverage and records nothing", async () => {
    await putPrimary();
    await putManifest();
    const env = renv();
    const empty = { z: 8, x: HARARE.x + 1, y: HARARE.y };
    const res = await tile(empty, env);
    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=86400");
    expect((await ledger(env).state()).pending).toBe(0);
    expect((await ledger(env).state()).observed).toBe(0);
  });

  it("records demand once for a tile that is not stored and answers a short 204", async () => {
    await putPrimary();
    await putManifest();
    const env = renv();
    const first = await tile(SG, env);
    expect(first.status).toBe(204);
    expect(first.headers.get("X-Tile-Source")).toBe("none");
    expect(first.headers.get("Cache-Control")).toBe(
      "public, max-age=30, s-maxage=60",
    );
    const again = await tile(SG, env);
    expect(again.status).toBe(204);
    const sibling = await tile(SG2, env);
    expect(sibling.status).toBe(204);
    const state = await ledger(env).state();
    expect(state.pending).toBe(1);
    expect(state.counters.demand_recorded).toBe(1);
    // The repeat tile never reached the ledger (isolate memory); the sibling did.
    expect(state.counters.demand_duplicate).toBe(1);
  });

  it("queues a cell only after enough distinct tiles", async () => {
    await putPrimary();
    await putManifest();
    const env = renv({ DEMAND_MIN_TILES: "3" });
    await tile(SG, env);
    await tile(SG2, env);
    expect((await ledger(env).state()).pending).toBe(0);
    expect((await ledger(env).state()).observed).toBe(1);
    await tile(SG3, env);
    const state = await ledger(env).state();
    expect(state.pending).toBe(1);
    expect(state.observed).toBe(0);
  });

  it("never records demand for invalid input", async () => {
    await putPrimary();
    await putManifest();
    const env = renv();
    const cases = [
      "/v1/tiles/8/9999/1.mvt", // out of range for the zoom
      "/v1/tiles/8/01/1.mvt", // leading zero
      "/v1/tiles/99/1/1.mvt", // zoom above the maximum
      `/v1/tiles/8/${SG.x}/${SG.y}.png`, // wrong extension for the archive
      `/v1/tiles/5/${SG.x >> 3}/${SG.y >> 3}.mvt`, // below the grid zoom
      `/v1/tiles/15/${SG.x << 7}/${SG.y << 7}.mvt`, // deeper than a region
    ];
    for (const p of cases) {
      const { ctx, settle } = makeCtx();
      await call(p, env, { headers: ORIGIN }, ctx);
      await settle();
    }
    const state = await ledger(env).state();
    expect(state.pending + state.observed).toBe(0);
    expect(state.counters).toEqual({});
  });

  it("does not record demand without an allowed origin", async () => {
    await putPrimary();
    await putManifest();
    const env = renv();
    const res = await tile(SG, env, { "CF-Connecting-IP": "198.51.100.7" });
    expect(res.status).toBe(204);
    expect((await ledger(env).state()).pending).toBe(0);
    // A same-origin fetch from the map page is accepted.
    await tile(SG, env, { "Sec-Fetch-Site": "same-origin" });
    expect((await ledger(env).state()).pending).toBe(1);
  });

  it("is exactly the old behaviour while the switch is off", async () => {
    await putPrimary();
    const env = renv({ ONDEMAND_REGIONS: "off" });
    const res = await tile(SG, env);
    expect(res.status).toBe(204);
    expect(res.headers.get("X-Tile-Source")).toBeNull();
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=86400");
    expect((await ledger(env).state()).counters).toEqual({});
  });

  it("serves the region archive once the builder completes it", async () => {
    await putPrimary();
    await putManifest();
    const env = renv();
    await tile(SG, env);

    const claim = await post("/claim", { lease_seconds: 600 }, env);
    expect(claim.status).toBe(200);
    const job = (await claim.json()) as {
      lease: string;
      cell: string;
      bbox: number[];
      maxzoom: number;
    };
    expect(job.cell).toBe(SG_CELL);
    expect(job.maxzoom).toBe(14);

    const key = "tiles/regions/6-50-31-20261127.pmtiles";
    const data = await putRegion(key);
    const done = await post(
      "/complete",
      {
        lease: job.lease,
        cell: job.cell,
        key,
        build: "20261127",
        upstream_url: "https://planet.example/20261127.pmtiles",
      },
      env,
    );
    expect(done.status).toBe(200);
    expect(
      ((await done.json()) as { manifest_version: number }).manifest_version,
    ).toBe(2);

    const res = await tile(SG, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Tile-Source")).toBe("region");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(data);
    // Inside the region, a tile it does not hold is a real 204.
    const hole = await tile({ z: 8, x: SG.x + 1, y: SG.y }, env);
    expect(hole.status).toBe(204);
    expect(hole.headers.get("X-Tile-Source")).toBe("region");

    // Completing again is idempotent and does not bump the manifest.
    const again = await post(
      "/complete",
      { lease: job.lease, cell: job.cell, key, build: "20261127" },
      env,
    );
    expect(
      ((await again.json()) as { manifest_version: number }).manifest_version,
    ).toBe(2);
    const manifest = JSON.parse(
      await (await workerEnv.MAPS_BUCKET.get("tiles/regions.json"))!.text(),
    );
    expect(manifest.primary.cells).toEqual([HARARE_CELL]);
    expect(manifest.regions).toHaveLength(1);
    expect(manifest.upstream.build).toBe("20261127");
    expect((await ledger(env).state()).done).toBe(1);
  });

  it("answers ETag and 304 for a region tile", async () => {
    await putPrimary();
    await putManifest();
    const env = renv();
    await tile(SG, env);
    const job = (await (await post("/claim", {}, env)).json()) as {
      lease: string;
    };
    const key = "tiles/regions/6-50-31-20261127.pmtiles";
    await putRegion(key);
    await post(
      "/complete",
      { lease: job.lease, cell: SG_CELL, key, build: "20261127" },
      env,
    );
    const first = await tile(SG, env);
    const etag = first.headers.get("ETag")!;
    expect(etag).toMatch(/^"[^"]+:8\/\d+\/\d+"$/);
    expect(first.headers.get("Cache-Control")).toContain("s-maxage=2592000");
    const second = await tile(SG, env, { ...ORIGIN, "If-None-Match": etag });
    expect(second.status).toBe(304);
  });

  it("keeps primary, region and fallback tiles under separate edge keys", async () => {
    await putPrimary();
    await putManifest();
    const env = renv({ EDGE_CACHE: "on", TILES_VERSION: "9" });
    await tile(SG, env); // not stored: nothing is put in the cache
    const job = (await (await post("/claim", {}, env)).json()) as {
      lease: string;
    };
    const key = "tiles/regions/6-50-31-20261127.pmtiles";
    await putRegion(key);
    await post(
      "/complete",
      { lease: job.lease, cell: SG_CELL, key, build: "20261127" },
      env,
    );
    await tile(SG, env);
    await tile(HARARE, env);
    const base = `${BASE}${path(SG)}?v=9`;
    const regionKey = `${base}&r=${encodeURIComponent(key)}`;
    expect(await caches.default.match(new Request(regionKey))).toBeTruthy();
    expect(await caches.default.match(new Request(base))).toBeUndefined();
    expect(
      await caches.default.match(new Request(`${BASE}${path(HARARE)}?v=9`)),
    ).toBeTruthy();
    await caches.default.delete(new Request(regionKey));
    await caches.default.delete(new Request(`${BASE}${path(HARARE)}?v=9`));
  });
});

describe("abuse caps", () => {
  async function demand(env: Env, cell: string, tileKey: string, ip: string) {
    return ledger(env).record(
      { cell, tile: tileKey, client: ip },
      {
        minTiles: 1,
        ipCellsPerDay: Number(env.DEMAND_IP_CELLS_PER_DAY ?? 5),
        ipHitsPerDay: Number(env.DEMAND_IP_HITS_PER_DAY ?? 300),
        newCellsPerDay: Number(env.DEMAND_NEW_CELLS_PER_DAY ?? 40),
        maxPending: Number(env.DEMAND_MAX_PENDING ?? 100),
        upstreamPerDay: 2000,
      },
    );
  }

  it("caps cells promoted per client per day", async () => {
    const env = renv({ DEMAND_IP_CELLS_PER_DAY: "2" });
    expect(await demand(env, "6/1/1", "8/4/4", "a")).toBe("recorded");
    expect(await demand(env, "6/1/2", "8/4/8", "a")).toBe("recorded");
    expect(await demand(env, "6/1/3", "8/4/12", "a")).toBe("ip_capped");
    // Another client is unaffected.
    expect(await demand(env, "6/1/3", "8/4/12", "b")).toBe("recorded");
  });

  it("caps hits per client per day", async () => {
    const env = renv({ DEMAND_IP_HITS_PER_DAY: "2" });
    expect(await demand(env, "6/2/1", "8/8/4", "a")).toBe("recorded");
    expect(await demand(env, "6/2/1", "8/8/5", "a")).toBe("duplicate");
    expect(await demand(env, "6/2/2", "8/8/8", "a")).toBe("ip_capped");
  });

  it("caps new cells per day, globally", async () => {
    const env = renv({ DEMAND_NEW_CELLS_PER_DAY: "1" });
    expect(await demand(env, "6/3/1", "8/12/4", "a")).toBe("recorded");
    expect(await demand(env, "6/3/2", "8/12/8", "b")).toBe("global_capped");
  });

  it("caps the backlog", async () => {
    const env = renv({ DEMAND_MAX_PENDING: "1" });
    expect(await demand(env, "6/4/1", "8/16/4", "a")).toBe("recorded");
    expect(await demand(env, "6/4/2", "8/16/8", "b")).toBe("backlog_full");
  });

  it("spends the upstream budget and stops", async () => {
    const env = renv();
    const stub = ledger(env);
    expect(await stub.takeUpstream(2)).toBe(true);
    expect(await stub.takeUpstream(2)).toBe(true);
    expect(await stub.takeUpstream(2)).toBe(false);
  });
});

describe("builder protocol", () => {
  it("is disabled without a token and refuses a wrong one", async () => {
    const off = renv({ BUILDER_TOKEN: undefined });
    expect((await post("/claim", {}, off)).status).toBe(404);
    const env = renv();
    expect(
      (await post("/claim", {}, env, { "Content-Type": "application/json" }))
        .status,
    ).toBe(401);
    expect(
      (await post("/claim", {}, env, { ...auth, Authorization: "Bearer nope" }))
        .status,
    ).toBe(401);
    expect((await post("/claim", {}, env)).status).toBe(204);
  });

  it("is outside the /v1 origin-auth gate and keeps its own bearer token", async () => {
    const env = renv({
      ORIGIN_AUTH: "enforce",
      ORIGIN_AUTH_KEYS: "k1:test-secret-0123456789abcdef",
    });
    // No origin credential: the builder is still served (bearer only)...
    expect((await post("/claim", {}, env)).status).toBe(204);
    // ...and a missing or wrong bearer is still refused by its own check.
    expect(
      (await post("/claim", {}, env, { "Content-Type": "application/json" }))
        .status,
    ).toBe(401);
    // While /v1 on the same env needs the origin credential.
    expect((await call("/v1/tiles.json", env)).status).toBe(401);
  });

  it("retries a failed build with backoff, then buries it", async () => {
    const env = renv();
    const stub = ledger(env);
    await stub.record(
      { cell: "6/5/5", tile: "8/20/20", client: "a" },
      {
        minTiles: 1,
        ipCellsPerDay: 5,
        ipHitsPerDay: 300,
        newCellsPerDay: 40,
        maxPending: 100,
        upstreamPerDay: 1,
      },
    );
    let now = Date.now();
    for (let attempt = 1; attempt <= 4; attempt++) {
      const claim = await stub.claim(600, now);
      expect(claim?.cell).toBe("6/5/5");
      expect(claim?.attempt).toBe(attempt);
      // Not claimable again until it is failed and the backoff has passed.
      expect(await stub.claim(600, now)).toBeNull();
      const failed = await stub.fail(
        { lease: claim!.lease, cell: "6/5/5", error: "boom" },
        now,
      );
      expect(failed.state).toBe(attempt < 4 ? "pending" : "dead");
      if (attempt < 4) expect(await stub.claim(600, now)).toBeNull();
      now += 4 * 3600 * 1000;
    }
    const state = await stub.state(now);
    expect(state.dead).toBe(1);
    expect(await stub.claim(600, now)).toBeNull();
    // Demand never revives a dead cell; the owner does.
    expect(
      await stub.record(
        { cell: "6/5/5", tile: "8/20/21", client: "b" },
        {
          minTiles: 1,
          ipCellsPerDay: 5,
          ipHitsPerDay: 300,
          newCellsPerDay: 40,
          maxPending: 100,
          upstreamPerDay: 1,
        },
      ),
    ).toBe("dead");
    expect((await post("/rearm", { cell: "6/5/5" }, env)).status).toBe(200);
    expect((await ledger(env).claim(600, now))?.cell).toBe("6/5/5");
  });

  it("hands a lapsed lease to the next claimant", async () => {
    const env = renv();
    const stub = ledger(env);
    await stub.record(
      { cell: "6/6/6", tile: "8/24/24", client: "a" },
      {
        minTiles: 1,
        ipCellsPerDay: 5,
        ipHitsPerDay: 300,
        newCellsPerDay: 40,
        maxPending: 100,
        upstreamPerDay: 1,
      },
    );
    const now = Date.now();
    const one = await stub.claim(60, now);
    expect(one).toBeTruthy();
    // After the lease lapses the cell backs off, then is claimable again.
    expect(await stub.claim(60, now + 61_000)).toBeNull();
    const two = await stub.claim(60, now + 61_000 + 301_000);
    expect(two?.cell).toBe("6/6/6");
    expect(two?.lease).not.toBe(one!.lease);
  });

  it("refuses to publish an archive that is wrong", async () => {
    await putPrimary();
    await putManifest();
    const env = renv();
    await tile(SG, env);
    const job = (await (await post("/claim", {}, env)).json()) as {
      lease: string;
    };
    const key = "tiles/regions/6-50-31-20261127.pmtiles";

    // Missing object.
    let res = await post(
      "/complete",
      { lease: job.lease, cell: SG_CELL, key, build: "x" },
      env,
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe(
      "archive_missing",
    );

    // Bounds nowhere near the cell.
    await putRegion(key, [10, 10, 12, 12]);
    res = await post(
      "/complete",
      { lease: job.lease, cell: SG_CELL, key, build: "x" },
      env,
    );
    expect(((await res.json()) as { error: string }).error).toBe(
      "bounds_outside_cell",
    );

    // A key for another cell, a wrong lease, and a key outside the prefix.
    res = await post(
      "/complete",
      {
        lease: job.lease,
        cell: SG_CELL,
        key: "tiles/regions/6-1-1-x.pmtiles",
        build: "x",
      },
      env,
    );
    expect(((await res.json()) as { error: string }).error).toBe("bad_key");
    res = await post(
      "/complete",
      { lease: "wrong", cell: SG_CELL, key, build: "x" },
      env,
    );
    expect(((await res.json()) as { error: string }).error).toBe(
      "lease_mismatch",
    );

    // None of it reached the manifest.
    const manifest = JSON.parse(
      await (await workerEnv.MAPS_BUCKET.get("tiles/regions.json"))!.text(),
    );
    expect(manifest.version).toBe(1);
    expect(manifest.regions).toEqual([]);
  });

  it("reports queue state", async () => {
    const env = renv();
    const res = await call("/internal/v1/regions/state", env, {
      headers: auth,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      pending: 0,
      building: 0,
      dead: 0,
    });
  });
});

describe("upstream fallback", () => {
  const UPSTREAM = "https://planet.example/20261127.pmtiles";

  async function upstreamArchive() {
    const data = await gzip(new TextEncoder().encode("upstream-tile"));
    return {
      data,
      bytes: buildPmtiles([{ z: SG.z, x: SG.x, y: SG.y, data }], {
        tileCompression: 2,
        maxZoom: 14,
      }),
    };
  }

  function stubFetch(bytes: Uint8Array, calls: string[]) {
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        calls.push(url);
        const range = new Headers(init?.headers).get("Range");
        const m = /bytes=(\d+)-(\d+)/.exec(range ?? "");
        if (!m) return new Response("range required", { status: 416 });
        const slice = bytes.slice(Number(m[1]), Number(m[2]) + 1);
        return new Response(slice, {
          status: 206,
          headers: {
            ETag: '"up1"',
            "Content-Range": `bytes ${m[1]}-${m[2]}/${bytes.length}`,
          },
        });
      },
    );
  }

  it("serves one tile from the build by range reads, briefly cacheable", async () => {
    const { data, bytes } = await upstreamArchive();
    await putPrimary();
    await putManifest({ upstream: { url: UPSTREAM, build: "20261127" } });
    const calls: string[] = [];
    stubFetch(bytes, calls);
    const env = renv({
      FALLBACK_MODE: "upstream",
      UPSTREAM_ALLOWED_HOST: "planet.example",
    });
    const res = await tile(SG, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Tile-Source")).toBe("upstream");
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=60, s-maxage=120",
    );
    expect(res.headers.get("Content-Encoding")).toBe("gzip");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(data);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((u) => u === UPSTREAM)).toBe(true);
    // Demand was recorded as well.
    expect((await ledger(env).state()).pending).toBe(1);
  });

  it("never reads from a host that is not allowed", async () => {
    const { bytes } = await upstreamArchive();
    await putPrimary();
    await putManifest({ upstream: { url: UPSTREAM, build: "20261127" } });
    const calls: string[] = [];
    stubFetch(bytes, calls);
    const wrongHost = renv({
      FALLBACK_MODE: "upstream",
      UPSTREAM_ALLOWED_HOST: "other.example",
    });
    expect((await tile(SG, wrongHost)).status).toBe(204);
    const noHost = renv({ FALLBACK_MODE: "upstream" });
    expect((await tile(SG, noHost)).status).toBe(204);
    expect(calls).toEqual([]);
  });

  it("falls back to 204 when the daily budget is spent or the read fails", async () => {
    const { bytes } = await upstreamArchive();
    await putPrimary();
    await putManifest({ upstream: { url: UPSTREAM, build: "20261127" } });
    const calls: string[] = [];
    stubFetch(bytes, calls);
    const spent = renv({
      FALLBACK_MODE: "upstream",
      UPSTREAM_ALLOWED_HOST: "planet.example",
      UPSTREAM_TILES_PER_DAY: "0",
    });
    expect((await tile(SG, spent)).status).toBe(204);
    expect(calls).toEqual([]);

    vi.stubGlobal("fetch", async () => new Response("gone", { status: 404 }));
    const failing = renv({
      FALLBACK_MODE: "upstream",
      UPSTREAM_ALLOWED_HOST: "planet.example",
    });
    const res = await tile(SG, failing);
    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=30, s-maxage=60",
    );
  });
});
