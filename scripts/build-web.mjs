// Builds public/, the static assets the Worker serves with its ASSETS binding:
//
//   web/index.html, app.js, app.css, favicon.svg, robots.txt   (our files)
//   node_modules/maplibre-gl/dist/...                           (vendored)
//
// Output goes to public/ and is COMMITTED, so a deploy needs no build step and
// `npm test` needs none either. `npm run check:web` rebuilds in memory and
// fails if public/ is stale; CI runs it.
//
// MapLibre files are copied byte for byte into a folder named after the
// pinned version, so their URLs are immutable. Our own app.js and app.css get
// a content hash in the file name. Plain Node built-ins only: the script also
// runs unchanged under Deno (`deno run -A scripts/build-web.mjs`).
//
//   node scripts/build-web.mjs           write public/
//   node scripts/build-web.mjs --check   verify public/ is up to date

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public");
const check = process.argv.includes("--check");

const read = (...parts) => readFileSync(join(root, ...parts));
const hash = (bytes) =>
  createHash("sha256").update(bytes).digest("hex").slice(0, 10);

// The pinned version is the one in package.json (exact, no range) and must be
// the one installed: a stale node_modules must never be vendored by mistake.
const pkg = JSON.parse(read("package.json").toString());
const pinned = pkg.devDependencies["maplibre-gl"];
const installed = JSON.parse(
  read("node_modules", "maplibre-gl", "package.json").toString(),
).version;
if (!/^\d+\.\d+\.\d+$/.test(pinned)) {
  throw new Error(`maplibre-gl must be pinned exactly, found "${pinned}"`);
}
if (installed !== pinned) {
  throw new Error(
    `node_modules has maplibre-gl ${installed}, expected ${pinned}: run npm ci`,
  );
}

/** @type {Map<string, Buffer | string>} path under public/ -> bytes */
const files = new Map();

const vendor = `assets/vendor/maplibre-gl/${pinned}`;
const dist = ["node_modules", "maplibre-gl", "dist"];
for (const name of [
  "maplibre-gl.mjs",
  "maplibre-gl-worker.mjs",
  "maplibre-gl.css",
]) {
  files.set(`${vendor}/${name}`, read(...dist, name));
}
// BSD-3-Clause asks that binary redistributions carry the licence text.
files.set(
  `${vendor}/LICENSE.txt`,
  read("node_modules", "maplibre-gl", "LICENSE.txt"),
);

const appJs = read("web", "app.js")
  .toString()
  .replaceAll("@MAPLIBRE_VERSION@", pinned);
const appJsPath = `assets/app.${hash(appJs)}.js`;
files.set(appJsPath, appJs);

const appCss = read("web", "app.css");
const appCssPath = `assets/app.${hash(appCss)}.css`;
files.set(appCssPath, appCss);

const html = read("web", "index.html")
  .toString()
  .replaceAll("{{app.js}}", `/${appJsPath}`)
  .replaceAll("{{app.css}}", `/${appCssPath}`)
  .replaceAll("{{maplibre.mjs}}", `/${vendor}/maplibre-gl.mjs`)
  .replaceAll("{{maplibre.css}}", `/${vendor}/maplibre-gl.css`);
if (html.includes("{{")) throw new Error("unfilled token in index.html");
files.set("index.html", html);

files.set("favicon.svg", read("web", "favicon.svg"));
files.set("robots.txt", read("web", "robots.txt"));

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(join(dir, entry.name))
      : [relative(out, join(dir, entry.name)).split("\\").join("/")],
  );
}

if (check) {
  const problems = [];
  const present = new Set(listFiles(out));
  for (const [path, bytes] of files) {
    const target = join(out, path);
    if (!present.has(path)) problems.push(`missing: public/${path}`);
    else if (!readFileSync(target).equals(Buffer.from(bytes))) {
      problems.push(`stale: public/${path}`);
    }
  }
  for (const path of present) {
    if (!files.has(path)) problems.push(`unexpected: public/${path}`);
  }
  if (problems.length) {
    console.error(problems.join("\n"));
    console.error(
      "public/ is out of date: run `npm run build:web` and commit it.",
    );
    process.exit(1);
  }
  console.log(
    `public/ is up to date (${files.size} files, maplibre-gl ${pinned})`,
  );
} else {
  rmSync(out, { recursive: true, force: true });
  for (const [path, bytes] of files) {
    const target = join(out, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  console.log(`wrote public/ (${files.size} files, maplibre-gl ${pinned})`);
}
