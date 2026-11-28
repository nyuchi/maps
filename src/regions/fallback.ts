import {
  Compression,
  FetchSource,
  PMTiles,
  ResolvedValueCache,
  TileType,
} from "pmtiles";
import { passThrough } from "../archive";
import type { Env } from "../types";
import { capsFrom, fallbackTimeoutMs, logEvent } from "./config";
import { ledgerStub } from "./demand";

/** The answer for a tile that is not stored, when no upstream tile is read. */
export const CACHE_FALLBACK = "public, max-age=30, s-maxage=60";
/** An upstream tile: short, so a stored region replaces it soon. */
export const CACHE_UPSTREAM = "public, max-age=60, s-maxage=120";

const readers = new Map<string, PMTiles>();

function reader(url: string): PMTiles {
  let r = readers.get(url);
  if (!r) {
    if (readers.size >= 4) readers.clear();
    r = new PMTiles(
      new FetchSource(url),
      new ResolvedValueCache(100),
      passThrough,
    );
    readers.set(url, r);
  }
  return r;
}

export function forgetUpstreamReaders(): void {
  readers.clear();
}

export interface UpstreamTile {
  data: ArrayBuffer;
}

/**
 * One tile from the planet build by HTTP range reads, only when
 * FALLBACK_MODE=upstream, the manifest's URL is https on UPSTREAM_ALLOWED_HOST,
 * the ledger's daily budget has room, and the read finishes inside
 * FALLBACK_TIMEOUT_MS. Any other outcome is null: the caller answers 204.
 */
export async function upstreamTile(
  env: Env,
  upstreamUrl: string | undefined,
  t: { z: number; x: number; y: number },
): Promise<UpstreamTile | null> {
  if (env.FALLBACK_MODE !== "upstream" || !upstreamUrl) return null;
  let url: URL;
  try {
    url = new URL(upstreamUrl);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    !env.UPSTREAM_ALLOWED_HOST ||
    url.host !== env.UPSTREAM_ALLOWED_HOST
  ) {
    return null;
  }
  try {
    if (!(await ledgerStub(env).takeUpstream(capsFrom(env).upstreamPerDay))) {
      logEvent("maps.fallback", { mode: "upstream", result: "budget" });
      return null;
    }
    const signal = AbortSignal.timeout(fallbackTimeoutMs(env));
    const archive = reader(url.href);
    const header = await archive.getHeader();
    if (
      header.tileType !== TileType.Mvt ||
      header.tileCompression !== Compression.Gzip
    ) {
      return null;
    }
    const found = await archive.getZxy(t.z, t.x, t.y, signal);
    logEvent("maps.fallback", {
      mode: "upstream",
      result: found ? "served" : "empty",
    });
    return found ? { data: found.data } : null;
  } catch (err) {
    logEvent("maps.fallback", {
      mode: "upstream",
      result: "error",
      error: String(err),
    });
    return null;
  }
}
