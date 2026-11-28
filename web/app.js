// Nyuchi Maps page. Plain JavaScript, no framework, no cookies, no third-party
// host: MapLibre GL JS is vendored next to this file (see scripts/build-web.mjs,
// which also fills in the version token below and hashes this file's name).
import {
  GeolocateControl,
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
} from "./vendor/maplibre-gl/@MAPLIBRE_VERSION@/maplibre-gl.mjs";

// The area the archive covers: the bounding box of scripts/extract-regions.geojson
// (all of Africa, Madagascar and the nearby islands). test/web.test.ts fails if
// this drifts from the region file.
const AFRICA_BOUNDS = [
  [-26.5, -35.5],
  [64.5, 37.6],
];
// Where the map opens: mainland Africa, west to Dakar and east to the Horn.
const AFRICA_FRAME = [
  [-18.0, -35.5],
  [52.0, 37.4],
];

const THEME_KEY = "nyuchi-maps-theme";
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

// The saved choice lives in localStorage, never in a cookie. If storage is
// unavailable the page still works: it just follows the system each visit.
function savedTheme() {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function saveTheme(value) {
  try {
    window.localStorage.setItem(THEME_KEY, value);
  } catch {
    // Storage is blocked: the choice lasts for this visit only.
  }
}

let choice = savedTheme(); // null means follow the system
const currentTheme = () => choice ?? (systemDark.matches ? "dark" : "light");
const styleUrl = (theme) => `/v1/styles/${theme}.json`;

const toggle = document.getElementById("theme");
const status = document.getElementById("status");
const statusText = document.getElementById("status-text");
const retry = document.getElementById("retry");

let theme = currentTheme();
document.documentElement.dataset.theme = theme;
toggle.setAttribute("aria-checked", String(theme === "dark"));

let loaded = false;

function showStatus(message) {
  statusText.textContent = message;
  status.hidden = false;
}

const map = new MapLibreMap({
  container: "map",
  style: styleUrl(theme),
  bounds: AFRICA_FRAME,
  fitBoundsOptions: { padding: 24 },
  maxBounds: AFRICA_BOUNDS,
  maxPitch: 0,
  hash: true,
  // Credits come from the TileJSON the style points at; the page adds none.
  attributionControl: { compact: false },
});

map.addControl(new NavigationControl({ visualizePitch: false }), "top-right");
map.addControl(
  new GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    fitBoundsOptions: { maxZoom: 14 },
    showAccuracyCircle: false,
  }),
  "top-right",
);
map.addControl(new ScaleControl({ maxWidth: 120 }), "bottom-left");

map.on("load", () => {
  loaded = true;
  status.hidden = true;
});

map.on("error", (event) => {
  // A tile that is missing is normal at the edges; only say something when
  // the map never drew at all (the style or its TileJSON failed to load).
  if (!loaded) {
    showStatus("The map could not load. Check your connection and try again.");
  } else if (event?.error) {
    console.warn("map:", event.error.message ?? event.error);
  }
});

retry.addEventListener("click", () => {
  status.hidden = true;
  map.setStyle(styleUrl(theme));
});

function applyTheme(next) {
  if (next === theme) return;
  theme = next;
  document.documentElement.dataset.theme = theme;
  toggle.setAttribute("aria-checked", String(theme === "dark"));
  map.setStyle(styleUrl(theme));
}

toggle.addEventListener("click", () => {
  choice = theme === "dark" ? "light" : "dark";
  saveTheme(choice);
  applyTheme(choice);
});

// Until the person chooses, follow the system as it changes.
systemDark.addEventListener("change", () => {
  if (choice === null) applyTheme(currentTheme());
});
