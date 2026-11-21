import { Compression } from "pmtiles";
import { describe, expect, it } from "vitest";
import { decodeMetadata } from "../src/archive";
import { gzip } from "./helpers";

const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const buf = (u: Uint8Array) => u.slice().buffer as ArrayBuffer;

describe("decodeMetadata", () => {
  const meta = { vector_layers: [{ id: "water" }], name: "x" };

  it("reads uncompressed and gzip metadata", async () => {
    expect(await decodeMetadata(buf(enc(meta)), Compression.None)).toEqual(
      meta,
    );
    expect(
      await decodeMetadata(buf(await gzip(enc(meta))), Compression.Gzip),
    ).toEqual(meta);
  });

  it("returns null for unsupported compression, garbage and non-objects", async () => {
    expect(await decodeMetadata(buf(enc(meta)), Compression.Zstd)).toBeNull();
    expect(
      await decodeMetadata(buf(new Uint8Array([1, 2, 3])), Compression.None),
    ).toBeNull();
    expect(await decodeMetadata(buf(enc([1, 2])), Compression.None)).toBeNull();
    expect(await decodeMetadata(buf(enc(meta)), Compression.Gzip)).toBeNull(); // not actually gzip
  });
});
