// The Explorer: the live map. Plain JavaScript, no framework, no cookies, no
// third-party host. MapLibre GL JS is the vendored copy (see
// scripts/build-web.mjs); the dashboard theme switch drives light and dark.
import {
  GeolocateControl,
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
} from "maplibre-gl";
import {
  creditItems,
  formatBounds,
  formatName,
  getJson,
  renderCredits,
  tileExtension,
} from "./tilejson.js";

// Where the map opens: from Dakar in the west to the eastern edge of Indonesia,
// Cape Agulhas to Bizerte, so both areas the archive covers are in view. The
// archive covers Africa (with Madagascar and the nearby islands) and South East
// Asia (scripts/extract-regions.geojson); test/web.test.ts fails if this frame
// leaves the region file's bounding box. There is deliberately no maxBounds option:
// the map is allowed to look anywhere, and a place that is not stored is
// handled by the service, not by fencing the viewer in.
const AREA_FRAME = [
  [-18.0, -35.5],
  [141.5, 37.4],
];

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const currentTheme = () =>
  document.documentElement.dataset.theme ??
  (systemDark.matches ? "dark" : "light");

// ?lang=xx asks the styles for labels in that language (two or three letters,
// as /v1/styles accepts); anything else is ignored.
const langParam = new URLSearchParams(location.search).get("lang");
const lang = langParam && /^[a-z]{2,3}$/.test(langParam) ? langParam : null;
const styleUrl = (theme) =>
  `/v1/styles/${theme}.json${lang ? `?lang=${lang}` : ""}`;

const status = document.getElementById("status");
const statusText = document.getElementById("status-text");
const retry = document.getElementById("retry");
const readout = document.getElementById("readout");

let theme = currentTheme();
let loaded = false;

function showStatus(message) {
  statusText.textContent = message;
  status.hidden = false;
}

const map = new MapLibreMap({
  container: "map",
  style: styleUrl(theme),
  bounds: AREA_FRAME,
  fitBoundsOptions: { padding: 24 },
  maxPitch: 0,
  hash: true,
  // Credits come from the TileJSON the style points at; the page adds none.
  attributionControl: { compact: true },
});

// The credits start closed, behind the small (i): MapLibre's compact control
// opens itself on a wide screen, so close it here. One tap opens it again.
function closeCredits() {
  const credits = document.querySelector(".maplibregl-ctrl-attrib");
  if (credits) {
    credits.removeAttribute("open");
    credits.classList.remove("maplibregl-compact-show");
  }
}
closeCredits();
// MapLibre opens the control the first time the credits are known, which is
// after the style and the first tiles arrive, so close it again when the map
// first goes idle.
map.once("idle", closeCredits);

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

// The dashboard theme switch (and the system, until a choice is made) drives the map.
window.addEventListener("themechange", () => {
  const next = currentTheme();
  if (next === theme) return;
  theme = next;
  map.setStyle(styleUrl(theme));
});

function updateReadout() {
  const c = map.getCenter();
  readout.textContent = `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)} at zoom ${map.getZoom().toFixed(1)}`;
}
map.on("move", updateReadout);
updateReadout();

// "Copy link to this view": the page address already carries the view in its hash.
function updateViewUrl() {
  const el = document.getElementById("view-url");
  if (el) el.textContent = location.href;
}
map.on("moveend", () => setTimeout(updateViewUrl, 0));
updateViewUrl();

// Facts about the tiles, read from the service's own TileJSON.
const facts = document.getElementById("facts");
if (facts) {
  getJson("/v1/tiles.json")
    .then((tj) => {
      const set = (key, value) => {
        const el = facts.querySelector(`[data-fact="${key}"]`);
        if (el) el.textContent = value ?? "Not stated";
      };
      set("zoom", `${tj.minzoom} to ${tj.maxzoom}`);
      set("format", formatName(tileExtension(tj)));
      set("bounds", formatBounds(tj.bounds));
      const credits = facts.querySelector('[data-fact="credits"]');
      if (credits) renderCredits(credits, creditItems(tj.attribution));
    })
    .catch(() => {
      for (const el of facts.querySelectorAll("[data-fact]"))
        el.textContent = "Not available";
    });
}
if (lang) {
  const el = document.getElementById("lang-note");
  if (el) {
    el.textContent = `Labels in: ${lang}`;
    el.hidden = false;
  }
}
