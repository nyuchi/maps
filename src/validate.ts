/**
 * Input validation. Every path piece that reaches R2 or the PMTiles reader
 * is matched against a strict pattern first, so nothing user-supplied can
 * form a different object key (no "..", no "/", no encoded separators).
 */

export const MAX_ZOOM = 22;

const INT = /^(0|[1-9]\d{0,7})$/;
const TILE_FILE = /^(0|[1-9]\d{0,7})\.(mvt|png|jpg|webp|avif|mlt)$/;
const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const SPRITE_FILE = /^([a-z][a-z0-9-]{0,31})(@2x)?\.(json|png)$/;
const STYLE_FILE = /^([a-z][a-z0-9-]{0,31})\.json$/;
const FONT_NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;
const FONT_RANGE = /^(\d{1,5})-(\d{1,5})\.pbf$/;
const LANG = /^[a-z]{2,3}$/;

export interface TileRequest {
  z: number;
  x: number;
  y: number;
  ext: string;
}

/** Parse z / x / "y.ext". Returns null when anything is out of range. */
export function parseTile(
  z: string,
  x: string,
  file: string,
): TileRequest | null {
  const f = TILE_FILE.exec(file);
  if (!f || !INT.test(z) || !INT.test(x)) return null;
  const zn = Number(z);
  const xn = Number(x);
  const yn = Number(f[1]);
  if (zn > MAX_ZOOM) return null;
  const side = 2 ** zn;
  if (xn >= side || yn >= side) return null;
  return { z: zn, x: xn, y: yn, ext: f[2]! };
}

export function parseStyleFile(file: string): string | null {
  const m = STYLE_FILE.exec(file);
  return m ? m[1]! : null;
}

export function isName(name: string): boolean {
  return NAME.test(name);
}

export interface SpriteRequest {
  name: string;
  retina: boolean;
  ext: "json" | "png";
}

export function parseSpriteFile(file: string): SpriteRequest | null {
  const m = SPRITE_FILE.exec(file);
  if (!m) return null;
  return { name: m[1]!, retina: m[2] === "@2x", ext: m[3] as "json" | "png" };
}

/** A font stack is 1 to 4 comma-separated font names. */
export function parseFontStack(stack: string): string[] | null {
  const names = stack.split(",");
  if (names.length < 1 || names.length > 4) return null;
  return names.every((n) => FONT_NAME.test(n)) ? names : null;
}

/** "0-255.pbf" -> "0-255". Start must not exceed end. */
export function parseFontRange(file: string): string | null {
  const m = FONT_RANGE.exec(file);
  if (!m) return null;
  return Number(m[1]) <= Number(m[2]) ? `${m[1]}-${m[2]}` : null;
}

export function parseLang(value: string | undefined): string | null {
  if (value === undefined || value === "") return "en";
  return LANG.test(value) ? value : null;
}
