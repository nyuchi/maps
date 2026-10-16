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
import { cors } from "./cors";
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

  app.get("/health", () =>
    Response.json(
      { status: "ok", service: "nyuchi-maps" },
      { headers: { "Cache-Control": NO_STORE } },
    ),
  );

  let openapiJson: unknown;
  app.get("/openapi.json", (c) => {
    openapiJson ??= parseYaml(openapiYaml as string);
    return jsonResponse(c, openapiJson, CACHE_ASSET);
  });

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
        bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
        center: [header.centerLon, header.centerLat, header.centerZoom],
      },
      CACHE_ASSET,
    );
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
    // tile of a replaced archive.
    const url = new URL(c.req.url);
    const cacheKey = new Request(
      `${url.origin}${url.pathname}?v=${encodeURIComponent(c.env.TILES_VERSION ?? "")}`,
    );
    if (edge) {
      const hit = await edge.match(cacheKey);
      if (hit) {
        const etag = hit.headers.get("ETag");
        if (etag && etagMatches(c.req.header("If-None-Match"), etag)) {
          return new Response(null, { status: 304, headers: hit.headers });
        }
        return rebuild(hit);
      }
    }

    // Only a miss costs the origin anything, so only a miss is limited.
    const limited = await checkRateLimit(c);
    if (limited) return limited;

    const archive = openArchive(c.env, sourceKey(c.env, def));
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
      return new Response(null, {
        status: 204,
        headers: { "Cache-Control": CACHE_EMPTY },
      });
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
