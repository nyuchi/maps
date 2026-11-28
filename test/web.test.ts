import { SELF, env as workerEnv } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import embedJs from "../site/src/scripts/embed.js?raw";
import explorerJs from "../site/src/scripts/explorer.js?raw";
import shellJs from "../site/src/scripts/shell.js?raw";
import pkgText from "../package.json?raw";
import regions from "../scripts/extract-regions.geojson?raw";
import {
  CACHE_HTML,
  CACHE_IMMUTABLE,
  CACHE_STATIC,
  CSP,
  PAGES,
  embedCsp,
  frameSources,
} from "../src/web";
import { ALLOWED, StubBucket, call, makeEnv, stubAssets } from "./helpers";

// Every file the dashboard is written in (not the generated icon table).
const SOURCES = import.meta.glob("../site/src/**/*.{astro,js,ts,css}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const PAGE = '<!doctype html><html lang="en"><title>x</title>';
const HASHED = "/assets/site/index.KHH-TZfI.css";
const VERSIONED = "/assets/vendor/maplibre-gl/6.19.0/maplibre-gl.mjs";
const MAPLIBRE = (
  JSON.parse(pkgText) as { devDependencies: Record<string, string> }
).devDependencies["maplibre-gl"]!;

function envWithAssets(overrides: Record<string, string> = {}) {
  const pages = Object.fromEntries([...PAGES, "/embed/"].map((p) => [p, PAGE]));
  return makeEnv(new StubBucket(), {
    ...overrides,
    ASSETS: stubAssets({
      ...pages,
      [HASHED]: "a{}",
      [VERSIONED]: "export {}",
      "/assets/plain.css": "a{}",
      "/assets/site/plain.js": "export {}",
      "/robots.txt": "User-agent: *",
      "/favicon.png": "png",
      "/favicon-dark.png": "png",
    }),
  });
}

function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split("; ").map((d) => {
      const [name, ...values] = d.split(" ");
      return [name!, values];
    }),
  );
}

