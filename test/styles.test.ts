import { describe, expect, it } from "vitest";
import { CREDITS } from "../src/credits";
import { StubBucket, call, makeEnv } from "./helpers";

const env = () => makeEnv(new StubBucket());
const BASE = "https://maps.nyuchi.com";

function urlsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    if (/^https?:\/\//.test(value)) out.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => urlsIn(v, out));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => urlsIn(v, out));
  }
  return out;
}

describe("GET /v1/styles/{name}.json", () => {
  for (const name of ["light", "dark"]) {
    describe(name, () => {
      it("is a MapLibre style that points at our own tiles, glyphs and sprite", async () => {
        const res = await call(`/v1/styles/${name}.json`, env());
        expect(res.status).toBe(200);
        expect(res.headers.get("ETag")).toBeTruthy();
        const style = (await res.json()) as Record<string, any>;
        expect(style.version).toBe(8);
        expect(style.sources.protomaps).toEqual({
          type: "vector",
          url: `${BASE}/v1/tiles.json`,
        });
        expect(style.glyphs).toBe(`${BASE}/v1/fonts/{fontstack}/{range}.pbf`);
        expect(style.sprite).toBe(`${BASE}/v1/sprites/${name}`);
        expect(style.layers.length).toBeGreaterThan(10);
      });

      it("references no host other than our own", async () => {
        const style = await (
          await call(`/v1/styles/${name}.json`, env())
        ).json();
        const foreign = urlsIn(style).filter((u) => !u.startsWith(BASE));
        expect(foreign).toEqual([]);
      });

      it("carries no credit text: the TileJSON is the one source", async () => {
        const text = await (
          await call(`/v1/styles/${name}.json`, env())
        ).text();
        for (const c of CREDITS) expect(text).not.toContain(c.text);
        expect(text).not.toContain('"attribution"');
      });
    });
  }

  it("light and dark differ", async () => {
    const a = await (await call("/v1/styles/light.json", env())).text();
    const b = await (await call("/v1/styles/dark.json", env())).text();
    expect(a).not.toBe(b);
  });

  it("honours ?lang", async () => {
    const en = await (await call("/v1/styles/light.json", env())).text();
    const sn = await (
      await call("/v1/styles/light.json?lang=sn", env())
    ).text();
    expect(sn).not.toBe(en);
    expect(sn).toContain("name:sn");
  });

  it("answers 304 for a matching ETag", async () => {
    const first = await call("/v1/styles/dark.json", env());
    const res = await call("/v1/styles/dark.json", env(), {
      headers: { "If-None-Match": first.headers.get("ETag")! },
    });
    expect(res.status).toBe(304);
  });

  it("404s unknown styles and rejects bad input", async () => {
    expect((await call("/v1/styles/sepia.json", env())).status).toBe(404);
    expect((await call("/v1/styles/light", env())).status).toBe(404);
    expect((await call("/v1/styles/..%2Fsecret.json", env())).status).toBe(404);
    expect((await call("/v1/styles/light.json?lang=EN;x", env())).status).toBe(
      400,
    );
  });
});
