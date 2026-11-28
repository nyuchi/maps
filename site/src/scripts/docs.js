// Docs: the contract, rendered from what this service actually serves.
// The OpenAPI document, the credit line and the tile response headers are all
// read live; nothing about them is copied into the page.
import {
  creditItems,
  getJson,
  renderCredits,
  tileForPoint,
} from "./tilejson.js";

const h = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

// ---- The credit line, from the TileJSON ----
async function credits(tj) {
  const list = document.getElementById("credit-live");
  if (list) renderCredits(list, creditItems(tj.attribution));
}

// ---- A real tile response, with its headers ----
async function tileHeaders(tj) {
  const box = document.getElementById("tile-headers");
  if (!box) return;
  const z = Math.min(tj.maxzoom, Math.max(tj.minzoom, 6));
  const [lng, lat] = tj.center ?? [0, 0];
  const t = tileForPoint(lng, lat, z);
  const path = `/v1/tiles/${t.z}/${t.x}/${t.y}.mvt`;
  try {
    const res = await fetch(path);
    await res.arrayBuffer();
    const rows = [
      ["Request", `GET ${path}`],
      ["Status", String(res.status)],
      ...[
        "content-type",
        "content-encoding",
        "cache-control",
        "etag",
        "vary",
      ].map((n) => [n, res.headers.get(n) ?? "not set"]),
    ];
    box.replaceChildren(
      ...rows.flatMap(([k, v]) => [
        h("dt", "text-caption text-muted-foreground", k),
        h("dd", "font-mono text-body-sm break-all", v),
      ]),
    );
  } catch {
    box.replaceChildren(
      h("dd", "text-body-sm", "The sample tile could not be read."),
    );
  }
}

// ---- The OpenAPI document ----
function operation(path, method, op) {
  const d = h("details", "rounded-md border border-border bg-card");
  const s = h(
    "summary",
    "flex min-h-8 cursor-pointer flex-wrap items-center gap-x-3 gap-y-[7px] px-3.5 py-2 pointer-coarse:min-h-11",
  );
  s.append(
    h(
      "span",
      "inline-flex rounded-sm bg-muted px-3.5 text-caption font-semibold uppercase",
      method,
    ),
    h("code", "font-mono text-body-sm break-all", path),
  );
  if (op.summary)
    s.append(h("span", "text-body-sm text-muted-foreground", op.summary));
  d.append(s);
  const body = h("div", "grid gap-[14px] border-t border-border p-3.5");
  if (op.description)
    body.append(
      h("p", "text-body-sm whitespace-pre-line", op.description.trim()),
    );
  const params = op.parameters ?? [];
  if (params.length) {
    body.append(h("h4", "text-body-sm font-semibold", "Parameters"));
    const dl = h("dl", "grid gap-[14px]");
    for (const p of params) {
      const dt = h(
        "dt",
        "font-mono text-body-sm",
        `${p.name}${p.required ? " (required)" : ""}`,
      );
      const dd = h(
        "dd",
        "text-body-sm text-muted-foreground",
        `${p.in}${p.schema?.type ? `, ${p.schema.type}` : ""}${p.description ? `. ${p.description}` : ""}`,
      );
      dl.append(dt, dd);
    }
    body.append(dl);
  }
  body.append(h("h4", "text-body-sm font-semibold", "Responses"));
  const ul = h("ul", "grid gap-[14px]");
  ul.setAttribute("role", "list");
  for (const [code, r] of Object.entries(op.responses ?? {})) {
    const li = h("li", "flex flex-wrap items-baseline gap-x-3 text-body-sm");
    li.append(
      h("code", "font-mono font-semibold", code),
      h("span", "text-muted-foreground", r.description ?? ""),
    );
    ul.append(li);
  }
  body.append(ul);
  d.append(body);
  return d;
}

async function openapi() {
  const target = document.getElementById("openapi");
  const head = document.getElementById("openapi-head");
  try {
    const doc = await getJson("/openapi.json");
    head.textContent =
      `${doc.info?.title ?? "API"} ${doc.info?.version ?? ""}, OpenAPI ${doc.openapi}`.trim();
    const items = [];
    for (const [path, ops] of Object.entries(doc.paths ?? {})) {
      for (const method of ["get", "head", "post", "put", "delete", "patch"]) {
        if (ops[method]) items.push(operation(path, method, ops[method]));
      }
    }
    target.replaceChildren(...items);
    target.removeAttribute("aria-busy");
  } catch (error) {
    target.replaceChildren(
      h(
        "p",
        "text-body-sm",
        `The OpenAPI document did not load (${error.message}). It is at /openapi.json.`,
      ),
    );
  }
}

openapi();
getJson("/v1/tiles.json").then(
  (tj) => {
    credits(tj);
    tileHeaders(tj);
  },
  () => {
    const list = document.getElementById("credit-live");
    if (list)
      list.replaceChildren(
        h("li", "", "Not available: the TileJSON did not load."),
      );
  },
);
