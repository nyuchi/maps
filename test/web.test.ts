import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import appJs from "../web/app.js?raw";
import indexHtml from "../web/index.html?raw";
import regions from "../scripts/extract-regions.geojson?raw";
import { CACHE_HTML, CACHE_IMMUTABLE, CACHE_STATIC, CSP } from "../src/web";
import { StubBucket, call, makeEnv, stubAssets } from "./helpers";

const PAGE = '<!doctype html><html lang="en"><title>x</title>';
const HASHED = "/assets/app.0123456789.js";
const VERSIONED = "/assets/vendor/maplibre-gl/6.19.0/maplibre-gl.mjs";

function envWithAssets() {
  return makeEnv(new StubBucket(), {
    ASSETS: stubAssets({
      "/": PAGE,
      [HASHED]: "export {}",
      [VERSIONED]: "export {}",
      "/assets/plain.css": "a{}",
      "/robots.txt": "User-agent: *",
      "/favicon.svg": "<svg/>",
    }),
  });
}

describe("GET / (stubbed assets)", () => {
  it("serves the page with a strict CSP and a short cache", async () => {
    const res = await call("/", envWithAssets());
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
  });

  it("has a CSP that allows only this origin, our worker and data icons", () => {
    const directives = Object.fromEntries(
      CSP.split("; ").map((d) => {
        const [name, ...values] = d.split(" ");
        return [name, values];
      }),
    );
    expect(directives["default-src"]).toEqual(["'none'"]);
    expect(directives["script-src"]).toEqual(["'self'"]);
    expect(directives["style-src"]).toEqual(["'self'"]);
    expect(directives["connect-src"]).toEqual(["'self'"]);
    expect(directives["worker-src"]).toEqual(["'self'", "blob:"]);
    expect(directives["img-src"]).toEqual(["'self'", "data:", "blob:"]);
    expect(directives["frame-ancestors"]).toEqual(["'none'"]);
    expect(CSP).not.toMatch(/unsafe-|https?:|\*/);
  });

  it("caches hashed and versioned assets for a year, others for a day", async () => {
    const env = envWithAssets();
    for (const path of [HASHED, VERSIONED]) {
      const res = await call(path, env);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe(CACHE_IMMUTABLE);
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
    for (const path of ["/assets/plain.css", "/robots.txt", "/favicon.svg"]) {
      const res = await call(path, env);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe(CACHE_STATIC);
    }
  });

  it("answers a missing asset with the JSON 404, not the platform's", async () => {
    const res = await call("/assets/nope.js", envWithAssets());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not serve other paths from the assets", async () => {
    for (const path of ["/index.html", "/public/index.html", "/other"]) {
      const res = await call(path, envWithAssets());
      expect(res.status).toBe(404);
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

// ---- The built page, through the real Worker entry and the real ASSETS ----

describe("GET / (real assets in workerd)", () => {
  async function page() {
    const res = await SELF.fetch("https://maps.test/");
    return { res, html: await res.text() };
  }

  it("is the built page", async () => {
    const { res, html } = await page();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("Content-Security-Policy")).toBe(CSP);
    expect(res.headers.get("Cache-Control")).toBe(CACHE_HTML);
    expect(html).toMatch(/<title>[^<]*Nyuchi Maps[^<]*<\/title>/);
    expect(html).toContain('lang="en"');
    expect(html).toContain('id="map"');
  });

  it("names no external origin and has nothing inline", async () => {
    const { html } = await page();
    expect(html).not.toMatch(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(html).not.toMatch(/\sstyle\s*=/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    // Every <script> opening tag has a src, so none carries inline code.
    const tags = html.match(/<script\b[^>]*>/gi) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag).toContain("src=");
    expect(html).not.toContain("<style");
  });

  it("serves every file the page references, with the right headers", async () => {
    const { html } = await page();
    const refs = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map(
      (m) => m[1]!,
    );
    expect(refs.length).toBeGreaterThanOrEqual(5);
    for (const ref of refs) {
      expect(ref.startsWith("/") && !ref.startsWith("//")).toBe(true);
      const res = await SELF.fetch(`https://maps.test${ref}`);
      expect(res.status, ref).toBe(200);
      await res.arrayBuffer();
      if (ref.startsWith("/assets/")) {
        expect(res.headers.get("Cache-Control"), ref).toBe(CACHE_IMMUTABLE);
      }
    }
    const js = refs.find((r) => r.endsWith(".js"))!;
    expect(
      (await SELF.fetch(`https://maps.test${js}`)).headers.get("Content-Type"),
    ).toMatch(/javascript/);
    const css = refs.filter((r) => r.endsWith(".css"));
    expect(css).toHaveLength(2);
    for (const r of css) {
      expect(
        (await SELF.fetch(`https://maps.test${r}`)).headers.get("Content-Type"),
      ).toContain("text/css");
    }
  });

  it("hashes the bundle names from their content", async () => {
    const { html } = await page();
    const hashed = [
      ...html.matchAll(/\/assets\/app\.([0-9a-f]{10})\.(?:js|css)/g),
    ];
    expect(hashed).toHaveLength(2);
    for (const m of hashed) {
      const body = await (
        await SELF.fetch(`https://maps.test${m[0]}`)
      ).arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", body);
      const hex = [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      expect(hex.startsWith(m[1]!), m[0]).toBe(true);
    }
  });

  it("imports the pinned MapLibre, and its worker sits beside it", async () => {
    const { html } = await page();
    const js = html.match(/src="(\/assets\/app\.[0-9a-f]{10}\.js)"/)![1]!;
    const code = await (await SELF.fetch(`https://maps.test${js}`)).text();
    const mod = code.match(
      /from "\.\/(vendor\/maplibre-gl\/(\d+\.\d+\.\d+)\/maplibre-gl\.mjs)"/,
    );
    expect(mod, "app.js imports the vendored module").not.toBeNull();
    expect(code).not.toContain("@MAPLIBRE_VERSION@");
    const dir = `https://maps.test/assets/vendor/maplibre-gl/${mod![2]}`;
    for (const file of [
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
  });

  it("serves robots.txt that keeps crawlers off the API", async () => {
    const res = await SELF.fetch("https://maps.test/robots.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("Disallow: /v1/");
    expect(text).not.toMatch(/sitemap/i);
  });

  it("serves a favicon", async () => {
    const res = await SELF.fetch("https://maps.test/favicon.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("image/svg+xml");
  });

  it("keeps /v1 behaviour: JSON 404s, validation, health", async () => {
    expect((await SELF.fetch("https://maps.test/health")).status).toBe(200);
    const bad = await SELF.fetch("https://maps.test/v1/tiles/a/b/c.mvt");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_tile_coordinates" });
    const style = await SELF.fetch("https://maps.test/v1/styles/light.json");
    expect(style.status).toBe(200);
    expect(style.headers.get("Content-Security-Policy")).toBeNull();
  });
});

// ---- Source files: keep the page and the data in step -------------------------

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

  function constant(name: string): number[][] {
    const m = appJs.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]);`));
    expect(m, name).not.toBeNull();
    return JSON.parse(m![1]!.replace(/,\s*\]/g, "]")) as number[][];
  }

  it("opens on a frame inside the extract region's bounding box, covering both areas", () => {
    const [west, south, east, north] = bbox();
    const [[fw, fs], [fe, fn]] = constant("AREA_FRAME") as [number[], number[]];
    expect(fw! >= west && fs! >= south && fe! <= east && fn! <= north).toBe(
      true,
    );
    // From Dakar and Cape Agulhas to Bizerte and the eastern edge of Indonesia.
    expect(fw! <= -17.5 && fs! <= -34.8 && fn! >= 37.3 && fe! >= 140).toBe(
      true,
    );
    // No fence: the viewer may look anywhere.
    expect(appJs).not.toMatch(/maxBounds\s*:/);
  });

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
    const html = await (await SELF.fetch("https://maps.test/")).text();
    const href = html.match(/href="(\/assets\/app\.[0-9a-f]{10}\.css)"/)![1]!;
    return (await SELF.fetch(`https://maps.test${href}`)).text();
  }

  it("never writes a credit by hand: attribution comes from the TileJSON", async () => {
    for (const source of [appJs, indexHtml, await builtCss()]) {
      expect(source).not.toMatch(/openstreetmap|©|&copy;|protomaps/i);
    }
    expect(appJs).toContain("attributionControl");
    // Like Google Maps: a small (i) that opens the line, not a box on the map.
    expect(appJs).toMatch(/attributionControl:\s*\{\s*compact:\s*true/);
    // Closed by default: one tap on the (i) opens the credits.
    expect(appJs).toContain("closeCredits");
    expect(appJs).not.toContain("customAttribution");
  });

  it("holds the Bundu floor in the stylesheet", async () => {
    const appCss = await builtCss();
    expect(appCss).toMatch(/--hit:\s*45px/);
    expect(appCss).toMatch(/--hit:\s*24px/);
    expect(appCss).toMatch(/--body:\s*17px/);
    expect(appCss).toMatch(/--body:\s*15px/);
    expect(appCss).toMatch(/--leading-floor:\s*1\.5/);
    expect(appCss).toMatch(/--inset-floor:\s*14px/);
    expect(appCss).toMatch(/--space-control-between:\s*9px/);
    expect(appCss).toMatch(/:focus-visible/);
    expect(appCss).not.toMatch(/outline:\s*(none|0)\b/);
  });

  it("follows the system theme and stores the choice outside cookies", () => {
    expect(appJs).toContain("prefers-color-scheme: dark");
    expect(appJs).toContain("localStorage");
    expect(appJs).not.toMatch(/document\.cookie/);
    expect(appJs).toContain("/v1/styles/");
  });
});
