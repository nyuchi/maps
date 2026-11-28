import { DurableObject } from "cloudflare:workers";
import { Compression, TileType } from "pmtiles";
import { openArchiveUncached } from "../archive";
import type { Env } from "../types";
import { manifestKey, type Caps } from "./config";
import { REGION_MAXZOOM, cellBbox, parseCell } from "./grid";
import {
  parseManifest,
  regionKeyMatchesCell,
  type Manifest,
  type RegionEntry,
} from "./manifest";

/**
 * The demand ledger: one SQLite-backed Durable Object that is at once the
 * dedupe table for demand, the enforcer of every cap, the builder's work
 * queue (claim / complete / fail with a lease) and the only writer of the
 * manifest. All calls are RPC methods. Everything synchronous in a method
 * runs without interleaving; the one method that does I/O between reads and
 * writes (complete) holds the object with blockConcurrencyWhile.
 */

export type RecordOutcome =
  | "recorded"
  | "duplicate"
  | "below_threshold"
  | "ip_capped"
  | "global_capped"
  | "backlog_full"
  | "known"
  | "dead"
  | "invalid";

export interface RecordInput {
  cell: string;
  /** "z/x/y" of the requested tile. */
  tile: string;
  /** Opaque, already hashed client id (never a raw address). */
  client: string;
  now?: number;
}

export interface Claim {
  lease: string;
  cell: string;
  bbox: [number, number, number, number];
  maxzoom: number;
  attempt: number;
}

export interface CompleteInput {
  lease: string;
  cell: string;
  key: string;
  build: string;
  upstream_url?: string;
  now?: number;
}

export type CompleteResult =
  { ok: true; manifest_version: number } | { ok: false; error: string };

export interface LedgerState {
  pending: number;
  building: number;
  observed: number;
  done: number;
  dead: number;
  manifest_version: number;
  stored_bytes: number;
  counters: Record<string, number>;
  today: { new_cells: number; upstream_tiles: number };
}

const MAX_ATTEMPTS = 4;
/** Seconds to wait before attempt n+1 after attempt n failed. */
const BACKOFF = [300, 1800, 10800];
const MAX_OBSERVED = 5000;
const MAX_LEASE_SECONDS = 6 * 3600;
const DAY_MS = 86_400_000;

const dayOf = (now: number): string => new Date(now).toISOString().slice(0, 10);

type Row = Record<string, SqlStorageValue>;

