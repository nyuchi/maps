import { DEFAULT_TILES_KEY } from "./archive";
import type { Env } from "./types";

/**
 * A tile source is one PMTiles archive in the bucket. The Worker is built
 * for several: the base map is the only one today; a places overlay (for
 * example Kweli) would be a second archive, a second entry here and a second
 * var, with no change to the request path.
 */
export interface SourceDef {
  /** URL-safe id, used in `/v1/sources/{id}/...`. */
  readonly id: string;
  /** Name of the var holding this archive's object key (optional override). */
  readonly keyVar?: "TILES_KEY";
  /** Key used when there is no var, or it is unset. */
  readonly defaultKey: string;
  /** Ids from src/credits.ts shown for this source; all credits when unset. */
  readonly creditIds?: readonly string[];
}

export const DEFAULT_SOURCE_ID = "basemap";

export const SOURCES: Readonly<Record<string, SourceDef>> = {
  [DEFAULT_SOURCE_ID]: {
    id: DEFAULT_SOURCE_ID,
    keyVar: "TILES_KEY",
    defaultKey: DEFAULT_TILES_KEY,
  },
};

export function sourceKey(env: Env, def: SourceDef): string {
  return (def.keyVar && env[def.keyVar]) || def.defaultKey;
}
