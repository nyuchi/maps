import type { Env } from "../types";

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Master switch: anything but "on" leaves the Worker exactly as it was. */
export function regionsOn(env: Env): boolean {
  return env.ONDEMAND_REGIONS === "on" && env.DEMAND !== undefined;
}

export interface Caps {
  /** Distinct tiles of a cell that must be requested before it is queued. */
  minTiles: number;
  ipCellsPerDay: number;
  ipHitsPerDay: number;
  newCellsPerDay: number;
  maxPending: number;
  upstreamPerDay: number;
}

export function capsFrom(env: Env): Caps {
  return {
    minTiles: Math.max(1, num(env.DEMAND_MIN_TILES, 3)),
    ipCellsPerDay: num(env.DEMAND_IP_CELLS_PER_DAY, 5),
    ipHitsPerDay: num(env.DEMAND_IP_HITS_PER_DAY, 300),
    newCellsPerDay: num(env.DEMAND_NEW_CELLS_PER_DAY, 40),
    maxPending: num(env.DEMAND_MAX_PENDING, 100),
    upstreamPerDay: num(env.UPSTREAM_TILES_PER_DAY, 2000),
  };
}

export const manifestKey = (env: Env): string =>
  env.MANIFEST_KEY || "tiles/regions.json";

export const manifestTtlMs = (env: Env): number =>
  num(env.MANIFEST_TTL_SECONDS, 60) * 1000;

export const ledgerName = (env: Env): string => env.LEDGER_NAME || "ledger";

export const fallbackTimeoutMs = (env: Env): number =>
  num(env.FALLBACK_TIMEOUT_MS, 1500);

/** One structured log line; Workers Observability indexes the fields. */
export function logEvent(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...fields }));
}
