import { describe, expect, it } from "vitest";
import {
  parseFontRange,
  parseFontStack,
  parseLang,
  parseSpriteFile,
  parseStyleFile,
  parseTile,
} from "../src/validate";

describe("parseTile", () => {
  it("accepts in-range coordinates", () => {
    expect(parseTile("0", "0", "0.mvt")).toEqual({
      z: 0,
      x: 0,
      y: 0,
      ext: "mvt",
    });
    expect(parseTile("14", "9000", "9999.mvt")?.z).toBe(14);
  });

  it.each([
    ["23", "0", "0.mvt"], // zoom above the cap
    ["1", "2", "0.mvt"], // x outside 2^z
    ["1", "0", "2.mvt"], // y outside 2^z
    ["-1", "0", "0.mvt"],
    ["01", "0", "0.mvt"], // leading zero
    ["a", "0", "0.mvt"],
    ["1", "0", "0.exe"],
    ["1", "0", "0.mvt.exe"],
    ["1", "0", "0"],
    ["1", "..", "0.mvt"],
    ["1", "0", "..%2F0.mvt"],
    ["1", "0", "0.mvt/../../x"],
    ["99999999999", "0", "0.mvt"],
  ])("rejects z=%s x=%s file=%s", (z, x, file) => {
    expect(parseTile(z, x, file)).toBeNull();
  });
});

describe("names", () => {
  it("parses style files", () => {
    expect(parseStyleFile("light.json")).toBe("light");
    expect(parseStyleFile("Light.json")).toBeNull();
    expect(parseStyleFile("../x.json")).toBeNull();
    expect(parseStyleFile("light.json.bak")).toBeNull();
  });

  it("parses sprite files", () => {
    expect(parseSpriteFile("light.png")).toEqual({
      name: "light",
      retina: false,
      ext: "png",
    });
    expect(parseSpriteFile("dark@2x.json")?.retina).toBe(true);
    expect(parseSpriteFile("dark@3x.json")).toBeNull();
    expect(parseSpriteFile("../dark.json")).toBeNull();
    expect(parseSpriteFile("dark.svg")).toBeNull();
  });

  it("parses font stacks and ranges", () => {
    expect(parseFontStack("Noto Sans Regular")).toEqual(["Noto Sans Regular"]);
    expect(parseFontStack("Noto Sans Regular,Noto Sans Medium")).toHaveLength(
      2,
    );
    expect(parseFontStack("a,b,c,d,e")).toBeNull();
    expect(parseFontStack("../etc")).toBeNull();
    expect(parseFontStack("Noto/Sans")).toBeNull();
    expect(parseFontStack("")).toBeNull();
    expect(parseFontRange("0-255.pbf")).toBe("0-255");
    expect(parseFontRange("256-255.pbf")).toBeNull();
    expect(parseFontRange("0-255.json")).toBeNull();
    expect(parseFontRange("0-255.pbf/../x")).toBeNull();
  });

  it("parses lang", () => {
    expect(parseLang(undefined)).toBe("en");
    expect(parseLang("sn")).toBe("sn");
    expect(parseLang("EN")).toBeNull();
    expect(parseLang("en;drop")).toBeNull();
  });
});
