/**
 * The ONE place attribution strings live.
 *
 * The TileJSON (`/v1/tiles.json`) is the only thing that carries them to a
 * map: the styles reference the tiles by `url` and add no attribution of
 * their own, so MapLibre shows each credit exactly once. Never write a
 * credit string anywhere else; add it here and `test/credits.test.ts`
 * checks it appears once.
 */

export interface Credit {
  /** Stable id, unique in the list. */
  readonly id: string;
  /** The text shown to people, unique in the list. */
  readonly text: string;
  /** Where the credit links to. */
  readonly url: string;
}

export const CREDITS: readonly Credit[] = [
  {
    id: "nyuchi-maps",
    text: "Nyuchi Maps",
    url: "https://maps.nyuchi.com",
  },
  {
    // Required by the ODbL for anything derived from OpenStreetMap.
    id: "osm",
    text: "© OpenStreetMap contributors",
    url: "https://www.openstreetmap.org/copyright",
  },
  // TODO(protomaps): add a Protomaps credit here ONLY if its terms ask for
  // one. As recorded when this was written, the Protomaps basemap downloads
  // name only OpenStreetMap attribution (the tiles are an ODbL Produced
  // Work), so no Protomaps credit is listed. Re-check
  // https://docs.protomaps.com/basemaps/downloads before the first public
  // release and whenever the build source changes.
];

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function select(ids?: readonly string[]): readonly Credit[] {
  return ids ? CREDITS.filter((c) => ids.includes(c.id)) : CREDITS;
}

/** HTML for TileJSON / MapLibre attribution controls (all credits by default). */
export function attributionHtml(ids?: readonly string[]): string {
  return select(ids)
    .map((c) => `<a href="${escapeHtml(c.url)}">${escapeHtml(c.text)}</a>`)
    .join(" | ");
}

/** Plain text, for logs and non-HTML consumers. */
export function attributionText(ids?: readonly string[]): string {
  return select(ids)
    .map((c) => c.text)
    .join(" | ");
}
