// Shared by the pages that read the service's own TileJSON and health.

/** GET a same-origin JSON document; throws with the HTTP status on failure. */
export async function getJson(path) {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const MVT = "mvt";

/** "mvt" from ".../{z}/{x}/{y}.mvt". */
export function tileExtension(tilejson) {
  const url = Array.isArray(tilejson.tiles) ? tilejson.tiles[0] : "";
  const match = /\.([a-z0-9]+)(?:\?|$)/i.exec(url ?? "");
  return match ? match[1].toLowerCase() : null;
}

export function formatName(ext) {
  if (ext === "mvt") return "Vector tiles (MVT)";
  if (ext === "pbf") return "Vector tiles (PBF)";
  if (ext === "png" || ext === "jpg" || ext === "webp")
    return `Raster tiles (${ext.toUpperCase()})`;
  return ext ? ext.toUpperCase() : "Not stated";
}

const num = (n, digits) =>
  Number(n)
    .toFixed(digits)
    .replace(/\.?0+$/, "");

export function formatBounds(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4) return null;
  const [w, s, e, n] = bounds;
  return `${num(w, 2)}, ${num(s, 2)} to ${num(e, 2)}, ${num(n, 2)}`;
}

export function formatCentre(center) {
  if (!Array.isArray(center) || center.length < 2) return null;
  const [lng, lat, z] = center;
  const zoom = Number.isFinite(z) ? ` at zoom ${num(z, 0)}` : "";
  return `${num(lat, 3)}, ${num(lng, 3)}${zoom}`;
}

/**
 * The credit links in a TileJSON `attribution` string, as data. The string is
 * HTML from the service; only <a> elements with an https link become links and
 * everything else is plain text, so nothing from it is ever inserted as markup.
 */
export function creditItems(attribution) {
  if (typeof attribution !== "string" || attribution.trim() === "") return [];
  const doc = new DOMParser().parseFromString(attribution, "text/html");
  const items = [];
  for (const a of doc.querySelectorAll("a")) {
    const text = a.textContent.trim();
    if (!text) continue;
    let href = null;
    try {
      const url = new URL(a.getAttribute("href") ?? "", location.href);
      if (url.protocol === "https:") href = url.href;
    } catch {
      // Not a URL: shown as text.
    }
    items.push({ text, href });
  }
  if (items.length === 0)
    items.push({ text: doc.body.textContent.trim(), href: null });
  return items;
}

/** Fill a list element with credit links (textContent and href only). */
export function renderCredits(list, items) {
  list.replaceChildren(
    ...items.map(({ text, href }) => {
      const li = document.createElement("li");
      if (href) {
        const a = document.createElement("a");
        a.href = href;
        a.textContent = text;
        a.className = "underline underline-offset-4";
        li.append(a);
      } else {
        li.textContent = text;
      }
      return li;
    }),
  );
}

/** The z/x/y of the tile that holds a point, for a quick tile check. */
export function tileForPoint(lng, lat, z) {
  const n = 2 ** z;
  const x = Math.min(n - 1, Math.max(0, Math.floor(((lng + 180) / 360) * n)));
  const rad = (lat * Math.PI) / 180;
  const y = Math.min(
    n - 1,
    Math.max(
      0,
      Math.floor(
        ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
      ),
    ),
  );
  return { z, x, y };
}
