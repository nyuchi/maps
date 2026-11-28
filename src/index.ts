import { Hono, type Context } from "hono";
import { parse as parseYaml } from "yaml";
import openapiYaml from "../openapi/openapi.yaml";
import {
  ArchiveMissingError,
  UnsupportedCompressionError,
  openArchive,
  vectorLayers,
  tileContentType,
  tileEncoding,
  tileExt,
} from "./archive";
import { attributionHtml } from "./credits";
import { regionsOn } from "./regions/config";

/** Web Mercator limits: what a tile client may ask for anywhere. */
const WORLD_BOUNDS: [number, number, number, number] = [
  -180, -85.0511, 180, 85.0511,
];
import { mayCreateDemand, reportDemand } from "./regions/demand";
import {
  CACHE_FALLBACK,
  CACHE_UPSTREAM,
  upstreamTile,
} from "./regions/fallback";
import { cellId, type Cell } from "./regions/grid";
import { internal } from "./regions/internal";
import { classify, loadManifest } from "./regions/manifest";
import { cors } from "./cors";
import { originAuth } from "./originauth";
import {
  CACHE_ASSET,
  CACHE_EMPTY,
  CACHE_MISS,
  CACHE_TILE,
  NO_STORE,
  baseUrl,
  etagMatches,
  jsonError,
  jsonResponse,
  rebuild,
  responseInit,
} from "./http";
import { checkRateLimit, rateLimit } from "./ratelimit";
import {
  DEFAULT_SOURCE_ID,
  SOURCES,
  sourceKey,
  type SourceDef,
} from "./sources";
import { buildStyle } from "./styles";
import { registerWebRoutes } from "./web";
import type { AppEnv } from "./types";
import {
  isName,
  parseFontRange,
  parseFontStack,
  parseLang,
  parseSpriteFile,
  parseStyleFile,
  parseTile,
} from "./validate";