describe("the dashboard pages (stubbed assets)", () => {
  it.each(PAGES)(
    "serves %s with a strict CSP and a short cache",
    async (path) => {
      const res = await call(path, envWithAssets());
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      expect(await res.text()).toBe(PAGE);
      expect(res.headers.get("Cache-Control")).toBe(CACHE_HTML);
      expect(res.headers.get("Content-Security-Policy")).toBe(CSP);
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(res.headers.get("Permissions-Policy")).toContain(
        "geolocation=(self)",
      );
      expect(res.headers.get("Vary")).toContain("Origin");
    },
  );

  it("has a CSP that allows only this origin, our worker and data icons", () => {
    const d = directives(CSP);
    expect(d["default-src"]).toEqual(["'none'"]);
    expect(d["script-src"]).toEqual(["'self'"]);
    expect(d["style-src"]).toEqual(["'self'"]);
    expect(d["connect-src"]).toEqual(["'self'"]);
    expect(d["worker-src"]).toEqual(["'self'", "blob:"]);
    expect(d["img-src"]).toEqual(["'self'", "data:", "blob:"]);
    // Only the Embed builder's preview of this site's own /embed/ is framed.
    expect(d["frame-src"]).toEqual(["'self'"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(CSP).not.toMatch(/unsafe-|https?:|\*/);
  });

  it("redirects the form without a trailing slash, keeping the query", async () => {
    const res = await call("/explorer?lang=fr", envWithAssets());
    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe(
      "https://maps.test/explorer/?lang=fr",
    );
    for (const path of [
      "/endpoints",
      "/embed-builder",
      "/docs",
      "/status",
      "/embed",
    ]) {
      expect((await call(path, envWithAssets())).status, path).toBe(308);
    }
  });

  it("caches hashed and versioned assets for a year, others for a day", async () => {
    const env = envWithAssets();
    for (const path of [HASHED, VERSIONED]) {
      const res = await call(path, env);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe(CACHE_IMMUTABLE);
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
    for (const path of [
      "/assets/plain.css",
      "/assets/site/plain.js",
      "/robots.txt",
      "/favicon.png",
      "/favicon-dark.png",
    ]) {
      const res = await call(path, env);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("Cache-Control"), path).toBe(CACHE_STATIC);
    }
  });

  it("answers a missing asset with the JSON 404, not the platform's", async () => {
    const res = await call("/assets/nope.js", envWithAssets());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not serve other paths from the assets", async () => {
    for (const path of [
      "/index.html",
      "/explorer/index.html",
      "/public/index.html",
      "/favicon.svg",
      "/keys/",
      "/usage/",
      "/other",
    ]) {
      const res = await call(path, envWithAssets());
      expect(res.status, path).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
  });

  it("leaves /v1 and /health as they were", async () => {
    const env = envWithAssets();
    const health = await call("/health", env);
    expect(health.headers.get("Content-Security-Policy")).toBeNull();
    expect(health.headers.get("Cache-Control")).toBe("no-store");
    const style = await call("/v1/styles/light.json", env);
    expect(style.status).toBe(200);
    expect(style.headers.get("Content-Security-Policy")).toBeNull();
  });
});

describe("GET /embed/ (stubbed assets)", () => {
  const ancestors = (res: Response) =>
    directives(res.headers.get("Content-Security-Policy")!)["frame-ancestors"];

  it("may be framed by this site and the configured first-party origins only", async () => {
    const res = await call("/embed/", envWithAssets());
    expect(res.status).toBe(200);
    expect(ancestors(res)).toEqual([
      "'self'",
      "https://weather.mukoko.com",
      "http://localhost:3000",
    ]);
    expect(res.headers.get("Cache-Control")).toBe(CACHE_HTML);
    expect(res.headers.get("X-Frame-Options")).toBeNull();
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe(
      "cross-origin",
    );
    expect(res.headers.get("Permissions-Policy")).toContain("geolocation=()");
  });

  it("is framed by no one but itself when no origin is configured", async () => {
    const res = await call("/embed/", envWithAssets({ ALLOWED_ORIGINS: "" }));
    expect(ancestors(res)).toEqual(["'self'"]);
  });

  it("takes nothing from the request: not the query, not headers, not the referrer", async () => {
    const plain = await call("/embed/", envWithAssets());
    const hostile = await call(
      "/embed/?frame=https://evil.example&frame-ancestors=*&key=nyk_x",
      envWithAssets(),
      {
        headers: {
          Origin: "https://evil.example",
          Referer: "https://evil.example/page",
          "X-Forwarded-Host": "evil.example",
        },
      },
    );
    expect(hostile.headers.get("Content-Security-Policy")).toBe(
      plain.headers.get("Content-Security-Policy"),
    );
    expect(hostile.headers.get("Content-Security-Policy")).not.toContain(
      "evil",
    );
  });

  it("allows a wildcard subdomain entry and drops anything that is not a host", () => {
    expect(
      frameSources(
        "https://*.example.org, https://a.example.com:8443/, https://x.test/path, https://y.test; script-src *, *, javascript:alert(1), https://ok.test",
      ),
    ).toEqual([
      "https://*.example.org",
      "https://a.example.com:8443",
      "https://ok.test",
    ]);
    const csp = embedCsp("https://x.test;script-src *");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp.match(/script-src/g)).toHaveLength(1);
    expect(directives(csp)["script-src"]).toEqual(["'self'"]);
  });

  it("is the dashboard's policy except for who may frame it", () => {
    const base = directives(CSP);
    const embed = directives(embedCsp(ALLOWED));
    for (const name of [
      "default-src",
      "script-src",
      "style-src",
      "connect-src",
      "img-src",
    ]) {
      expect(embed[name], name).toEqual(base[name]);
    }
    expect(embed["frame-src"]).toBeUndefined();
    expect(embedCsp(ALLOWED)).not.toMatch(/unsafe-|\*/);
  });
});

// ---- The built site, through the real Worker entry and the real ASSETS ----

const ORIGIN = "https://maps.test";
const EXTERNAL_LINK_HOSTS = new Set([
  "platform.nyuchi.com",
  "docs.nyuchi.com",
  "status.nyuchi.com",
]);

async function get(path: string) {
  const res = await SELF.fetch(`${ORIGIN}${path}`);
  return { res, text: await res.text() };
}

/** Every URL the page loads: script src, link href, img src, iframe src, form action. */
function loaded(html: string): string[] {
  return [
    ...html.matchAll(
      /<(?:script|img|iframe|source|form)\b[^>]*?\s(?:src|action)="([^"]+)"/gi,
    ),
    ...html.matchAll(/<link\b[^>]*?\shref="([^"]+)"/gi),
  ].map((m) => m[1]!);
}