export class DemandLedger extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS cells(
        cell TEXT PRIMARY KEY, state TEXT NOT NULL,
        first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
        lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0, last_error TEXT,
        key TEXT, build TEXT, bytes INTEGER NOT NULL DEFAULT 0,
        maxzoom INTEGER NOT NULL DEFAULT 14, built TEXT);
      CREATE INDEX IF NOT EXISTS cells_state ON cells(state);
      CREATE TABLE IF NOT EXISTS tile_hits(
        cell TEXT NOT NULL, tile TEXT NOT NULL, PRIMARY KEY(cell, tile)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS client_day(
        day TEXT NOT NULL, client TEXT NOT NULL, hits INTEGER NOT NULL DEFAULT 0,
        cells INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day, client)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS day_counters(
        day TEXT NOT NULL, name TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(day, name)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS totals(name TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
    `);
  }

  // ---- helpers -----------------------------------------------------------

  private all<T extends Row>(q: string, ...b: SqlStorageValue[]): T[] {
    return this.sql.exec<T>(q, ...b).toArray();
  }

  private first<T extends Row>(q: string, ...b: SqlStorageValue[]): T | null {
    return this.all<T>(q, ...b)[0] ?? null;
  }

  private count(q: string, ...b: SqlStorageValue[]): number {
    return Number(this.first<{ n: number }>(q, ...b)?.n ?? 0);
  }

  private bump(name: string): void {
    this.sql.exec(
      `INSERT INTO totals(name, n) VALUES(?, 1)
       ON CONFLICT(name) DO UPDATE SET n = n + 1`,
      name,
    );
  }

  private bumpDay(day: string, name: string): void {
    this.sql.exec(
      `INSERT INTO day_counters(day, name, n) VALUES(?, ?, 1)
       ON CONFLICT(day, name) DO UPDATE SET n = n + 1`,
      day,
      name,
    );
  }

  private meta(k: string): string | null {
    return (
      this.first<{ v: string }>(`SELECT v FROM meta WHERE k = ?`, k)?.v ?? null
    );
  }

  private setMeta(k: string, v: string): void {
    this.sql.exec(
      `INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      k,
      v,
    );
  }

  private prune(now: number, day: string): void {
    if (this.meta("pruned") === day) return;
    this.setMeta("pruned", day);
    const old = dayOf(now - 8 * DAY_MS);
    this.sql.exec(`DELETE FROM client_day WHERE day < ?`, old);
    this.sql.exec(`DELETE FROM day_counters WHERE day < ?`, old);
    const cutoff = now - 7 * DAY_MS;
    this.sql.exec(
      `DELETE FROM tile_hits WHERE cell IN
         (SELECT cell FROM cells WHERE state = 'observed' AND last_seen < ?)`,
      cutoff,
    );
    this.sql.exec(
      `DELETE FROM cells WHERE state = 'observed' AND last_seen < ?`,
      cutoff,
    );
  }

  private outcome(o: RecordOutcome): RecordOutcome {
    this.bump(`demand_${o}`);
    return o;
  }

  // ---- demand ------------------------------------------------------------

  record(input: RecordInput, caps: Caps): RecordOutcome {
    const now = input.now ?? Date.now();
    const day = dayOf(now);
    if (!parseCell(input.cell) || input.tile.length > 24) {
      return this.outcome("invalid");
    }
    this.prune(now, day);

    const client = this.first<{ hits: number; cells: number }>(
      `SELECT hits, cells FROM client_day WHERE day = ? AND client = ?`,
      day,
      input.client,
    );
    if ((client?.hits ?? 0) >= caps.ipHitsPerDay)
      return this.outcome("ip_capped");
    this.sql.exec(
      `INSERT INTO client_day(day, client, hits, cells) VALUES(?, ?, 1, 0)
       ON CONFLICT(day, client) DO UPDATE SET hits = hits + 1`,
      day,
      input.client,
    );

    const row = this.first<{ state: string }>(
      `SELECT state FROM cells WHERE cell = ?`,
      input.cell,
    );
    if (row?.state === "done") return this.outcome("known");
    if (row?.state === "dead") return this.outcome("dead");
    if (row?.state === "pending" || row?.state === "building") {
      return this.outcome("duplicate");
    }

    if (
      !row &&
      this.count(`SELECT COUNT(*) AS n FROM cells WHERE state = 'observed'`) >=
        MAX_OBSERVED
    ) {
      return this.outcome("global_capped");
    }
    this.sql.exec(
      `INSERT INTO cells(cell, state, first_seen, last_seen) VALUES(?, 'observed', ?, ?)
       ON CONFLICT(cell) DO UPDATE SET last_seen = excluded.last_seen`,
      input.cell,
      now,
      now,
    );
    this.sql.exec(
      `INSERT OR IGNORE INTO tile_hits(cell, tile) VALUES(?, ?)`,
      input.cell,
      input.tile,
    );
    const tiles = this.count(
      `SELECT COUNT(*) AS n FROM tile_hits WHERE cell = ?`,
      input.cell,
    );
    if (tiles < caps.minTiles) return this.outcome("below_threshold");

    const cells = client?.cells ?? 0;
    if (cells >= caps.ipCellsPerDay) return this.outcome("ip_capped");
    const fresh = this.count(
      `SELECT n FROM day_counters WHERE day = ? AND name = 'new_cells'`,
      day,
    );
    if (fresh >= caps.newCellsPerDay) return this.outcome("global_capped");
    const open = this.count(
      `SELECT COUNT(*) AS n FROM cells WHERE state IN ('pending', 'building')`,
    );
    if (open >= caps.maxPending) return this.outcome("backlog_full");

    this.sql.exec(
      `UPDATE cells SET state = 'pending', first_seen = ?, last_seen = ?, next_attempt = 0
       WHERE cell = ?`,
      now,
      now,
      input.cell,
    );
    this.sql.exec(`DELETE FROM tile_hits WHERE cell = ?`, input.cell);
    this.sql.exec(
      `UPDATE client_day SET cells = cells + 1 WHERE day = ? AND client = ?`,
      day,
      input.client,
    );
    this.bumpDay(day, "new_cells");
    return this.outcome("recorded");
  }

  /** True while the day's upstream-tile budget has room; spends one. */
  takeUpstream(cap: number, now: number = Date.now()): boolean {
    const day = dayOf(now);
    const used = this.count(
      `SELECT n FROM day_counters WHERE day = ? AND name = 'upstream_tiles'`,
      day,
    );
    if (used >= cap) {
      this.bump("upstream_budget_exhausted");
      return false;
    }
    this.bumpDay(day, "upstream_tiles");
    return true;
  }

  // ---- the builder's work queue -------------------------------------------

  private expire(cell: string, attempts: number, now: number): void {
    if (attempts >= MAX_ATTEMPTS) {
      this.sql.exec(
        `UPDATE cells SET state = 'dead', lease = NULL, last_error = 'lease expired' WHERE cell = ?`,
        cell,
      );
      this.bump("cells_dead");
    } else {
      const wait = BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)] ?? 300;
      this.sql.exec(
        `UPDATE cells SET state = 'pending', lease = NULL, next_attempt = ?, last_error = 'lease expired'
         WHERE cell = ?`,
        now + wait * 1000,
        cell,
      );
    }
  }

  claim(leaseSeconds: number, now: number = Date.now()): Claim | null {
    const seconds = Math.min(
      Math.max(Math.floor(leaseSeconds) || 0, 60),
      MAX_LEASE_SECONDS,
    );
    for (const lapsed of this.all<{ cell: string; attempts: number }>(
      `SELECT cell, attempts FROM cells WHERE state = 'building' AND lease_until < ?`,
      now,
    )) {
      this.expire(lapsed.cell, lapsed.attempts, now);
    }
    const row = this.first<{ cell: string; attempts: number }>(
      `SELECT cell, attempts FROM cells
       WHERE state = 'pending' AND next_attempt <= ? ORDER BY first_seen LIMIT 1`,
      now,
    );
    if (!row) return null;
    const lease = crypto.randomUUID();
    this.sql.exec(
      `UPDATE cells SET state = 'building', lease = ?, lease_until = ?, attempts = attempts + 1
       WHERE cell = ?`,
      lease,
      now + seconds * 1000,
      row.cell,
    );
    this.bump("claims");
    const cell = parseCell(row.cell)!;
    return {
      lease,
      cell: row.cell,
      bbox: cellBbox(cell),
      maxzoom: REGION_MAXZOOM,
      attempt: row.attempts + 1,
    };
  }

  fail(
    input: { lease: string; cell: string; error: string; permanent?: boolean },
    now: number = Date.now(),
  ): { ok: boolean; state?: string } {
    const row = this.first<{
      attempts: number;
      lease: string | null;
      state: string;
    }>(`SELECT attempts, lease, state FROM cells WHERE cell = ?`, input.cell);
    if (!row || row.state !== "building" || row.lease !== input.lease) {
      return { ok: false };
    }
    const error = input.error.slice(0, 300);
    if (input.permanent || row.attempts >= MAX_ATTEMPTS) {
      this.sql.exec(
        `UPDATE cells SET state = 'dead', lease = NULL, last_error = ? WHERE cell = ?`,
        error,
        input.cell,
      );
      this.bump("cells_dead");
      return { ok: true, state: "dead" };
    }
    const wait = BACKOFF[Math.min(row.attempts - 1, BACKOFF.length - 1)] ?? 300;
    this.sql.exec(
      `UPDATE cells SET state = 'pending', lease = NULL, next_attempt = ?, last_error = ?
       WHERE cell = ?`,
      now + wait * 1000,
      error,
      input.cell,
    );
    this.bump("build_failures");
    return { ok: true, state: "pending" };
  }

  /** Put a dead cell back in the queue (owner action). */
  rearm(cell: string, now: number = Date.now()): boolean {
    const row = this.first<{ state: string }>(
      `SELECT state FROM cells WHERE cell = ?`,
      cell,
    );
    if (row?.state !== "dead") return false;
    this.sql.exec(
      `UPDATE cells SET state = 'pending', attempts = 0, next_attempt = 0, last_seen = ?, last_error = NULL
       WHERE cell = ?`,
      now,
      cell,
    );
    return true;
  }

  /**
   * Verify the uploaded archive through R2, then publish it: one new manifest
   * version, written under conditions so a manual edit is never overwritten.
   * Idempotent for a cell already done with the same key.
   */
  async complete(input: CompleteInput): Promise<CompleteResult> {
    return this.ctx.blockConcurrencyWhile(() => this.completeLocked(input));
  }

  private async completeLocked(input: CompleteInput): Promise<CompleteResult> {
    const now = input.now ?? Date.now();
    const row = this.first<{
      state: string;
      lease: string | null;
      key: string | null;
    }>(`SELECT state, lease, key FROM cells WHERE cell = ?`, input.cell);
    if (!row) return { ok: false, error: "unknown_cell" };
    if (row.state === "done" && row.key === input.key) {
      return {
        ok: true,
        manifest_version: Number(this.meta("manifest_version") ?? 0),
      };
    }
    if (row.state !== "building" || row.lease !== input.lease) {
      return { ok: false, error: "lease_mismatch" };
    }
    if (!regionKeyMatchesCell(input.key, input.cell)) {
      return { ok: false, error: "bad_key" };
    }

    const checked = await this.verifyArchive(input.key, input.cell);
    if (!checked.ok) return checked;

    const bucket = this.env.MAPS_BUCKET;
    const mKey = manifestKey(this.env);
    const existing = await bucket.get(mKey);
    let base: Manifest = { version: 0, grid_zoom: 6, updated: "", regions: [] };
    let onlyIf: R2Conditional = { etagDoesNotMatch: "*" };
    if (existing) {
      const parsed = parseManifest(
        new TextDecoder().decode(
          await (existing as R2ObjectBody).arrayBuffer(),
        ),
      );
      if (!parsed) return { ok: false, error: "manifest_invalid" };
      base = parsed;
      onlyIf = { etagMatches: existing.etag };
    }
    const entry: RegionEntry = {
      cell: input.cell,
      key: input.key,
      build: input.build.slice(0, 16),
      bytes: checked.bytes,
      maxzoom: checked.maxzoom,
      built: new Date(now).toISOString(),
    };
    const next: Manifest = {
      ...base,
      version: base.version + 1,
      updated: entry.built,
      regions: [
        ...base.regions.filter((r) => r.cell !== input.cell),
        entry,
      ].sort((a, b) => a.cell.localeCompare(b.cell)),
    };
    if (input.upstream_url) {
      next.upstream = {
        url: input.upstream_url,
        build: input.build.slice(0, 16),
      };
    }
    const put = await bucket.put(mKey, JSON.stringify(next, null, 2), {
      httpMetadata: { contentType: "application/json" },
      onlyIf,
    });
    if (!put) return { ok: false, error: "manifest_conflict" };

    this.sql.exec(
      `UPDATE cells SET state = 'done', lease = NULL, key = ?, build = ?, bytes = ?, maxzoom = ?,
         built = ?, last_error = NULL WHERE cell = ?`,
      entry.key,
      entry.build,
      entry.bytes,
      entry.maxzoom,
      entry.built,
      entry.cell,
    );
    this.setMeta("manifest_version", String(next.version));
    this.bump("builds_ok");
    return { ok: true, manifest_version: next.version };
  }

  private async verifyArchive(
    key: string,
    cell: string,
  ): Promise<
    { ok: true; bytes: number; maxzoom: number } | { ok: false; error: string }
  > {
    try {
      const head = await this.env.MAPS_BUCKET.head(key);
      if (!head) return { ok: false, error: "archive_missing" };
      const h = await openArchiveUncached(this.env, key).getHeader();
      if (h.tileType !== TileType.Mvt) return { ok: false, error: "not_mvt" };
      if (h.tileCompression !== Compression.Gzip) {
        return { ok: false, error: "not_gzip" };
      }
      if (h.maxZoom > REGION_MAXZOOM || h.maxZoom < 12) {
        return { ok: false, error: "bad_maxzoom" };
      }
      const [w, s, e, n] = cellBbox(parseCell(cell)!);
      const m = 0.5;
      if (
        h.minLon < w - m ||
        h.maxLon > e + m ||
        h.minLat < s - m ||
        h.maxLat > n + m
      ) {
        return { ok: false, error: "bounds_outside_cell" };
      }
      if (h.numAddressedTiles < 1) return { ok: false, error: "empty_archive" };
      return { ok: true, bytes: head.size, maxzoom: h.maxZoom };
    } catch (err) {
      return {
        ok: false,
        error: `unreadable_archive: ${String(err).slice(0, 120)}`,
      };
    }
  }

  // ---- state -------------------------------------------------------------

  state(now: number = Date.now()): LedgerState {
    const byState: Record<string, number> = {};
    for (const r of this.all<{ state: string; n: number }>(
      `SELECT state, COUNT(*) AS n FROM cells GROUP BY state`,
    )) {
      byState[r.state] = Number(r.n);
    }
    const counters: Record<string, number> = {};
    for (const r of this.all<{ name: string; n: number }>(
      `SELECT name, n FROM totals`,
    )) {
      counters[r.name] = Number(r.n);
    }
    const day = dayOf(now);
    const today = (name: string): number =>
      this.count(
        `SELECT n FROM day_counters WHERE day = ? AND name = ?`,
        day,
        name,
      );
    return {
      pending: byState.pending ?? 0,
      building: byState.building ?? 0,
      observed: byState.observed ?? 0,
      done: byState.done ?? 0,
      dead: byState.dead ?? 0,
      manifest_version: Number(this.meta("manifest_version") ?? 0),
      stored_bytes: this.count(
        `SELECT COALESCE(SUM(bytes), 0) AS n FROM cells WHERE state = 'done'`,
      ),
      counters,
      today: {
        new_cells: today("new_cells"),
        upstream_tiles: today("upstream_tiles"),
      },
    };
  }
}
