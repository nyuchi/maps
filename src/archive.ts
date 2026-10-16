import {
  Compression,
  EtagMismatch,
  PMTiles,
  ResolvedValueCache,
  TileType,
  type Header,
  type RangeResponse,
  type Source,
} from "pmtiles";
import type { Env } from "./types";

export const DEFAULT_TILES_KEY = "tiles/nyuchi-maps.pmtiles";

/** The archive object is absent from the bucket. */
export class ArchiveMissingError extends Error {
  constructor(key: string) {
    super(`archive not found: ${key}`);
  }
}

/** The archive uses a tile compression the edge cannot pass through. */
export class UnsupportedCompressionError extends Error {}

/** PMTiles Source over an R2 binding: every read is an R2 range read. */
class R2Source implements Source {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly key: string,
  ) {}

  getKey(): string {
    return this.key;
  }

  async getBytes(
    offset: number,
    length: number,
    _signal?: AbortSignal,
    etag?: string,
  ): Promise<RangeResponse> {
    const object = await this.bucket.get(this.key, {
      range: { offset, length },
      onlyIf: etag ? { etagMatches: etag } : undefined,
    });
    if (!object) throw new ArchiveMissingError(this.key);
    // R2 answers a failed precondition with metadata and no body: the
    // archive was replaced between two reads.
    if (!("body" in object) || !object.body) throw new EtagMismatch();
    return { data: await object.arrayBuffer(), etag: object.etag };
  }
}

/**
 * Directory and header caches live per bucket binding, per isolate.
 *
 * ResolvedValueCache, not SharedPromiseCache, on purpose: it stores only
 * values that resolved. SharedPromiseCache stores the promise before it
 * settles and never drops a rejection, so one missing archive or one
 * transient R2 error would poison every later request in the isolate; it
 * also shares promises between requests, which Workers cannot do (I/O
 * belongs to the request that started it). Here a failure caches nothing and
 * the next request simply tries again. The key includes the archive ETag, so
 * a replaced archive is picked up on the next ETag mismatch.
 */
const archiveCaches = new WeakMap<R2Bucket, ResolvedValueCache>();

/** Tile bytes are passed through still compressed (see tileEncoding). */
const passThrough = async (buf: ArrayBuffer): Promise<ArrayBuffer> => buf;

function cacheFor(env: Env): ResolvedValueCache {
  let cache = archiveCaches.get(env.MAPS_BUCKET);
  if (!cache) {
    cache = new ResolvedValueCache(200);
    archiveCaches.set(env.MAPS_BUCKET, cache);
  }
  return cache;
}

export function openArchive(env: Env, key: string): PMTiles {
  const source = new R2Source(env.MAPS_BUCKET, key);
  // The cache decompresses directories itself; this decompress only touches
  // tile bytes, which the client can inflate.
  return new PMTiles(source, cacheFor(env), passThrough);
}

async function gunzip(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

/**
 * Parse the archive's JSON metadata block. Only none (1) and gzip (2) are
 * handled; anything else yields null rather than an error, because metadata
 * only enriches the TileJSON.
 */
export async function decodeMetadata(
  bytes: ArrayBuffer,
  compression: Compression,
): Promise<Record<string, unknown> | null> {
  try {
    let raw = bytes;
    if (compression === Compression.Gzip) raw = await gunzip(bytes);
    else if (
      compression !== Compression.None &&
      compression !== Compression.Unknown
    ) {
      return null;
    }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const metadataCache = new WeakMap<
  R2Bucket,
  Map<string, Record<string, unknown> | null>
>();

/** `vector_layers` from the archive metadata, cached per archive ETag. */
export async function vectorLayers(
  env: Env,
  key: string,
  header: Header,
): Promise<unknown[] | null> {
  let perBucket = metadataCache.get(env.MAPS_BUCKET);
  if (!perBucket) {
    perBucket = new Map();
    metadataCache.set(env.MAPS_BUCKET, perBucket);
  }
  const cacheKey = `${key}|${header.etag ?? ""}`;
  let meta = perBucket.get(cacheKey);
  if (meta === undefined) {
    const source = new R2Source(env.MAPS_BUCKET, key);
    const { data } = await source.getBytes(
      header.jsonMetadataOffset,
      header.jsonMetadataLength,
      undefined,
      header.etag,
    );
    meta = await decodeMetadata(data, header.internalCompression);
    if (perBucket.size > 16) perBucket.clear();
    perBucket.set(cacheKey, meta);
  }
  const layers = meta?.vector_layers;
  return Array.isArray(layers) ? layers : null;
}

const EXT: Partial<Record<TileType, string>> = {
  [TileType.Mvt]: "mvt",
  [TileType.Png]: "png",
  [TileType.Jpeg]: "jpg",
  [TileType.Webp]: "webp",
  [TileType.Avif]: "avif",
  [TileType.Mlt]: "mlt",
};

const CONTENT_TYPE: Record<string, string> = {
  mvt: "application/vnd.mapbox-vector-tile",
  mlt: "application/vnd.maplibre-vector-tile",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
};

export function tileExt(header: Header): string | undefined {
  return EXT[header.tileType];
}

export function tileContentType(ext: string): string {
  return CONTENT_TYPE[ext] ?? "application/octet-stream";
}

/** Content-Encoding for the stored tile bytes; throws when unsupported. */
export function tileEncoding(header: Header): "gzip" | null {
  if (header.tileCompression === Compression.Gzip) return "gzip";
  if (
    header.tileCompression === Compression.None ||
    header.tileCompression === Compression.Unknown
  ) {
    return null;
  }
  throw new UnsupportedCompressionError(
    `tile compression ${header.tileCompression} is not supported`,
  );
}
