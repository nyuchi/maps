import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The MapLibre GL JS version is the one pinned in the Worker's package.json:
// scripts/build-web.mjs vendors exactly that version at
// /assets/vendor/maplibre-gl/<version>/ and the pages import it from there.
const rootPkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const MAPLIBRE = rootPkg.devDependencies["maplibre-gl"];
if (!/^\d+\.\d+\.\d+$/.test(MAPLIBRE)) {
  throw new Error(`maplibre-gl must be pinned exactly, found "${MAPLIBRE}"`);
}
export const MAPLIBRE_BASE = `/assets/vendor/maplibre-gl/${MAPLIBRE}`;

// The icon seam: every `Icon.astro` import (ours and @bundu/ui's own) resolves
// to RadixIcon, so the whole site draws Radix icons. Mzizi names `lib/icons`
// as the one place to swap the icon set; this is that swap.
const RADIX = fileURLToPath(
  new URL("./src/components/RadixIcon.astro", import.meta.url),
);
const iconSeam = {
  name: "radix-icon-seam",
  enforce: "pre",
  resolveId(source) {
    return /(^|\/)Icon\.astro$/.test(source) ? RADIX : null;
  },
};

// `import ... from "maplibre-gl"` in our scripts is not bundled: it stays an
// import of the vendored, versioned module the build script copies, so there
// is exactly one MapLibre on the site and no third-party origin.
const maplibreExternal = {
  name: "maplibre-vendored",
  enforce: "pre",
  resolveId(source) {
    return source === "maplibre-gl"
      ? { id: `${MAPLIBRE_BASE}/maplibre-gl.mjs`, external: true }
      : null;
  },
};

export default defineConfig({
  output: "static",
  trailingSlash: "always",
  devToolbar: { enabled: false },
  compressHTML: true,
  build: {
    format: "directory",
    // Every emitted file is content-hashed and lives under /assets/site/,
    // which the Worker serves as immutable.
    assets: "assets/site",
    inlineStylesheets: "never",
  },
  vite: {
    plugins: [iconSeam, maplibreExternal, tailwindcss()],
    define: { __MAPLIBRE_BASE__: JSON.stringify(MAPLIBRE_BASE) },
    build: { assetsInlineLimit: 0 },
  },
});
