// Overview: live service facts, read from this service's own /health and
// TileJSON. Nothing here is invented: when a read fails the page says so and
// shows "Not available", never a zero.
import {
  creditItems,
  formatBounds,
  formatCentre,
  formatName,
  getJson,
  renderCredits,
  tileExtension,
} from "./tilejson.js";

function tile(label) {
  for (const t of document.querySelectorAll('[data-slot="stat-tile"]')) {
    if (t.querySelector("dt")?.textContent.trim().startsWith(label)) return t;
  }
  return null;
}
function setTile(label, value, note) {
  const t = tile(label);
  if (!t) return;
  const v = t.querySelector("dd > span");
  if (v) v.textContent = value;
  const n = t.querySelectorAll("dd > span")[1];
  if (n && note !== undefined) n.textContent = note;
}
function setFact(key, value) {
  const el = document.querySelector(`[data-fact="${key}"]`);
  if (el) el.textContent = value ?? "Not stated";
}

// The TileJSON bounds as a dashed frame over the drawing of the stored areas.
function drawBounds(bounds) {
  const svg = document.getElementById("coverage-drawing");
  if (!svg || !Array.isArray(bounds) || bounds.length !== 4) return;
  const { west, north, scale, width, height } = Object.fromEntries(
    Object.entries(svg.dataset).map(([k, v]) => [k, Number(v)]),
  );
  const clamp = (v, max) => Math.min(max, Math.max(0, v));
  const [w, s, e, n] = bounds;
  const x0 = clamp((w - west) * scale, width);
  const x1 = clamp((e - west) * scale, width);
  const y0 = clamp((north - n) * scale, height);
  const y1 = clamp((north - s) * scale, height);
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("class", "frame");
  rect.setAttribute("x", String(x0));
  rect.setAttribute("y", String(y0));
  rect.setAttribute("width", String(Math.max(0, x1 - x0)));
  rect.setAttribute("height", String(Math.max(0, y1 - y0)));
  svg.append(rect);
}

async function health() {
  try {
    const h = await getJson("/health");
    if (h.status === "ok")
      setTile("Service", "Operational", "Answered /health just now");
    else
      setTile(
        "Service",
        "Degraded",
        `/health says: ${String(h.status).slice(0, 40)}`,
      );
  } catch (error) {
    setTile(
      "Service",
      "Unavailable",
      `/health did not answer (${error.message})`,
    );
  }
}

async function tilejson() {
  try {
    const tj = await getJson("/v1/tiles.json");
    const ext = tileExtension(tj);
    setTile(
      "Zoom levels",
      `${tj.minzoom} to ${tj.maxzoom}`,
      "From the TileJSON",
    );
    setTile(
      "Tile format",
      formatName(ext),
      tj.vector_layers
        ? `${tj.vector_layers.length} layers`
        : "From the TileJSON",
    );
    setTile(
      "Coverage",
      formatBounds(tj.bounds) ?? "Not stated",
      "West, south to east, north",
    );
    setFact("name", tj.name);
    setFact("version", tj.tilejson);
    setFact("scheme", tj.scheme);
    setFact("bounds", formatBounds(tj.bounds));
    setFact("centre", formatCentre(tj.center));
    setFact("template", Array.isArray(tj.tiles) ? tj.tiles[0] : null);
    const list = document.querySelector('[data-fact="credits"]');
    if (list) renderCredits(list, creditItems(tj.attribution));
    drawBounds(tj.bounds);
    document.getElementById("facts")?.removeAttribute("aria-busy");
  } catch (error) {
    for (const label of ["Zoom levels", "Tile format", "Coverage"]) {
      setTile(
        label,
        "Not available",
        `The TileJSON did not load (${error.message})`,
      );
    }
    for (const el of document.querySelectorAll("[data-fact]"))
      el.textContent = "Not available";
  }
}

health();
tilejson();
