// Prototype map: MapLibre GL JS (vendored) against the real Worker's styles.
import {
  Map as MapLibreMap, NavigationControl, ScaleControl, Marker,
} from "/vendor/maplibre-gl/maplibre-gl.mjs";

const dark = window.matchMedia("(prefers-color-scheme: dark)");
const maps = [];
for (const el of document.querySelectorAll("[data-map]")) {
  const base = el.dataset.base;
  const [lng, lat] = el.dataset.center.split(",").map(Number);
  let style = el.dataset.style === "auto" ? (dark.matches ? "dark" : "light") : el.dataset.style;
  const map = new MapLibreMap({
    container: el,
    style: `${base}/v1/styles/${style}.json`,
    center: [lng, lat],
    zoom: Number(el.dataset.zoom),
    maxPitch: 0,
    attributionControl: { compact: true },
    interactive: el.dataset.interactive !== "false",
  });
  if (el.dataset.controls !== "none") {
    map.addControl(new NavigationControl({ visualizePitch: false }), "top-right");
    map.addControl(new ScaleControl({ maxWidth: 100 }), "bottom-left");
  }
  for (const m of (el.dataset.markers ?? "").split(";").filter(Boolean)) {
    const [mlng, mlat] = m.split(",").map(Number);
    new Marker({ color: "#b8860b" }).setLngLat([mlng, mlat]).addTo(map);
  }
  if (el.dataset.coverage) {
    map.on("style.load", async () => {
      const data = await (await fetch(el.dataset.coverage)).json();
      if (!map.getSource("coverage")) map.addSource("coverage", { type: "geojson", data });
      if (!map.getLayer("coverage-fill")) {
        map.addLayer({ id: "coverage-fill", type: "fill", source: "coverage", paint: { "fill-color": "#b8860b", "fill-opacity": 0.14 } });
        map.addLayer({ id: "coverage-line", type: "line", source: "coverage", paint: { "line-color": "#b8860b", "line-width": 1.5 } });
      }
    });
  }
  maps.push({ el, map, base, get style() { return style; }, set(next) { style = next; map.setStyle(`${base}/v1/styles/${next}.json`); } });
  el.__maps = maps[maps.length - 1];
  const out = el.dataset.readout && document.querySelector(el.dataset.readout);
  if (out) {
    const upd = () => { const c = map.getCenter(); out.textContent = `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)} · z${map.getZoom().toFixed(1)}`; };
    map.on("moveend", upd); map.on("load", upd);
  }
}
// Style switches (native radios, so no framework): data-style-for="#id"
for (const input of document.querySelectorAll("input[data-style-for]")) {
  input.addEventListener("change", () => {
    const target = document.querySelector(input.dataset.styleFor);
    target?.__maps?.set(input.value);
  });
}
window.__mapsReady = () => maps.every((m) => m.map.loaded());
