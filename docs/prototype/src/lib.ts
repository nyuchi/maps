// Sample data for the prototype. Every number here is fake and labelled as such on the page.
/** Where the prototype draws its maps from (the origin Worker run locally). The pages DISPLAY the API URLs. */
export const BASE = "http://localhost:8787";
/** The one public API. Maps is a namespace of it (/v1/maps). */
export const API = "https://api.nyuchi.com/v1/maps";
/** This site: the dashboard, the embed page and the tile origin behind the API. */
export const SITE = "https://maps.nyuchi.com";
export const KEY = "nyk_EXAMPLE_ONLY";

/** Deterministic pseudo-random series so screenshots are stable. */
export function series(
  n: number,
  base: number,
  wobble: number,
  seed = 7,
): number[] {
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  return Array.from({ length: n }, (_, i) =>
    Math.round(
      base * (1 + 0.35 * Math.sin(i / 3.1) + (i / n) * 0.5) +
        (rnd() - 0.5) * wobble,
    ),
  );
}
const DAY = 86400000;
export function days(
  n: number,
  fromIso = "2026-10-30",
): { label: string; long: string }[] {
  const start = new Date(fromIso).getTime();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(start + i * DAY);
    return {
      label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      long: d.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    };
  });
}

export const NAV = [
  {
    href: "/",
    label: "Overview",
    icon: "home",
    group: "Maps",
    description: "Health, usage and coverage at a glance",
  },
  {
    href: "/explorer/",
    label: "Explorer",
    icon: "map-pin",
    group: "Build",
    description: "A live preview of the base map",
  },
  {
    href: "/embed/",
    label: "Embed builder",
    icon: "code",
    group: "Build",
    description: "Iframe and script snippets with a live preview",
  },
  {
    href: "/endpoints/",
    label: "Endpoints",
    icon: "terminal",
    group: "Build",
    description: "TileJSON, tiles, styles, glyphs and sprites, with snippets",
  },
  {
    href: "/keys/",
    label: "API keys",
    icon: "key",
    group: "Manage",
    description: "Publishable and secret keys, allowed origins, limits",
  },
  {
    href: "/usage/",
    label: "Usage",
    icon: "chart",
    group: "Manage",
    description: "Requests, bytes, cache hits and errors",
  },
  {
    href: "/coverage/",
    label: "Coverage",
    icon: "layers",
    group: "Manage",
    description: "Stored regions and on-demand builds",
  },
  {
    href: "https://docs.nyuchi.com",
    label: "Documentation",
    icon: "book",
    group: "Learn",
    description: "OpenAPI, tile contract, attribution",
  },
  {
    href: "https://status.nyuchi.com",
    label: "Status",
    icon: "activity",
    group: "Learn",
    description: "Service status",
  },
] as const;
