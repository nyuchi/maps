// Builds public/, the static assets the Worker serves with its ASSETS binding:
//
//   site/                                   the Astro dashboard and embed page
//   node_modules/maplibre-gl/dist/...       vendored, byte for byte
//
// The site is built by Astro 7 (site/, its own package.json and lockfile, so
// the Worker's install, tests and typecheck never need Astro). Its output is
// copied into public/ and COMMITTED, so a deploy needs no build step and
// `npm test` needs none either. `npm run check:web` rebuilds and fails if
// public/ is stale; CI runs it.
//
// Runtime: this script uses Node built-ins only and starts Astro with the same
// runtime it runs under, so it works unchanged under Deno 2
// (`deno run -A scripts/build-web.mjs`); Astro 7.4 builds byte-identically
// under both. The dependencies are installed with npm either way:
// `npm ci` and `npm ci --prefix site`.
//
// MapLibre files are copied into a folder named after the pinned version, so
// their URLs are immutable. Astro content-hashes every file it emits.
//
//   node scripts/build-web.mjs           write public/
//   node scripts/build-web.mjs --check   verify public/ is up to date

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "site");
const dist = join(site, "dist");
const out = join(root, "public");
const check = process.argv.includes("--check");

const read = (...parts) => readFileSync(join(root, ...parts));

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

// ---- Build the site with Astro ------------------------------------------

const astroBin = join(site, "node_modules", "astro", "bin", "astro.mjs");
if (!existsSync(astroBin)) {
  throw new Error("site/node_modules is missing: run `npm ci --prefix site`");
}
rmSync(dist, { recursive: true, force: true });
const underDeno = Boolean(process.versions.deno);
const run = spawnSync(
  process.execPath,
  [...(underDeno ? ["run", "-A"] : []), astroBin, "build"],
  {
    cwd: site,
    encoding: "utf8",
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1", NO_COLOR: "1" },
  },
);
if (run.status !== 0) {
  process.stderr.write(`${run.stdout ?? ""}${run.stderr ?? ""}`);
  throw new Error("astro build failed");
}

function listFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(join(dir, entry.name), base)
      : [relative(base, join(dir, entry.name)).split("\\").join("/")],
  );
}

/** @type {Map<string, Buffer | string>} path under public/ -> bytes */
const files = new Map();
for (const path of listFiles(dist))
  files.set(path, readFileSync(join(dist, path)));

// Drop emitted files nothing refers to. Mzizi's BrandMark imports the marks of
// every brand it knows (Kweli, Mukoko), but a page only uses one.
const text = (path) => [".html", ".js", ".css"].includes(extname(path));
const bodies = new Map(
  [...files]
    .filter(([path]) => text(path))
    .map(([path, b]) => [path, b.toString()]),
);
for (const path of [...files.keys()]) {
  if (!path.startsWith("assets/site/")) continue;
  const name = path.split("/").pop();
  const used = [...bodies].some(
    ([other, body]) => other !== path && body.includes(name),
  );
  if (!used) files.delete(path);
}

// The Content-Security-Policy has no 'unsafe-inline': fail early, here, if the
// build ever emits inline script, inline style or an inline handler.
for (const [path, body] of bodies) {
  if (!path.endsWith(".html")) continue;
  const scripts = body.match(/<script\b[^>]*>/gi) ?? [];
  for (const tag of scripts) {
    if (!/\ssrc=/.test(tag)) throw new Error(`${path}: inline <script> (CSP)`);
  }
  if (/<style\b/i.test(body)) throw new Error(`${path}: inline <style> (CSP)`);
  if (/\sstyle\s*=/i.test(body))
    throw new Error(`${path}: style attribute (CSP)`);
  if (/\son[a-z]+\s*=/i.test(body))
    throw new Error(`${path}: inline handler (CSP)`);
}

// ---- MapLibre, vendored --------------------------------------------------

const vendor = `assets/vendor/maplibre-gl/${pinned}`;
const mapDist = ["node_modules", "maplibre-gl", "dist"];
for (const name of [
  "maplibre-gl.mjs",
  "maplibre-gl-worker.mjs",
  "maplibre-gl.css",
]) {
  files.set(`${vendor}/${name}`, read(...mapDist, name));
}
// BSD-3-Clause asks that binary redistributions carry the licence text.
files.set(
  `${vendor}/LICENSE.txt`,
  read("node_modules", "maplibre-gl", "LICENSE.txt"),
);

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
