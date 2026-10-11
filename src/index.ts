import { Hono } from "hono";
import { parse as parseYaml } from "yaml";
import openapiYaml from "../openapi/openapi.yaml";
import {
  ArchiveMissingError,
  UnsupportedCompressionError,
  openArchive,
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
} from "./http";
import { rateLimit } from "./ratelimit";
import { buildStyle } from "./styles";
import type { AppEnv } from "./types";
import {
  parseFontRange,
  parseFontStack,
  parseLang,
  parseSpriteFile,
  parseStyleFile,
  parseTile,
} from "./validate";

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

/** TileJSON 3.0.0 for the archive, carrying the credits. */
app.get("/v1/tiles.json", async (c) => {
  const header = await openArchive(c.env).getHeader();
  const ext = tileExt(header);
  if (!ext) return jsonError(500, "unsupported_tile_type");
  const base = baseUrl(c.env, c.req.url);
  return jsonResponse(
    c,
    {
      tilejson: "3.0.0",
      name: "Nyuchi Maps",
      scheme: "xyz",
      tiles: [`${base}/v1/tiles/{z}/{x}/{y}.${ext}`],
      attribution: attributionHtml(),
      minzoom: header.minZoom,
      maxzoom: header.maxZoom,
      bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
      center: [header.centerLon, header.centerLat, header.centerZoom],
    },
    CACHE_ASSET,
  );
});

app.get("/v1/tiles/:z/:x/:file", async (c) => {
  const tile = parseTile(
    c.req.param("z"),
    c.req.param("x"),
    c.req.param("file"),
  );
  if (!tile) return jsonError(400, "invalid_tile_coordinates");

  const edge = c.env.EDGE_CACHE === "off" ? null : caches.default;
  const cacheKey = new Request(c.req.url, { method: "GET" });
  if (edge) {
    const hit = await edge.match(cacheKey);
    if (hit) {
      const etag = hit.headers.get("ETag");
      if (etag && etagMatches(c.req.header("If-None-Match"), etag)) {
        return new Response(null, { status: 304, headers: hit.headers });
      }
      return hit;
    }
  }

  const archive = openArchive(c.env);
  const header = await archive.getHeader();
  const ext = tileExt(header);
  if (ext !== tile.ext) {
    return jsonError(404, "format_mismatch", { "Cache-Control": CACHE_MISS });
  }
  if (tile.z < header.minZoom || tile.z > header.maxZoom) {
    return jsonError(404, "zoom_out_of_range", {
      "Cache-Control": CACHE_MISS,
    });
  }

  const found = await archive.getZxy(tile.z, tile.x, tile.y, c.req.raw.signal);
  if (!found) {
    // Inside the archive's zoom range but no data here (ocean, empty cell).
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": CACHE_EMPTY },
    });
  }

  const encoding = tileEncoding(header);
  const headers = new Headers({
    "Content-Type": tileContentType(ext),
    "Cache-Control": CACHE_TILE,
  });
  if (encoding) headers.set("Content-Encoding", encoding);
  if (header.etag) {
    headers.set("ETag", `"${header.etag}:${tile.z}/${tile.x}/${tile.y}"`);
  }
  const etag = headers.get("ETag");
  if (etag && etagMatches(c.req.header("If-None-Match"), etag)) {
    return new Response(null, { status: 304, headers });
  }

  const res = new Response(found.data, { status: 200, headers });
  if (edge) {
    try {
      c.executionCtx.waitUntil(edge.put(cacheKey, res.clone()));
    } catch {
      // No execution context (tests): skip the write.
    }
  }
  return res;
});

app.get("/v1/styles/:file", async (c) => {
  const name = parseStyleFile(c.req.param("file"));
  const lang = parseLang(c.req.query("lang"));
  if (!lang) return jsonError(400, "invalid_lang");
  const style = name && buildStyle(name, baseUrl(c.env, c.req.url), lang);
  if (!style) return jsonError(404, "style_not_found");
  return jsonResponse(c, style, CACHE_ASSET);
});

/** Stream an R2 object with ETag/304 handling. */
async function serveObject(
  c: {
    env: AppEnv["Bindings"];
    req: { header(n: string): string | undefined };
  },
  key: string,
  contentType: string,
): Promise<Response> {
  const object = await c.env.MAPS_BUCKET.get(key);
  if (!object) {
    return jsonError(404, "not_found", { "Cache-Control": CACHE_MISS });
  }
  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": CACHE_ASSET,
    ETag: object.httpEtag,
  });
  if (etagMatches(c.req.header("If-None-Match"), object.httpEtag)) {
    await object.body.cancel();
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

export default app;
