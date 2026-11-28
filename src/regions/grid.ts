/**
 * The coverage grid: the z6 tile pyramid. A tile at zoom 6 or more belongs to
 * the z6 ancestor ("cell"); a request for any tile of a cell is demand for
 * that cell, so demand deduplicates by construction.
 */

export const GRID_ZOOM = 6;
/** Deepest zoom a region archive holds. */
export const REGION_MAXZOOM = 14;

export const CELL_RE = /^6\/(\d{1,2})\/(\d{1,2})$/;

export interface Cell {
  x: number;
  y: number;
}

export function cellId(c: Cell): string {
  return `${GRID_ZOOM}/${c.x}/${c.y}`;
}

/** Parse "6/x/y"; null when it is not a cell of the grid. */
export function parseCell(id: string): Cell | null {
  const m = CELL_RE.exec(id);
  if (!m) return null;
  const x = Number(m[1]);
  const y = Number(m[2]);
  const side = 2 ** GRID_ZOOM;
  return x < side && y < side ? { x, y } : null;
}

/** The cell of a tile at zoom `z` >= GRID_ZOOM. */
export function cellOf(z: number, x: number, y: number): Cell {
  const shift = z - GRID_ZOOM;
  return { x: Math.floor(x / 2 ** shift), y: Math.floor(y / 2 ** shift) };
}

const lon = (x: number): number => (x / 2 ** GRID_ZOOM) * 360 - 180;
const lat = (y: number): number => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** GRID_ZOOM;
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
};

/** [west, south, east, north] of a cell, in degrees. */
export function cellBbox(c: Cell): [number, number, number, number] {
  return [lon(c.x), lat(c.y + 1), lon(c.x + 1), lat(c.y)];
}
