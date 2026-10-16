# Building a regional PMTiles extract

This documents how to produce the small archive for the first slice: Zimbabwe
plus a few cities. **It is documentation only. Nothing here is run by CI, and
nothing in this repo runs it.** An extract reads only the byte ranges it needs
from the remote Protomaps build, so it downloads a few tens of MB, not the
planet. Do not download a full planet file for this.

Run it on a machine with disk and network of your choosing, not in CI.

## 1. Get the `pmtiles` CLI

Download a release binary from <https://github.com/protomaps/go-pmtiles/releases>
(Apache-2.0 / BSD; check its licence file) and put it on your `PATH`.
`pmtiles version` should answer.

## 2. Pick a build

Protomaps publishes daily planet builds. Look at the current list at
<https://maps.protomaps.com/builds/> and note the file name, for example
`20261001.pmtiles`. The source URL has the form
`https://build.protomaps.com/<DATE>.pmtiles`. Confirm the URL on that page
before you rely on it.

## 3. Extract the regions

[`extract-regions.geojson`](extract-regions.geojson) holds four boxes: Zimbabwe
(`25.2,-22.45,33.1,-15.55`) and small boxes around Lusaka, Nairobi and
Singapore. Edit it to change the set.

```sh
BUILD=20261001   # a date from the builds page

pmtiles extract "https://build.protomaps.com/${BUILD}.pmtiles" nyuchi-maps.pmtiles \
  --region=scripts/extract-regions.geojson \
  --maxzoom=14
```

- `--maxzoom=14` keeps the archive small. Dropping it keeps the source's
  maximum zoom (15) and grows the file.
- Add `--dry-run` first: it prints the number of tiles and the bytes it would
  download, and downloads nothing.
- For a single box, `--bbox=25.2,-22.45,33.1,-15.55` replaces `--region`.

## 4. Check it

```sh
pmtiles show nyuchi-maps.pmtiles        # header: type mvt, tile compression gzip, zooms, bounds
pmtiles verify nyuchi-maps.pmtiles
```

The Worker expects a PMTiles v3 archive of MVT tiles with gzip tile compression
(what Protomaps builds use). It passes the tile bytes through compressed, so
brotli or zstd archives are refused with a 500.

## 5. Fonts and sprites

The styles use the `Noto Sans Regular`, `Noto Sans Medium`,
`Noto Sans Italic` and `Noto Sans Devanagari Regular v1` font stacks and the
`light` and `dark` sprites. Take the
prebuilt glyph PBFs and sprites from
<https://github.com/protomaps/basemaps-assets> (check their licence, see
`NOTICE`) and lay them out as:

```text
fonts/OFL.txt          (copy of licenses/OFL-1.1-Noto-Sans.txt)
fonts/Noto Sans Regular/0-255.pbf ...
fonts/Noto Sans Medium/...  fonts/Noto Sans Italic/...
fonts/Noto Sans Devanagari Regular v1/...
sprites/light.json   sprites/light.png   sprites/light@2x.json   sprites/light@2x.png
sprites/dark.json    sprites/dark.png    sprites/dark@2x.json    sprites/dark@2x.png
```

## 6. Upload (owner only)

The bucket does not exist yet; creating it, and the cost, need the owner's
approval. Once it exists, with its real name in place of `<bucket>`:

```sh
npx wrangler r2 object put "<bucket>/tiles/nyuchi-maps.pmtiles" \
  --file nyuchi-maps.pmtiles --content-type application/octet-stream --remote
```

Do the same for each font and sprite object. Large files (over about 300 MB)
need an S3-compatible client such as `rclone` instead of `wrangler`.

## Refreshing

Edge-cached tiles live for up to 30 days, so replacing the object alone leaves
stale tiles in the cache. A refresh has three mandatory steps:

1. Rebuild from a newer `BUILD` date and upload over the same key.
2. Bump `TILES_VERSION` in `wrangler.jsonc` (for example `"2"`) and deploy. It
   is part of the edge cache key, so every tile cached from the old archive is
   retired at once.
3. Check `GET /v1/tiles.json` and a few tiles.

The Worker also notices the replaced object by ETag on its next range read, but
that does not clear the Cache API; `TILES_VERSION` does.
