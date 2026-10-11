import {
  Compression,
  EtagMismatch,
  PMTiles,
  SharedPromiseCache,
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
 * Directory and header caches live per bucket binding, per isolate. The
 * header is read once and each directory once; the cache key includes the
 * archive ETag, so a replaced archive is picked up on the next mismatch.
 */
const caches = new WeakMap<R2Bucket, SharedPromiseCache>();

/** Tile bytes are passed through still compressed (see tileEncoding). */
const passThrough = async (buf: ArrayBuffer): Promise<ArrayBuffer> => buf;

export function openArchive(env: Env, key: string): PMTiles {
  let cache = caches.get(env.MAPS_BUCKET);
  if (!cache) {
    cache = new SharedPromiseCache(200);
    caches.set(env.MAPS_BUCKET, cache);
  }
  const source = new R2Source(env.MAPS_BUCKET, key);
  // `cache` decompresses directories itself; this decompress only touches
  // tile bytes, which the client can inflate.
  return new PMTiles(source, cache, passThrough);
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