export function createApp(
  sources: Readonly<Record<string, SourceDef>> = SOURCES,
) {
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof ArchiveMissingError) {
      console.error(err.message);
      return jsonError(503, "archive_unavailable");
    }
    if (err instanceof UnsupportedCompressionError) {
      console.error(err.message);
      return jsonError(500, "unsupported_tile_compression");
    }
    console.error("unhandled error", c.req.path, err);
    return jsonError(500, "internal_error");
  });

  app.notFound(() => jsonError(404, "not_found"));

  app.use("*", cors);

  // Origin auth (off unless ORIGIN_AUTH is set): before every /v1 handler,
  // the rate limiter and the edge cache, so nothing cached is reachable
  // without the credential. Not under /v1, so /health, the map page and
  // /openapi.json stay public.
  app.use("/v1/*", originAuth);

  app.get("/health", () =>
    Response.json(
      { status: "ok", service: "nyuchi-maps" },
      { headers: { "Cache-Control": NO_STORE } },
    ),
  );

  // The dashboard, the embed page and their static files (public/, through
  // the ASSETS binding): see src/web.ts.
  registerWebRoutes(app);

  let openapiJson: unknown;
  app.get("/openapi.json", (c) => {
    openapiJson ??= parseYaml(openapiYaml as string);
    return jsonResponse(c, openapiJson, CACHE_ASSET);
  });

  // The region builder's calls: bearer token, 404 until BUILDER_TOKEN is set.
  app.route("/internal/v1/regions", internal);

  app.use("/v1/*", rateLimit);

  type Ctx = Context<AppEnv>;

  /** TileJSON 3.0.0 for one source, carrying its credits. */
  async function tileJson(c: Ctx, def: SourceDef): Promise<Response> {
    const key = sourceKey(c.env, def);
    const header = await openArchive(c.env, key).getHeader();
    const ext = tileExt(header);
    if (!ext) return jsonError(500, "unsupported_tile_type");
    // Required by TileJSON 3.0.0 for vector tiles; read from the archive's
    // own metadata block.
    const layers =
      ext === "mvt" ? await vectorLayers(c.env, key, header) : null;
    const base = baseUrl(c.env, c.req.url);
    const prefix =
      def.id === DEFAULT_SOURCE_ID
        ? `${base}/v1/tiles`
        : `${base}/v1/sources/${def.id}/tiles`;
    return jsonResponse(
      c,
      {
        tilejson: "3.0.0",
        name:
          def.id === DEFAULT_SOURCE_ID
            ? "Nyuchi Maps"
            : `Nyuchi Maps ${def.id}`,
        scheme: "xyz",
        tiles: [`${prefix}/{z}/{x}/{y}.${ext}`],
        ...(ext === "mvt" ? { vector_layers: layers ?? [] } : {}),
        attribution: attributionHtml(def.creditIds),
        minzoom: header.minZoom,
        maxzoom: header.maxZoom,
        // With on-demand regions on, any place can be added, and a client
        // (MapLibre) never asks for a tile outside the bounds it is told. So
        // the default source says "the world", not the first archive's box.
        bounds:
          def.id === DEFAULT_SOURCE_ID && regionsOn(c.env)
            ? WORLD_BOUNDS
            : [header.minLon, header.minLat, header.maxLon, header.maxLat],
        center: [header.centerLon, header.centerLat, header.centerZoom],
      },
      CACHE_ASSET,
    );
  }

  /** waitUntil when there is an execution context (not in some tests). */
  function defer(c: Ctx, work: Promise<unknown>): void {
    try {
      c.executionCtx.waitUntil(work);
    } catch {
      void work.catch(() => {});
    }
  }

  /** The edge-cached tile for a key, as a response, or a 304. */
  async function fromEdge(
    c: Ctx,
    edge: Cache | null,
    key: Request,
  ): Promise<Response | null> {
    if (!edge) return null;
    const hit = await edge.match(key);
    if (!hit) return null;
    const etag = hit.headers.get("ETag");
    if (etag && etagMatches(c.req.header("If-None-Match"), etag)) {
      return new Response(null, { status: 304, headers: hit.headers });
    }
    return rebuild(hit);
  }

  /**
   * Answer a tile from one archive: format and zoom checks, ETag and 304, the
   * range read, the 204 for a tile the archive does not hold, and the edge
   * cache write. `label` is set (X-Tile-Source) only when regions are on.
   */
  async function fromArchive(
    c: Ctx,
    archiveKey: string,
    cacheKey: Request,
    req: { z: number; x: number; y: number; ext: string },
    edge: Cache | null,
    label?: string,
  ): Promise<Response> {
    const archive = openArchive(c.env, archiveKey);
    const header = await archive.getHeader();
    const ext = tileExt(header);
    if (ext !== req.ext) {
      return jsonError(404, "format_mismatch", { "Cache-Control": CACHE_MISS });
    }
    if (req.z < header.minZoom || req.z > header.maxZoom) {
      return jsonError(404, "zoom_out_of_range", {
        "Cache-Control": CACHE_MISS,
      });
    }

    const encoding = tileEncoding(header);
    const headers = new Headers({
      "Content-Type": tileContentType(ext),
      "Cache-Control": CACHE_TILE,
    });
    if (label) headers.set("X-Tile-Source", label);
    if (encoding) headers.set("Content-Encoding", encoding);
    if (header.etag) {
      headers.set("ETag", `"${header.etag}:${req.z}/${req.x}/${req.y}"`);
    }
    // The ETag is derived from the cached header, so a matching validator is
    // answered before the directory or the tile is read from R2.
    const etag = headers.get("ETag");
    if (etag && etagMatches(c.req.header("If-None-Match"), etag)) {
      return new Response(null, { status: 304, headers });
    }

    const found = await archive.getZxy(req.z, req.x, req.y, c.req.raw.signal);
    if (!found) {
      // Inside the archive's zoom range but no data here (ocean, empty cell).
      const empty: Record<string, string> = { "Cache-Control": CACHE_EMPTY };
      if (label) empty["X-Tile-Source"] = label;
      return new Response(null, { status: 204, headers: empty });
    }

    const res = new Response(found.data, responseInit(200, headers));
    if (edge) {
      try {
        // Not res.clone(): a clone does not keep encodeBody "manual", so the
        // Cache API would gzip the already-gzipped bytes a second time.
        const copy = new Response(
          found.data,
          responseInit(200, new Headers(headers)),
        );
        c.executionCtx.waitUntil(edge.put(cacheKey, copy));
      } catch {
        // No execution context (tests): skip the write.
      }
    }
    return res;
  }

  /**
   * A tile no archive holds (on-demand regions only): record the demand
   * without waiting for it, then answer with the best thing available now.
   * Never cached for long, so the region that fills it is not hidden.
   */
  async function notStored(
    c: Ctx,
    req: { z: number; x: number; y: number },
    cell: Cell,
    state: Awaited<ReturnType<typeof loadManifest>>,
    edge: Cache | null,
    fallbackKey: Request,
  ): Promise<Response> {
    if (mayCreateDemand(c.env, c.req.raw.headers)) {
      defer(
        c,
        reportDemand(c.env, {
          cell: cellId(cell),
          tile: `${req.z}/${req.x}/${req.y}`,
          ip: c.req.header("CF-Connecting-IP"),
        }),
      );
    }
    if (c.env.FALLBACK_MODE === "upstream") {
      const hit = await fromEdge(c, edge, fallbackKey);
      if (hit) return hit;
    }
    const limited = await checkRateLimit(c);
    if (limited) return limited;

    const up = await upstreamTile(c.env, state.manifest.upstream?.url, req);
    if (up) {
      const headers = new Headers({
        "Content-Type": "application/vnd.mapbox-vector-tile",
        "Content-Encoding": "gzip",
        "Cache-Control": CACHE_UPSTREAM,
        "X-Tile-Source": "upstream",
      });
      if (edge) {
        try {
          c.executionCtx.waitUntil(
            edge.put(
              fallbackKey,
              new Response(up.data, responseInit(200, new Headers(headers))),
            ),
          );
        } catch {
          // No execution context (tests): skip the write.
        }
      }
      return new Response(up.data, responseInit(200, headers));
    }
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": CACHE_FALLBACK, "X-Tile-Source": "none" },
    });
  }

  async function tile(c: Ctx, def: SourceDef): Promise<Response> {
    const req = parseTile(
      c.req.param("z") ?? "",
      c.req.param("x") ?? "",
      c.req.param("file") ?? "",
    );
    if (!req) return jsonError(400, "invalid_tile_coordinates");

    const edge = c.env.EDGE_CACHE === "off" ? null : caches.default;
    // Key on origin + path + the archive version only: a query string must
    // not bypass the cache, and bumping TILES_VERSION retires every cached
    // tile of a replaced archive. Region tiles and fallback tiles add a
    // segment (see docs/ondemand-regions.md), so each has its own entries.
    const url = new URL(c.req.url);
    const keyFor = (suffix = ""): Request =>
      new Request(
        `${url.origin}${url.pathname}?v=${encodeURIComponent(c.env.TILES_VERSION ?? "")}${suffix}`,
      );
    const primaryKey = keyFor();
    const hit = await fromEdge(c, edge, primaryKey);
    if (hit) return hit;

    const key = sourceKey(c.env, def);
    if (def.id !== DEFAULT_SOURCE_ID || !regionsOn(c.env)) {
      // Only a miss costs the origin anything, so only a miss is limited.
      const limited = await checkRateLimit(c);
      if (limited) return limited;
      return fromArchive(c, key, primaryKey, req, edge);
    }

    // On-demand regions: where does this tile live?
    const header = await openArchive(c.env, key).getHeader();
    if (tileExt(header) !== req.ext) {
      return jsonError(404, "format_mismatch", { "Cache-Control": CACHE_MISS });
    }
    const state = await loadManifest(c.env);
    const where = classify(state, header, req);

    if (where.kind === "region") {
      const regionKey = keyFor(`&r=${encodeURIComponent(where.region.key)}`);
      const cached = await fromEdge(c, edge, regionKey);
      if (cached) return cached;
      const limited = await checkRateLimit(c);
      if (limited) return limited;
      return fromArchive(c, where.region.key, regionKey, req, edge, "region");
    }
    if (where.kind === "missing") {
      return notStored(
        c,
        req,
        where.cell,
        state,
        edge,
        keyFor(`&fb=${state.manifest.version}`),
      );
    }
    const limited = await checkRateLimit(c);
    if (limited) return limited;
    return fromArchive(c, key, primaryKey, req, edge, "primary");
  }

  function lookup(
    sources: Readonly<Record<string, SourceDef>>,
    id: string,
  ): SourceDef | null {
    return isName(id) && Object.hasOwn(sources, id) ? sources[id]! : null;
  }

  // Base map: the default source, at the short URLs.
  app.get("/v1/tiles.json", (c) => tileJson(c, sources[DEFAULT_SOURCE_ID]!));
  app.get("/v1/tiles/:z/:x/:file", (c) => tile(c, sources[DEFAULT_SOURCE_ID]!));

  // Any registered source (a places overlay later), under its id.
  app.get("/v1/sources/:id/tiles.json", (c) => {
    const def = lookup(sources, c.req.param("id"));
    return def ? tileJson(c, def) : jsonError(404, "source_not_found");
  });
  app.get("/v1/sources/:id/tiles/:z/:x/:file", (c) => {
    const def = lookup(sources, c.req.param("id"));
    return def ? tile(c, def) : jsonError(404, "source_not_found");
  });

  // Styles are pure functions of (name, base URL, lang): build each once.
  const styleMemo = new Map<string, Record<string, unknown>>();
  app.get("/v1/styles/:file", async (c) => {
    const name = parseStyleFile(c.req.param("file"));
    const lang = parseLang(c.req.query("lang"));
    if (!lang) return jsonError(400, "invalid_lang");
    const base = baseUrl(c.env, c.req.url);
    const memoKey = `${name}|${base}|${lang}`;
    let style = name ? styleMemo.get(memoKey) : undefined;
    if (!style && name) {
      style = buildStyle(name, base, lang) ?? undefined;
      if (style) {
        if (styleMemo.size >= 64) styleMemo.clear();
        styleMemo.set(memoKey, style);
      }
    }
    if (!style) return jsonError(404, "style_not_found");
    return jsonResponse(c, style, CACHE_ASSET);
  });

  /**
   * Stream an R2 object. R2 evaluates If-None-Match itself (onlyIf), so a
   * matching validator never transfers the body.
   */
  async function serveObject(
    c: Ctx,
    key: string,
    contentType: string,
  ): Promise<Response> {
    const object = await c.env.MAPS_BUCKET.get(key, {
      onlyIf: c.req.raw.headers,
    });
    if (!object) {
      return jsonError(404, "not_found", { "Cache-Control": CACHE_MISS });
    }
    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": CACHE_ASSET,
      ETag: object.httpEtag,
    });
    if (!("body" in object) || !object.body) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(object.body, { status: 200, headers });
  }

  app.get("/v1/fonts/:stack/:file", async (c) => {
    const names = parseFontStack(c.req.param("stack"));
    const range = parseFontRange(c.req.param("file"));
    if (!names || !range) return jsonError(400, "invalid_font_request");
    // A stack lists fallbacks: the first font we hold wins.
    for (const name of names) {
      const res = await serveObject(
        c,
        `fonts/${name}/${range}.pbf`,
        "application/x-protobuf",
      );
      if (res.status !== 404) return res;
    }
    return jsonError(404, "not_found", { "Cache-Control": CACHE_MISS });
  });

  app.get("/v1/sprites/:file", async (c) => {
    const sprite = parseSpriteFile(c.req.param("file"));
    if (!sprite) return jsonError(400, "invalid_sprite_request");
    return serveObject(
      c,
      `sprites/${sprite.name}${sprite.retina ? "@2x" : ""}.${sprite.ext}`,
      sprite.ext === "json" ? "application/json" : "image/png",
    );
  });

  return app;
}

export default createApp();

// The Durable Object class must be a named export of the entry module.
export { DemandLedger } from "./regions/ledger";
