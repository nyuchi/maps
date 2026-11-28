import type { Header } from "pmtiles";
import type { Env } from "../types";
import { manifestKey, manifestTtlMs, logEvent } from "./config";
import {
  GRID_ZOOM,
  REGION_MAXZOOM,
  cellBbox,
  cellId,
  cellOf,
  parseCell,
  type Cell,
} from "./grid";

export interface RegionEntry {
  cell: string;
  key: string;
  build: string;
  bytes: number;
  maxzoom: number;
  built: string;
}

export interface Manifest {
  version: number;
  grid_zoom: number;
  updated: string;
  upstream?: { url: string; build: string };
  /** Exact cells of the primary archive; when absent its header bounds apply. */
  primary?: { cells: string[] };
  regions: RegionEntry[];
}

export const EMPTY_MANIFEST: Manifest = {
  version: 0,
  grid_zoom: GRID_ZOOM,
  updated: "",
  regions: [],
};

/** Region archives live under one prefix and are named after their cell. */
export const REGION_KEY_RE =
  /^tiles\/regions\/6-(\d{1,2})-(\d{1,2})-[A-Za-z0-9]{1,16}\.pmtiles$/;

export function regionKeyMatchesCell(key: string, cell: string): boolean {
  const m = REGION_KEY_RE.exec(key);
  const c = parseCell(cell);
  return !!m && !!c && Number(m[1]) === c.x && Number(m[2]) === c.y;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Strict parse: null for anything that is not a valid manifest. */
export function parseManifest(text: string): Manifest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const { version, grid_zoom, updated, upstream, primary, regions } = raw;
  if (!Number.isInteger(version) || (version as number) < 0) return null;
  if (grid_zoom !== GRID_ZOOM) return null;
  if (!Array.isArray(regions)) return null;
  const out: Manifest = {
    version: version as number,
    grid_zoom: GRID_ZOOM,
    updated: typeof updated === "string" ? updated : "",
    regions: [],
  };
  if (isRecord(upstream) && typeof upstream.url === "string") {
    out.upstream = {
      url: upstream.url,
      build: typeof upstream.build === "string" ? upstream.build : "",
    };
  }
  if (isRecord(primary) && Array.isArray(primary.cells)) {
    if (!primary.cells.every((c) => typeof c === "string" && parseCell(c))) {
      return null;
    }
    out.primary = { cells: primary.cells as string[] };
  }
  for (const r of regions) {
    if (!isRecord(r)) return null;
    const { cell, key, build, bytes, maxzoom, built } = r;
    if (typeof cell !== "string" || !parseCell(cell)) return null;
    if (typeof key !== "string" || !regionKeyMatchesCell(key, cell)) {
      return null;
    }
    out.regions.push({
      cell,
      key,
      build: typeof build === "string" ? build : "",
      bytes: typeof bytes === "number" ? bytes : 0,
      maxzoom:
        typeof maxzoom === "number" && maxzoom <= REGION_MAXZOOM
          ? maxzoom
          : REGION_MAXZOOM,
      built: typeof built === "string" ? built : "",
    });
  }
  return out;
}

interface Loaded {
  at: number;
  manifest: Manifest;
  primaryCells: Set<string> | null;
  byCell: Map<string, RegionEntry>;
}

const loaded = new WeakMap<R2Bucket, Loaded>();

function index(manifest: Manifest, at: number): Loaded {
  return {
    at,
    manifest,
    primaryCells: manifest.primary ? new Set(manifest.primary.cells) : null,
    byCell: new Map(manifest.regions.map((r) => [r.cell, r])),
  };
}

/**
 * The manifest, held in memory for MANIFEST_TTL_SECONDS (60). A failed or
 * invalid read keeps the last good copy; with none, the manifest is empty.
 * An absent object is valid: no regions yet.
 */
export async function loadManifest(env: Env): Promise<Loaded> {
  const now = Date.now();
  const ttl = manifestTtlMs(env);
  const have = loaded.get(env.MAPS_BUCKET);
  if (have && now - have.at < ttl) return have;
  try {
    const object = await env.MAPS_BUCKET.get(manifestKey(env));
    if (!object) {
      logEvent("maps.manifest", { result: "missing" });
      const empty = index(EMPTY_MANIFEST, now);
      loaded.set(env.MAPS_BUCKET, empty);
      return empty;
    }
    const buf = await (object as R2ObjectBody).arrayBuffer();
    const parsed =
      buf.byteLength <= 1_000_000
        ? parseManifest(new TextDecoder().decode(buf))
        : null;
    if (!parsed) {
      logEvent("maps.manifest", { result: "invalid" });
      throw new Error("invalid manifest");
    }
    if (!have || have.manifest.version !== parsed.version) {
      logEvent("maps.manifest", { result: "loaded", version: parsed.version });
    }
    const fresh = index(parsed, now);
    loaded.set(env.MAPS_BUCKET, fresh);
    return fresh;
  } catch (err) {
    logEvent("maps.manifest", { result: "stale", error: String(err) });
    const keep = have ? { ...have, at: now } : index(EMPTY_MANIFEST, now);
    loaded.set(env.MAPS_BUCKET, keep);
    return keep;
  }
}

export type Classification =
  | { kind: "primary" }
  | { kind: "region"; region: RegionEntry }
  | { kind: "missing"; cell: Cell };

export interface TileCoords {
  z: number;
  x: number;
  y: number;
}

function intersects(
  a: [number, number, number, number],
  header: Header,
): boolean {
  return (
    a[0] < header.maxLon &&
    a[2] > header.minLon &&
    a[1] < header.maxLat &&
    a[3] > header.minLat
  );
}

/**
 * Where a tile lives. Below the grid zoom, or deeper than a region holds, the
 * primary archive answers as it always did and no demand is ever created.
 */
export function classify(
  state: Loaded,
  header: Header,
  t: TileCoords,
): Classification {
  if (t.z < GRID_ZOOM || t.z > REGION_MAXZOOM) return { kind: "primary" };
  const cell = cellOf(t.z, t.x, t.y);
  const id = cellId(cell);
  const inPrimary = state.primaryCells
    ? state.primaryCells.has(id)
    : intersects(cellBbox(cell), header);
  if (inPrimary) return { kind: "primary" };
  const region = state.byCell.get(id);
  if (region && t.z <= region.maxzoom) return { kind: "region", region };
  return { kind: "missing", cell };
}
