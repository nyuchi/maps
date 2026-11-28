// Live preview wiring for the embed builder form (prototype only).
const f = document.getElementById("embed-form");
if (f) {
  const map = () => document.getElementById("embed-map")?.__maps?.map;
  const apply = () => {
    const m = map(); if (!m) return;
    const v = Object.fromEntries(new FormData(f));
    const el = document.getElementById("embed-map");
    el.__maps.set(v.style);
    m.jumpTo({ center: [Number(v.lng), Number(v.lat)], zoom: Number(v.zoom) });
  };
  f.addEventListener("change", apply);
}
