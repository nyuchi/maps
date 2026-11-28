// Status: live checks of this service, run from the visitor's browser. Each
// row is a real request to this origin and shows what came back; the page
// says plainly that it is a measurement from here, not a monitor.
import { getJson, tileForPoint } from "./tilejson.js";

const table = document.getElementById("checks");
const summary = document.getElementById("summary");
const again = document.getElementById("again");
const when = document.getElementById("when");

async function probe(name, path) {
  const started = performance.now();
  try {
    const res = await fetch(path, { cache: "no-store" });
    const ms = Math.round(performance.now() - started);
    const body = await res.arrayBuffer();
    return {
      name,
      path,
      ok: res.status === 200 || res.status === 204,
      status: res.status,
      ms,
      bytes: body.byteLength,
      cache: res.headers.get("cache-control"),
      type: res.headers.get("content-type"),
    };
  } catch (error) {
    return {
      name,
      path,
      ok: false,
      status: 0,
      ms: Math.round(performance.now() - started),
      error: String(error.message ?? error),
    };
  }
}

function row(r) {
  const tr = document.createElement("tr");
  // mzizi-spacing-exempt: on a desktop the cells carry the padding, the row carries none.
  tr.className = "block px-3.5 py-2.5 md:table-row md:p-0";
  const cells = [
    [r.name, r.path],
    [
      r.ok ? "Working" : r.status ? `Failed (${r.status})` : "Did not answer",
      null,
    ],
    [r.status ? `HTTP ${r.status}` : (r.error ?? "No response"), null],
    [`${r.ms} ms`, null],
    [r.cache ?? "Not set", null],
  ];
  cells.forEach(([text, sub], i) => {
    const td = document.createElement(i === 0 ? "th" : "td");
    if (i === 0) td.scope = "row";
    td.className =
      "flex items-baseline justify-between gap-4 py-1 text-start font-normal md:table-cell md:h-10 md:px-3.5 md:py-2 md:align-middle";
    const label = document.createElement("span");
    label.className = "text-caption text-muted-foreground md:hidden";
    label.setAttribute("aria-hidden", "true");
    label.textContent = [
      "Check",
      "Result",
      "Response",
      "Time",
      "Cache-Control",
    ][i];
    const value = document.createElement("span");
    value.className = "min-w-0 text-end md:text-start";
    if (i === 1) {
      const badge = document.createElement("span");
      badge.dataset.slot = "badge";
      badge.className = `inline-flex items-center rounded-sm px-3.5 py-px text-caption font-medium ${r.ok ? "bg-malachite-container text-malachite-on-container" : "bg-terracotta-container text-terracotta-on-container"}`;
      badge.textContent = text;
      value.append(badge);
    } else {
      value.textContent = text;
      if (i === 0) value.className += " font-medium";
      if (i === 4) value.className += " font-mono text-caption break-all";
    }
    if (sub) {
      const s = document.createElement("span");
      s.className =
        "block font-mono text-caption text-muted-foreground break-all";
      s.textContent = sub;
      value.append(s);
    }
    td.append(label, value);
    tr.append(td);
  });
  return tr;
}

async function run() {
  again.disabled = true;
  summary.textContent = "Checking…";
  const results = [];
  results.push(await probe("Health", "/health"));
  let tilePath = null;
  try {
    const tj = await getJson("/v1/tiles.json");
    results.push(await probe("TileJSON", "/v1/tiles.json"));
    const z = Math.min(tj.maxzoom, Math.max(tj.minzoom, 6));
    const [lng, lat] = tj.center ?? [0, 0];
    const t = tileForPoint(lng, lat, z);
    tilePath = `/v1/tiles/${t.z}/${t.x}/${t.y}.mvt`;
  } catch {
    results.push(await probe("TileJSON", "/v1/tiles.json"));
  }
  results.push(await probe("Light style", "/v1/styles/light.json"));
  results.push(await probe("Dark style", "/v1/styles/dark.json"));
  if (tilePath) results.push(await probe("A tile at the map centre", tilePath));
  table.replaceChildren(...results.map(row));
  const failed = results.filter((r) => !r.ok);
  summary.textContent =
    failed.length === 0
      ? `All ${results.length} checks passed.`
      : `${failed.length} of ${results.length} checks failed: ${failed.map((r) => r.name).join(", ")}.`;
  when.textContent = new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  again.disabled = false;
}

again.addEventListener("click", run);
run();
