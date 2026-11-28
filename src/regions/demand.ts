import { isOriginAllowed, parseAllowedOrigins } from "../cors";
import type { Env } from "../types";
import { capsFrom, ledgerName, logEvent } from "./config";
import type { DemandLedger, RecordOutcome } from "./ledger";

export function ledgerStub(env: Env): DurableObjectStub<DemandLedger> {
  const ns = env.DEMAND!;
  return ns.get(ns.idFromName(ledgerName(env)));
}

/**
 * Demand needs a browser of ours: an allow-listed Origin, or a same-origin
 * fetch (Sec-Fetch-Site) from the map page, which sends no Origin and, with
 * no-referrer, no Referer. A script can fake both, so this is one layer next
 * to the per-client and global caps in the ledger, not the defence.
 * DEMAND_REQUIRE_ORIGIN=0 turns the check off.
 */
export function mayCreateDemand(env: Env, headers: Headers): boolean {
  if (env.DEMAND_REQUIRE_ORIGIN === "0") return true;
  const origin = headers.get("Origin");
  if (
    origin &&
    isOriginAllowed(origin, parseAllowedOrigins(env.ALLOWED_ORIGINS))
  ) {
    return true;
  }
  return headers.get("Sec-Fetch-Site") === "same-origin";
}

/** Cells this isolate reported lately, so a busy cell is one call, not many. */
const recent = new Map<string, number>();
const RECENT_TTL_MS = 5 * 60_000;
const RECENT_MAX = 2000;

export function forgetRecentDemand(): void {
  recent.clear();
}

async function clientId(ip: string | undefined): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ip ?? "none"}|${day}`),
  );
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Record demand for one cell. Never throws: a ledger fault must not hurt a tile. */
export async function reportDemand(
  env: Env,
  input: { cell: string; tile: string; ip: string | undefined },
): Promise<RecordOutcome | "skipped"> {
  const now = Date.now();
  const memo = `${input.cell}|${input.tile}`;
  const until = recent.get(memo);
  if (until !== undefined && until > now) return "skipped";
  if (recent.size >= RECENT_MAX) recent.clear();
  recent.set(memo, now + RECENT_TTL_MS);
  try {
    const outcome = await ledgerStub(env).record(
      {
        cell: input.cell,
        tile: input.tile,
        client: await clientId(input.ip),
      },
      capsFrom(env),
    );
    logEvent("maps.demand", { outcome, cell: input.cell });
    return outcome;
  } catch (err) {
    recent.delete(memo);
    logEvent("maps.demand", {
      outcome: "error",
      cell: input.cell,
      error: String(err),
    });
    return "skipped";
  }
}
