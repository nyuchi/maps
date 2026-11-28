// The embed page (/embed/): one map, no chrome. Every parameter is validated
// numerically or against a short list; anything else is ignored, and nothing
// from the query string is ever inserted as markup. The credits are MapLibre's
// own attribution control reading the TileJSON: there is no parameter to hide
// them.
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
} from "maplibre-gl";

const AREA_FRAME = [
  [-18.0, -35.5],
  [141.5, 37.4],
];
const MAX_MARKERS = 50;
const params = new URLSearchParams(location.search);
const num = (value, min, max) => {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const lngLat = (text) => {
  const [lng, lat, ...rest] = text.split(",");
  if (rest.length || lng === undefined || lat === undefined) return null;
  const a = num(lng, -180, 180);
  const b = num(lat, -85, 85);
  return a === null || b === null ? null : [a, b];
};

const dark = matchMedia("(prefers-color-scheme: dark)");
const asked = params.get("style");
const styleName =
  asked === "light" || asked === "dark"
    ? asked
    : dark.matches
      ? "dark"
      : "light";
const langParam = params.get("lang");
const lang = langParam && /^[a-z]{2,3}$/.test(langParam) ? langParam : null;
const styleUrl = (name) =>
  `/v1/styles/${name}.json${lang ? `?lang=${lang}` : ""}`;
document.documentElement.dataset.theme = styleName;

const centre = params.has("center") ? lngLat(params.get("center")) : null;
const zoom = num(params.get("zoom"), 0, 22);
const options = {
  container: "map",
  style: styleUrl(styleName),
  maxPitch: 0,
  attributionControl: { compact: true },
};
if (centre) {
  options.center = centre;
  options.zoom = zoom ?? 11;
} else if (zoom !== null) {
  options.center = [
    (AREA_FRAME[0][0] + AREA_FRAME[1][0]) / 2,
    (AREA_FRAME[0][1] + AREA_FRAME[1][1]) / 2,
  ];
  options.zoom = zoom;
} else {
  options.bounds = AREA_FRAME;
  options.fitBoundsOptions = { padding: 24 };
}

const label = (params.get("label") ?? "").trim().slice(0, 100);
const mapEl = document.getElementById("map");
mapEl.setAttribute("aria-label", label || "Map");
if (label) document.title = `${label} · Nyuchi Maps`;

const map = new MapLibreMap(options);
if (params.get("controls") !== "0") {
  map.addControl(new NavigationControl({ visualizePitch: false }), "top-right");
}
map.addControl(new ScaleControl({ maxWidth: 100 }), "bottom-left");

for (const text of (params.get("markers") ?? "")
  .split("|")
  .filter(Boolean)
  .slice(0, MAX_MARKERS)) {
  const point = lngLat(text);
  if (point) new Marker({ color: "#b8860b" }).setLngLat(point).addTo(map);
}

// The credits start closed behind the (i), as on the Explorer.
function closeCredits() {
  const credits = document.querySelector(".maplibregl-ctrl-attrib");
  if (credits) {
    credits.removeAttribute("open");
    credits.classList.remove("maplibregl-compact-show");
  }
}
closeCredits();
map.once("idle", closeCredits);
