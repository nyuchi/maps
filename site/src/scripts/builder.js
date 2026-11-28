// Embed builder: turns the form into an embed URL, previews it in an iframe on
// THIS origin, and writes the iframe and script snippets. There is no key
// handling: keys arrive with the Maps API, and the only gate on who may frame
// the embed page is the frame-ancestors list the service itself sends, which
// this page reads and shows.
const form = document.getElementById("embed-form");
const preview = document.getElementById("preview");
const iframeOut = document.getElementById("iframe-code");
const scriptOut = document.getElementById("script-code");
const markersNote = document.getElementById("markers-note");
const ancestors = document.getElementById("ancestors");
const SITE = form.dataset.site;
const ELEMENT = form.dataset.element;
const MAX_MARKERS = 50;

let integrity = null;

const num = (value, min, max) => {
  const n = Number(value);
  return value !== "" && Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const esc = (text) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
const plain = (params) =>
  params.toString().replaceAll("%2C", ",").replaceAll("%7C", "|");

function values() {
  const data = new FormData(form);
  const lng = num(data.get("lng"), -180, 180);
  const lat = num(data.get("lat"), -85, 85);
  const zoom = num(data.get("zoom"), 0, 22);
  const height = num(data.get("height"), 120, 2000);
  const markers = [];
  let skipped = 0;
  for (const line of String(data.get("markers") ?? "").split("\n")) {
    const text = line.trim();
    if (!text) continue;
    const [a, b, ...rest] = text.split(",");
    const mlng = num((a ?? "").trim(), -180, 180);
    const mlat = num((b ?? "").trim(), -85, 85);
    if (
      rest.length ||
      mlng === null ||
      mlat === null ||
      markers.length >= MAX_MARKERS
    )
      skipped++;
    else markers.push(`${mlng},${mlat}`);
  }
  return {
    style: data.get("style") === "dark" ? "dark" : "light",
    lng,
    lat,
    zoom,
    height: height ?? 400,
    controls: data.get("controls") === "on",
    label: String(data.get("label") ?? "")
      .trim()
      .slice(0, 100),
    markers,
    skipped,
  };
}

function embedParams(v) {
  const q = new URLSearchParams();
  q.set("style", v.style);
  if (v.lng !== null && v.lat !== null) q.set("center", `${v.lng},${v.lat}`);
  if (v.zoom !== null) q.set("zoom", String(v.zoom));
  if (v.markers.length) q.set("markers", v.markers.join("|"));
  if (!v.controls) q.set("controls", "0");
  if (v.label) q.set("label", v.label);
  return q;
}

function render() {
  const v = values();
  const q = embedParams(v);
  // The preview uses this page's own origin, so it works wherever the page is.
  const src = `/embed/?${plain(q)}`;
  if (preview.getAttribute("src") !== src) preview.setAttribute("src", src);
  preview.style.height = `${v.height}px`;
  preview.title = v.label || "Preview of the embedded map";

  const title = esc(v.label || "Map");
  iframeOut.textContent = `<iframe\n  src="${esc(`${SITE}/embed/?${plain(q)}`)}"\n  width="100%" height="${v.height}"\n  loading="lazy"\n  title="${title}"></iframe>`;

  const attrs = [`style-name="${v.style}"`];
  if (v.lng !== null && v.lat !== null)
    attrs.push(`center="${v.lng},${v.lat}"`);
  if (v.zoom !== null) attrs.push(`zoom="${v.zoom}"`);
  if (v.markers.length) attrs.push(`markers="${v.markers.join("|")}"`);
  if (!v.controls) attrs.push(`controls="0"`);
  if (v.label) attrs.push(`label="${esc(v.label)}"`);
  attrs.push(`height="${v.height}"`);
  const sri = integrity
    ? ` integrity="${integrity}" crossorigin="anonymous"`
    : "";
  scriptOut.textContent = `<script type="module" src="${SITE}${ELEMENT}"${sri}></script>\n<nyuchi-map ${attrs.join(" ")}></nyuchi-map>`;

  markersNote.textContent = v.skipped
    ? `${v.skipped} marker line${v.skipped === 1 ? " was" : "s were"} ignored: write longitude,latitude, at most ${MAX_MARKERS} lines.`
    : "";
}

let timer = 0;
form.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(render, 200);
});
form.addEventListener("change", render);
form.addEventListener("submit", (event) => event.preventDefault());

// The subresource-integrity hash of the exact script file the snippet names.
async function computeIntegrity() {
  try {
    const res = await fetch(ELEMENT);
    if (!res.ok) return;
    const digest = await crypto.subtle.digest(
      "SHA-384",
      await res.arrayBuffer(),
    );
    integrity = `sha384-${btoa(String.fromCharCode(...new Uint8Array(digest)))}`;
    render();
  } catch {
    // Without the hash the snippet is still correct, just not pinned.
  }
}

// Who may put the embed page in a frame today: what the service says.
async function readAncestors() {
  try {
    const res = await fetch("/embed/");
    const csp = res.headers.get("content-security-policy") ?? "";
    const list =
      /(?:^|;)\s*frame-ancestors\s+([^;]*)/
        .exec(csp)?.[1]
        .trim()
        .split(/\s+/) ?? [];
    ancestors.replaceChildren(
      ...list.map((entry) => {
        const li = document.createElement("li");
        li.dataset.slot = "badge";
        li.className =
          "inline-flex items-center rounded-sm bg-muted px-3.5 py-px text-body-sm font-mono";
        li.textContent = entry === "'self'" ? "this site (the preview)" : entry;
        return li;
      }),
    );
  } catch {
    ancestors.textContent = "Not available: the embed page did not answer.";
  }
}

render();
computeIntegrity();
readAncestors();
