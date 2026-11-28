// The areas the archive is built to cover, from scripts/extract-regions.geojson
// (the file the extract is cut with), read at build time. Nothing is typed in
// by hand: change the file and the dashboard follows.
import regionsText from "../../../scripts/extract-regions.geojson?raw";

interface Feature {
  properties: { name: string };
  geometry: { type: "Polygon"; coordinates: number[][][] };
}

export interface Area {
  name: string;
  /** west, south, east, north */
  bounds: [number, number, number, number];
  /** Exterior ring, [lng, lat] pairs. */
  ring: [number, number][];
}

const features = (JSON.parse(regionsText) as { features: Feature[] }).features;

export const AREAS: Area[] = features.map((f) => {
  const ring = f.geometry.coordinates[0] as [number, number][];
  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return {
    name: f.properties.name,
    bounds: [
      Math.min(...lngs),
      Math.min(...lats),
      Math.max(...lngs),
      Math.max(...lats),
    ],
    ring,
  };
});

/** Equirectangular drawing of the areas on a grid of whole 10-degree steps. */
export function drawing() {
  const scale = 4;
  const west =
    Math.floor(Math.min(...AREAS.map((a) => a.bounds[0])) / 10) * 10 - 10;
  const east =
    Math.ceil(Math.max(...AREAS.map((a) => a.bounds[2])) / 10) * 10 + 10;
  const south =
    Math.floor(Math.min(...AREAS.map((a) => a.bounds[1])) / 10) * 10 - 10;
  const north =
    Math.ceil(Math.max(...AREAS.map((a) => a.bounds[3])) / 10) * 10 + 10;
  const x = (lng: number) => +((lng - west) * scale).toFixed(1);
  const y = (lat: number) => +((north - lat) * scale).toFixed(1);
  const paths = AREAS.map((a) => ({
    name: a.name,
    d:
      a.ring
        .map(([lng, lat], i) => `${i ? "L" : "M"}${x(lng)} ${y(lat)}`)
        .join("") + "Z",
  }));
  const meridians: number[] = [];
  for (let lng = west; lng <= east; lng += 10) meridians.push(lng);
  const parallels: number[] = [];
  for (let lat = south; lat <= north; lat += 10) parallels.push(lat);
  return {
    width: (east - west) * scale,
    height: (north - south) * scale,
    west,
    north,
    scale,
    paths,
    lines: [
      ...meridians.map((lng) => `M${x(lng)} 0V${(north - south) * scale}`),
      ...parallels.map((lat) => `M0 ${y(lat)}H${(east - west) * scale}`),
    ].join(""),
  };
}

export function formatBounds([w, s, e, n]: Area["bounds"]): string {
  const f = (v: number) => String(Math.round(v * 100) / 100);
  return `${f(w)}, ${f(s)} to ${f(e)}, ${f(n)}`;
}