describe("the built pages (real assets in workerd)", () => {
  it.each([...PAGES, "/embed/"])(
    "%s is a built page with a strict CSP",
    async (path) => {
      const { res, text } = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      expect(res.headers.get("Content-Security-Policy")).toBe(
        path === "/embed/"
          ? embedCsp(
              (workerEnv as { ALLOWED_ORIGINS?: string }).ALLOWED_ORIGINS,
            )
          : CSP,
      );
      expect(res.headers.get("Cache-Control")).toBe(CACHE_HTML);
      expect(text).toMatch(/<title>[^<]*Nyuchi Maps[^<]*<\/title>/);
      expect(text).toMatch(/<html lang="en/);
      expect(text).toMatch(/<meta name="viewport"/);
    },
  );

  it.each([...PAGES, "/embed/"])(
    "%s loads nothing from another origin and has nothing inline",
    async (path) => {
      const { text } = await get(path);
      for (const url of loaded(text)) {
        expect(
          url.startsWith("/") && !url.startsWith("//"),
          `${path} loads ${url}`,
        ).toBe(true);
      }
      expect(text).not.toMatch(/\sstyle\s*=/i);
      expect(text).not.toMatch(/\son[a-z]+\s*=/i);
      expect(text).not.toContain("<style");
      // Every <script> opening tag has a src, so none carries inline code.
      const tags = text.match(/<script\b[^>]*>/gi) ?? [];
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) expect(tag, path).toContain("src=");
      // Links out go only to Nyuchi's own sites.
      for (const m of text.matchAll(/<a\b[^>]*\shref="(https?:[^"]+)"/gi)) {
        expect(
          EXTERNAL_LINK_HOSTS.has(new URL(m[1]!).host),
          `${path} links to ${m[1]}`,
        ).toBe(true);
      }
    },
  );

  it("serves every file the pages reference, with the right headers", async () => {
    const seen = new Set<string>();
    for (const path of [...PAGES, "/embed/"]) {
      const { text } = await get(path);
      for (const url of loaded(text)) seen.add(url);
    }
    expect(seen.size).toBeGreaterThanOrEqual(8);
    for (const ref of seen) {
      const res = await SELF.fetch(`${ORIGIN}${ref}`);
      expect(res.status, ref).toBe(200);
      await res.arrayBuffer();
      if (ref.startsWith("/assets/")) {
        expect(res.headers.get("Cache-Control"), ref).toBe(CACHE_IMMUTABLE);
      }
    }
    const js = [...seen].find(
      (r) => r.startsWith("/assets/site/") && r.endsWith(".js"),
    )!;
    expect(
      (await SELF.fetch(`${ORIGIN}${js}`)).headers.get("Content-Type"),
    ).toMatch(/javascript/);
    const css = [...seen].filter((r) => r.endsWith(".css"));
    expect(css.length).toBeGreaterThanOrEqual(2);
    for (const r of css) {
      expect(
        (await SELF.fetch(`${ORIGIN}${r}`)).headers.get("Content-Type"),
        r,
      ).toContain("text/css");
    }
  });

  it("names every built file with a content hash", async () => {
    const seen = new Set<string>();
    for (const path of [...PAGES, "/embed/"]) {
      for (const url of loaded((await get(path)).text)) {
        if (url.startsWith("/assets/site/")) seen.add(url);
      }
    }
    expect(seen.size).toBeGreaterThan(5);
    for (const url of seen) {
      expect(url, url).toMatch(
        /\/[A-Za-z0-9._-]+\.[A-Za-z0-9_-]{8}\.(?:js|css|png)$/,
      );
    }
  });

  it("is the Explorer: a map region, a status line and the pinned MapLibre", async () => {
    const { text } = await get("/explorer/");
    expect(text).toContain('id="map"');
    expect(text).toContain('id="status"');
    expect(text).toContain(
      `/assets/vendor/maplibre-gl/${MAPLIBRE}/maplibre-gl.css`,
    );
    const src = text.match(/src="(\/assets\/site\/explorer[^"]+\.js)"/)![1]!;
    const code = await (await SELF.fetch(`${ORIGIN}${src}`)).text();
    const mod = code.match(
      /from"(\/assets\/vendor\/maplibre-gl\/(\d+\.\d+\.\d+)\/maplibre-gl\.mjs)"/,
    );
    expect(mod, "the Explorer imports the vendored module").not.toBeNull();
    expect(mod![2]).toBe(MAPLIBRE);
    const dir = `${ORIGIN}/assets/vendor/maplibre-gl/${MAPLIBRE}`;
    for (const file of [
      "maplibre-gl.mjs",
      "maplibre-gl-worker.mjs",
      "maplibre-gl.css",
      "LICENSE.txt",
    ]) {
      const res = await SELF.fetch(`${dir}/${file}`);
      expect(res.status, file).toBe(200);
      await res.arrayBuffer();
    }
    const licence = await (await SELF.fetch(`${dir}/LICENSE.txt`)).text();
    expect(licence).toContain("MapLibre contributors");
    // No page bundles a second copy of MapLibre.
    expect(code).not.toContain("maplibregl-canvas");
  });

  it("is the embed page: one map and no dashboard frame", async () => {
    const { res, text } = await get("/embed/");
    expect(text).toContain('id="map"');
    expect(text).not.toContain('data-slot="app-shell"');
    expect(text).toContain('<meta name="robots" content="noindex">');
    expect(res.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'self'",
    );
  });

  it("serves robots.txt that keeps crawlers off the API and the embed page", async () => {
    const { res, text } = await get("/robots.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(text).toContain("Disallow: /v1/");
    expect(text).toContain("Disallow: /embed/");
    expect(text).not.toMatch(/sitemap/i);
  });

  it("serves the Nyuchi mark as the favicon, for light and dark", async () => {
    const { text } = await get("/");
    expect(text).toMatch(
      /<link rel="icon" href="\/favicon\.png"[^>]*prefers-color-scheme: light/,
    );
    expect(text).toMatch(
      /<link rel="icon" href="\/favicon-dark\.png"[^>]*prefers-color-scheme: dark/,
    );
    for (const path of ["/favicon.png", "/favicon-dark.png"]) {
      const res = await SELF.fetch(`${ORIGIN}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("image/png");
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect([...bytes.slice(1, 4)]).toEqual([80, 78, 71]);
    }
  });

  it("keeps /v1 behaviour: JSON 404s, validation, health", async () => {
    expect((await SELF.fetch(`${ORIGIN}/health`)).status).toBe(200);
    const bad = await SELF.fetch(`${ORIGIN}/v1/tiles/a/b/c.mvt`);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_tile_coordinates" });
    const style = await SELF.fetch(`${ORIGIN}/v1/styles/light.json`);
    expect(style.status).toBe(200);
    expect(style.headers.get("Content-Security-Policy")).toBeNull();
  });
});

// ---- What the pages say: honest content, one config, the Console link ----

describe("what the pages say", () => {
  it("marks every api.nyuchi.com address as planned until the API is enabled", async () => {
    const { text } = await get("/endpoints/");
    expect(text).toContain("https://api.nyuchi.com/v1/maps");
    expect(text).toContain("Available when the Maps API is enabled");
    expect(text).toContain("planned, not live");
    // The origin addresses are listed, and called what they are.
    expect(text).toContain("https://maps.nyuchi.com/v1/tiles.json");
    expect(text).toContain("not for you to build on");
    // The snippets that exist, and only those.
    for (const name of ["MapLibre GL JS", "Leaflet", "OpenLayers", "curl"]) {
      expect(text).toContain(name);
    }
    expect(text).toContain("@maplibre/maplibre-gl-leaflet");
    expect(text).not.toMatch(/raster/i);
    // No secret pair in a URL, and no key in a snippet but the placeholder.
    expect(text).not.toMatch(/nys_|client_secret=/i);
  });

  it("sends keys and usage to the Console and builds neither here", async () => {
    const { text } = await get("/");
    expect(text).toContain(
      "https://platform.nyuchi.com/dashboard/developer/keys",
    );
    expect(text).toContain("Keys and usage");
    expect(text).toMatch(/>\s*Console\s*</);
    expect(text).toContain("Usage arrives with the API");
    for (const path of ["/keys/", "/usage/", "/coverage/"]) {
      expect((await SELF.fetch(`${ORIGIN}${path}`)).status, path).toBe(404);
    }
  });

  it("shows no invented figure: the Overview's numbers are read live or absent", async () => {
    const { text } = await get("/");
    for (const word of [
      "Tile requests",
      "Cache hit rate",
      "Error rate",
      "Bytes served",
      "Sample data",
    ]) {
      expect(text, word).not.toContain(word);
    }
    // The stat tiles are filled by the script from /health and the TileJSON.
    expect(text).toContain("Checking…");
  });

  it("keeps the old map links working on the Explorer", () => {
    // /#4/10/20 and /?lang=fr land on the dashboard's front page, which hands them on.
    expect(shellJs).toMatch(/location\.pathname === "\/"/);
    expect(shellJs).toContain("/explorer/${location.search}${location.hash}");
    expect(shellJs).toContain("lang");
    expect(explorerJs).toMatch(/hash:\s*true/);
    expect(explorerJs).toContain("?lang=");
  });

  it("has the shell's accessible structure", async () => {
    for (const path of PAGES) {
      const { text } = await get(path);
      expect(text, path).toContain('href="#main"');
      expect(text, path).toContain('id="main"');
      expect(text, path).toMatch(/<nav[^>]*aria-label="Maps"/);
      expect(text, path).toMatch(/<nav[^>]*aria-label="Primary"/);
      expect(text, path).toContain('aria-current="page"');
      expect(text, path).toContain("data-theme-toggle");
      expect(text, path).toContain("data-shell-collapse");
      // Exactly one h1, from the page header.
      expect(text.match(/<h1\b/g), path).toHaveLength(1);
    }
    const builder = (await get("/embed-builder/")).text;
    expect(builder).toMatch(/<iframe[^>]*title="[^"]+"/);
    expect(builder).toContain('data-slot="radio-group"');
  });
});

// ---- Source files: keep the pages and the data in step ---------------------

describe("page sources", () => {
  function bbox(): [number, number, number, number] {
    const fc = JSON.parse(regions) as {
      features: { geometry: { coordinates: number[][][] } }[];
    };
    const points = fc.features.flatMap((f) => f.geometry.coordinates.flat());
    const lons = points.map((p) => p[0]!);
    const lats = points.map((p) => p[1]!);
    return [
      Math.min(...lons),
      Math.min(...lats),
      Math.max(...lons),
      Math.max(...lats),
    ];
  }

  function constant(source: string, name: string): number[][] {
    const m = source.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]);`));
    expect(m, name).not.toBeNull();
    return JSON.parse(m![1]!.replace(/,\s*\]/g, "]")) as number[][];
  }

  it.each([
    ["the Explorer", explorerJs],
    ["the embed page", embedJs],
  ])(
    "%s opens on a frame inside the extract region's bounding box, covering both areas",
    (_name, source) => {
      const [west, south, east, north] = bbox();
      const [[fw, fs], [fe, fn]] = constant(source, "AREA_FRAME") as [
        number[],
        number[],
      ];
      expect(fw! >= west && fs! >= south && fe! <= east && fn! <= north).toBe(
        true,
      );
      // From Dakar and Cape Agulhas to Bizerte and the eastern edge of Indonesia.
      expect(fw! <= -17.5 && fs! <= -34.8 && fn! >= 37.3 && fe! >= 140).toBe(
        true,
      );
      // No fence: the viewer may look anywhere.
      expect(source).not.toMatch(/maxBounds\s*:/);
    },
  );

  it("defines the extract region as two named polygons with closed rings", () => {
    const fc = JSON.parse(regions) as {
      type: string;
      features: {
        properties: { name: string };
        geometry: { type: string; coordinates: number[][][] };
      }[];
    };
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features.map((f) => f.properties.name)).toEqual([
      "Africa",
      "South East Asia",
    ]);
    for (const feature of fc.features) {
      expect(feature.geometry.type).toBe("Polygon");
      const ring = feature.geometry.coordinates[0]!;
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      // Counter-clockwise exterior ring (RFC 7946): positive shoelace area.
      let area = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        area +=
          ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!;
      }
      expect(area).toBeGreaterThan(0);
    }
  });

  async function builtCss(): Promise<string> {
    const html = (await get("/explorer/")).text;
    const hrefs = [
      ...html.matchAll(
        /<link rel="stylesheet" href="(\/assets\/site\/[^"]+\.css)"/g,
      ),
    ].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThanOrEqual(2);
    let css = "";
    for (const href of hrefs)
      css += await (await SELF.fetch(`${ORIGIN}${href}`)).text();
    return css;
  }

  it("never writes a credit by hand: attribution comes from the TileJSON", async () => {
    const forbidden = /openstreetmap|©|&copy;|protomaps/i;
    for (const [file, source] of Object.entries(SOURCES)) {
      expect(source, file).not.toMatch(forbidden);
    }
    for (const path of [...PAGES, "/embed/"]) {
      expect((await get(path)).text, path).not.toMatch(forbidden);
    }
    expect(await builtCss()).not.toMatch(forbidden);
    for (const source of [explorerJs, embedJs]) {
      expect(source).toContain("attributionControl");
      // Like Google Maps: a small (i) that opens the line, not a box on the map.
      expect(source).toMatch(/attributionControl:\s*\{\s*compact:\s*true/);
      // Closed by default: one tap on the (i) opens the credits.
      expect(source).toContain("closeCredits");
      expect(source).not.toContain("customAttribution");
    }
  });

  it("draws the credits the TileJSON carries, as links and text, never as markup", () => {
    const tilejson = SOURCES["../site/src/scripts/tilejson.js"]!;
    expect(tilejson).toContain("DOMParser");
    expect(tilejson).toContain("textContent");
    expect(tilejson).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
    for (const [file, source] of Object.entries(SOURCES)) {
      if (!file.endsWith(".js")) continue;
      expect(source, file).not.toMatch(
        /innerHTML\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function/,
      );
    }
  });

  it("holds the Bundu floor in the stylesheet", async () => {
    const css = await builtCss();
    expect(css).toMatch(/--hit:\s*45px/);
    expect(css).toMatch(/--hit:\s*24px/);
    expect(css).toMatch(/--body:\s*17px/);
    expect(css).toMatch(/--body:\s*15px/);
    expect(css).toMatch(/--leading-floor:\s*1\.5/);
    expect(css).toMatch(/--inset-floor:\s*14px/);
    expect(css).toMatch(/--space-control-between:\s*9px/);
    expect(css).toMatch(/:focus-visible/);
    expect(css).not.toMatch(/outline:\s*(none|0)\b/);
  });

  it("draws text buttons and chips as pills and icon-only controls as circles", async () => {
    const css = await builtCss();
    // The one radius the Dashboard Standard uses for controls is full.
    expect(css).toMatch(/--radius-sm:\s*9999px/);
    // Icon-only buttons are equal in width and height.
    expect(css).toMatch(/aspect-ratio:\s*1[;}]/);
    // The map's own controls are round, the copy button is a pill.
    expect(css).toMatch(
      /\.maps-frame \.maplibregl-ctrl-group button[^{]*\{[^}]*border-radius:\s*9999px/,
    );
    expect(css).toMatch(/\.maps-copy\{[^}]*border-radius:\s*9999px/);
  });

  it("keeps script-only controls hidden when scripts do not run", async () => {
    const css = await builtCss();
    expect(css).toMatch(/html:not\(\[data-js\]\) \.maps-copy\{display:none\}/);
    const { text } = await get("/");
    expect(text).toMatch(/data-theme-toggle[^>]*\shidden/);
  });

  it("follows the system theme and stores the choice outside cookies", () => {
    expect(shellJs).toContain("prefers-color-scheme: dark");
    expect(shellJs).toContain("localStorage");
    expect(explorerJs).toContain("/v1/styles/");
    expect(explorerJs).toContain("themechange");
    for (const [file, source] of Object.entries(SOURCES)) {
      expect(source, file).not.toMatch(/document\.cookie/);
    }
    // The shell's own cookie persistence is never switched on.
    for (const [file, source] of Object.entries(SOURCES)) {
      if (file.endsWith(".astro")) expect(source, file).not.toMatch(/persist=/);
    }
  });
});
