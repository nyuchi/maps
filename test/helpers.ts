import { zxyToTileId } from "pmtiles";
import app, { createApp } from "../src/index";
import type { SourceDef } from "../src/sources";
import type { Env } from "../src/types";

export const BASE = "https://maps.test";

// ---- R2 stub --------------------------------------------------------------

interface StoredObject {
  data: Uint8Array;
  etag: string;
}

export interface GetCall {
  key: string;
  range?: { offset: number; length: number };
}

/** Just enough of the R2 binding for the Worker: get() with range + onlyIf. */
export class StubBucket {
  readonly objects = new Map<string, StoredObject>();
  readonly gets: GetCall[] = [];
  /** When set, the next get() rejects with it (a transient R2 fault). */
  failNext: Error | null = null;

  put(key: string, data: Uint8Array | string, etag = "etag1"): this {
    const bytes =
      typeof data === "string" ? new TextEncoder().encode(data) : data;
    this.objects.set(key, { data: bytes, etag });
    return this;
  }

  async get(
    key: string,
    options?: {
      range?: { offset: number; length: number };
      onlyIf?: { etagMatches?: string } | Headers;
    },
  ): Promise<unknown> {
    this.gets.push({ key, range: options?.range });
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    const stored = this.objects.get(key);
    if (!stored) return null;
    const meta = {
      key,
      etag: stored.etag,
      httpEtag: `"${stored.etag}"`,
      size: stored.data.length,
    };
    const cond = options?.onlyIf;
    if (cond instanceof Headers) {
      // R2 evaluates request conditionals: a matching If-None-Match -> no body.
      const inm = cond.get("If-None-Match");
      if (
        inm &&
        inm
          .split(",")
          .map((t) => t.trim())
          .includes(meta.httpEtag)
      ) {
        return meta;
      }
    } else if (cond?.etagMatches && cond.etagMatches !== stored.etag) {
      return meta; // precondition failed: no body
    }
    const slice = options?.range
      ? stored.data.slice(
          options.range.offset,
          options.range.offset + options.range.length,
        )
      : stored.data;
    return {
      ...meta,
      body: new Response(slice).body,
      arrayBuffer: async () => slice.slice().buffer,
    };
  }
}

export const ALLOWED = "https://weather.mukoko.com,http://localhost:3000";

export function makeEnv(bucket: StubBucket, overrides: Partial<Env> = {}): Env {
  return {
    MAPS_BUCKET: bucket as unknown as R2Bucket,
    RATE_LIMITER: { limit: async () => ({ success: true }) },
    PUBLIC_BASE_URL: "https://maps.nyuchi.com",
    ALLOWED_ORIGINS: ALLOWED,
    TILES_KEY: "tiles/test.pmtiles",
    EDGE_CACHE: "off",
    ...overrides,
  };
}

export function makeCtx() {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (p: Promise<unknown>) => void pending.push(p),
      passThroughOnException: () => {},
    } as unknown as ExecutionContext,
    settle: () => Promise.all(pending),
  };
}

export async function call(
  path: string,
  env: Env,
  init?: RequestInit,
  ctx: ExecutionContext = makeCtx().ctx,
  worker: { fetch: typeof app.fetch } = app,
): Promise<Response> {
  return worker.fetch(new Request(`${BASE}${path}`, init), env, ctx);
}

export { createApp };
export type { SourceDef };

// ---- PMTiles v3 writer (tests only) -----------------------------------------

export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function varint(n: number, out: number[]): void {
  let v = n;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

export interface TestTile {
  z: number;
  x: number;
  y: number;
  data: Uint8Array;
}

export interface ArchiveOptions {
  tileType?: number; // 1 = MVT
  tileCompression?: number; // 1 none, 2 gzip
  minZoom?: number;
  maxZoom?: number;
  /** JSON metadata block (stored uncompressed). */
  metadata?: Record<string, unknown>;
}

/** A valid single-directory PMTiles v3 archive holding the given tiles. */
export function buildPmtiles(
  tiles: TestTile[],
  options: ArchiveOptions = {},
): Uint8Array {
  const {
    tileType = 1,
    tileCompression = 1,
    minZoom = 0,
    maxZoom = 3,
    metadata: metadataObject = {},
  } = options;
  const sorted = tiles
    .map((t) => ({ ...t, id: zxyToTileId(t.z, t.x, t.y) }))
    .sort((a, b) => a.id - b.id);

  // Directory: count, id deltas, run lengths, lengths, offsets. The first
  // offset is explicit (+1); the rest are contiguous, written as 0.
  const dirBytes: number[] = [];
  varint(sorted.length, dirBytes);
  let last = 0;
  for (const t of sorted) {
    varint(t.id - last, dirBytes);
    last = t.id;
  }
  for (let i = 0; i < sorted.length; i++) varint(1, dirBytes);
  for (const t of sorted) varint(t.data.length, dirBytes);
  sorted.forEach((_, i) => varint(i === 0 ? 1 : 0, dirBytes));

  const metadata = new TextEncoder().encode(JSON.stringify(metadataObject));
  const rootOffset = 127;
  const rootLength = dirBytes.length;
  const metaOffset = rootOffset + rootLength;
  const tileOffset = metaOffset + metadata.length;
  const tileLength = sorted.reduce((n, t) => n + t.data.length, 0);

  const out = new Uint8Array(tileOffset + tileLength);
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode("PMTiles"), 0);
  dv.setUint8(7, 3);
  const u64 = (pos: number, value: number) => {
    dv.setUint32(pos, value >>> 0, true);
    dv.setUint32(pos + 4, Math.floor(value / 2 ** 32), true);
  };
  u64(8, rootOffset);
  u64(16, rootLength);
  u64(24, metaOffset);
  u64(32, metadata.length);
  u64(40, tileOffset); // leaf directories: none
  u64(48, 0);
  u64(56, tileOffset);
  u64(64, tileLength);
  u64(72, sorted.length);
  u64(80, sorted.length);
  u64(88, sorted.length);
  dv.setUint8(96, 1); // clustered
  dv.setUint8(97, 1); // internal compression: none
  dv.setUint8(98, tileCompression);
  dv.setUint8(99, tileType);
  dv.setUint8(100, minZoom);
  dv.setUint8(101, maxZoom);
  dv.setInt32(102, Math.round(25.2 * 1e7), true); // min lon
  dv.setInt32(106, Math.round(-22.45 * 1e7), true); // min lat
  dv.setInt32(110, Math.round(33.1 * 1e7), true); // max lon
  dv.setInt32(114, Math.round(-15.55 * 1e7), true); // max lat
  dv.setUint8(118, 5); // center zoom
  dv.setInt32(119, Math.round(31.05 * 1e7), true);
  dv.setInt32(123, Math.round(-17.83 * 1e7), true);

  out.set(dirBytes, rootOffset);
  out.set(metadata, metaOffset);
  let p = tileOffset;
  for (const t of sorted) {
    out.set(t.data, p);
    p += t.data.length;
  }
  return out;
}
