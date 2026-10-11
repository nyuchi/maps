import { describe, expect, it } from "vitest";
import { StubBucket, call, makeEnv } from "./helpers";

const GLYPHS = new Uint8Array([10, 20, 30]);
const PNG = new Uint8Array([137, 80, 78, 71]);

function bucket() {
  return new StubBucket()
    .put("fonts/Noto Sans Regular/0-255.pbf", GLYPHS, "font1")
    .put("fonts/Noto Sans Medium/0-255.pbf", new Uint8Array([9]), "font2")
    .put("sprites/light.json", '{"icon":{}}', "spr1")
    .put("sprites/light@2x.png", PNG, "spr2");
}

describe("GET /v1/fonts/{stack}/{range}.pbf", () => {
  it("serves glyphs with a long cache and an ETag", async () => {
    const res = await call(
      "/v1/fonts/Noto%20Sans%20Regular/0-255.pbf",
      makeEnv(bucket()),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/x-protobuf");
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=86400");
    expect(res.headers.get("ETag")).toBe('"font1"');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(GLYPHS);
  });

  it("falls back along the stack to the first font it holds", async () => {
    const res = await call(
      "/v1/fonts/Missing%20Font,Noto%20Sans%20Medium/0-255.pbf",
      makeEnv(bucket()),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBe('"font2"');
  });

  it("answers 304 for a matching ETag", async () => {
    const res = await call(
      "/v1/fonts/Noto%20Sans%20Regular/0-255.pbf",
      makeEnv(bucket()),
      { headers: { "If-None-Match": '"font1"' } },
    );
    expect(res.status).toBe(304);
  });

  it("404s a font or range it does not hold", async () => {
    const env = makeEnv(bucket());
    expect((await call("/v1/fonts/Nope/0-255.pbf", env)).status).toBe(404);
    expect(
      (await call("/v1/fonts/Noto%20Sans%20Regular/256-511.pbf", env)).status,
    ).toBe(404);
  });

  it.each([
    "/v1/fonts/..%2F..%2Fsprites/0-255.pbf",
    "/v1/fonts/Noto%20Sans%20Regular/255-0.pbf",
    "/v1/fonts/Noto%20Sans%20Regular/0-255.json",
    "/v1/fonts/a,b,c,d,e/0-255.pbf",
    "/v1/fonts/Noto%2FSans/0-255.pbf",
  ])("rejects %s and never reads R2", async (path) => {
    const b = bucket();
    const res = await call(path, makeEnv(b));
    expect(res.status).toBe(400);
    expect(b.gets).toHaveLength(0);
  });
});

describe("path traversal", () => {
  it("never reads R2 for dot-segment paths (the URL is normalised away)", async () => {
    const b = bucket();
    const res = await call("/v1/fonts/%2e%2e/0-255.pbf", makeEnv(b));
    expect([400, 404]).toContain(res.status);
    expect(b.gets).toHaveLength(0);
  });
});

describe("GET /v1/sprites/{name}[@2x].(json|png)", () => {
  it("serves the index and the retina sheet", async () => {
    const env = makeEnv(bucket());
    const json = await call("/v1/sprites/light.json", env);
    expect(json.status).toBe(200);
    expect(json.headers.get("Content-Type")).toBe("application/json");
    expect(await json.json()).toEqual({ icon: {} });

    const png = await call("/v1/sprites/light@2x.png", env);
    expect(png.status).toBe(200);
    expect(png.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await png.arrayBuffer())).toEqual(PNG);
  });

  it("answers 304 for a matching ETag", async () => {
    const res = await call("/v1/sprites/light.json", makeEnv(bucket()), {
      headers: { "If-None-Match": '"spr1"' },
    });
    expect(res.status).toBe(304);
  });

  it("404s a sprite it does not hold", async () => {
    expect(
      (await call("/v1/sprites/dark.json", makeEnv(bucket()))).status,
    ).toBe(404);
  });

  it.each([
    "/v1/sprites/Light.json",
    "/v1/sprites/..%2Flight.json",
    "/v1/sprites/light@3x.png",
    "/v1/sprites/light.svg",
  ])("rejects %s with 400 and never reads R2", async (path) => {
    const b = bucket();
    const res = await call(path, makeEnv(b));
    expect(res.status).toBe(400);
    expect(b.gets).toHaveLength(0);
  });
});
