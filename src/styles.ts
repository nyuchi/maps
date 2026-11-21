import { layers, namedFlavor } from "@protomaps/basemaps";

/** Style names this service publishes, and the Protomaps flavor behind each. */
export const STYLES: Readonly<Record<string, string>> = {
  light: "light",
  dark: "dark",
};

export const STYLE_NAMES = Object.keys(STYLES);

/**
 * Build a MapLibre style that references OUR tiles, glyphs and sprite only.
 *
 * The vector source carries `url` and nothing else: attribution reaches the
 * map from the TileJSON, so the credits (src/credits.ts) show exactly once.
 * No third-party host appears anywhere in the output.
 */
export function buildStyle(
  name: string,
  base: string,
  lang: string,
): Record<string, unknown> | null {
  const flavor = STYLES[name];
  if (!flavor) return null;
  return {
    version: 8,
    name: `Nyuchi basemap ${name}`,
    sources: {
      protomaps: { type: "vector", url: `${base}/v1/tiles.json` },
    },
    glyphs: `${base}/v1/fonts/{fontstack}/{range}.pbf`,
    sprite: `${base}/v1/sprites/${name}`,
    layers: layers("protomaps", namedFlavor(flavor), { lang }),
  };
}
