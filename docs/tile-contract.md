# Nyuchi Maps tile contract

Status: draft for review, written 2026-11-04 for nyuchi/maps#4.

|               | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decided       | The owner adopted five tile standards on 2026-11-04 (bundu-labs/bundu-standards#41, merged): OGC API - Tiles Part 1 Core, OGC 2D Tile Matrix Set and Tile Set Metadata 2.0, Mapbox Vector Tile 2.1, TileJSON 3.0.0, PMTiles 3. Two register rules were recorded with it: OGC API - Tiles is the canonical description of a tile set, and TileJSON is derived from it; the scope of the OGC entry is the Nyuchi Maps tile contract, so the weather Worker's `/v1/map-tiles` Tomorrow.io proxy and the MapTiler base map in use today, which predate it, are not covered. |
| This document | A draft contract. Where a choice is ours and not the standard's it is marked **[ours]**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Built         | Nothing. The TypeScript scaffold on `staging` serves different routes; [section 11](#11-delta-from-the-scaffold) lists the differences. No bucket, host or deployment exists.                                                                                                                                                                                                                                                                                                                                                                                           |

The contract is for whoever reads our tiles: a MapLibre developer who points a style at us, a GIS user who adds us to QGIS, an OpenLayers developer, the weather app, Kweli, and the engineer who writes the Rust core, origin and edge from it. It is written from the standards, not from MapTiler's layout and not from the scaffold.

Contents:

1. [How to read this document](#1-how-to-read-this-document)
2. [Conformance classes](#2-conformance-classes)
3. [Datasets, resources and paths](#3-datasets-resources-and-paths)
4. [Tile matrix sets](#4-tile-matrix-sets)
5. [TileJSON, derived from the tileset metadata](#5-tilejson-derived-from-the-tileset-metadata)
6. [PMTiles is storage, never the API](#6-pmtiles-is-storage-never-the-api)
7. [Credits, licence and the layer registry](#7-credits-licence-and-the-layer-registry)
8. [Cache contract and the edge/origin split](#8-cache-contract-and-the-edgeorigin-split)
9. [Examples](#9-examples)
10. [Test matrix](#10-test-matrix)
11. [Delta from the scaffold](#11-delta-from-the-scaffold)
12. [Not verified, and open](#12-not-verified-and-open)

## 1. How to read this document

Every requirement is cited to the clause that states it, with the standard's own strength kept: **SHALL** is a requirement, **SHOULD** a recommendation, **MAY** a permission. A SHOULD or MAY is never turned into a MUST here; where we skip a SHOULD, section 12 says so.

| Tag  | Document                                                                          | Status read on 2026-11-04                                             | How much I read                                                                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OT   | OGC API - Tiles - Part 1: Core 1.0, OGC 20-057 (`docs.ogc.org/is/20-057`)         | Approved 2022-08-26, published 2022-11-10                             | Clauses 2, 5, 7 to 16 and Annex A.1 to A.4, A.7.1, A.10.1 and A.10.6 in full. Clauses 4 and 6 and Annex A.7.2 skimmed. Annex A.5, A.6, A.8, A.9 and A.10.2 to A.10.5 not read (classes we do not implement). |
| TMS  | OGC Two Dimensional Tile Matrix Set and Tile Set Metadata 2.0, OGC 17-083r4       | Approved 2022-02-20, published 2022-09-09 (the document's own header) | Clauses 1, 2, 5 to 9 (JSON parts) in full, Annex D.1, D.2, H, I, J. Not read: XML encodings (7.2, 9.2), Annex A, C, E, G, and the Annex F examples (I used the live registry JSON instead).                  |
| CMN  | OGC API - Common - Part 1: Core 1.0.0, OGC 19-072 (`docs.ogc.org/is/19-072`)      | Approved 2022-02-02, published 2023-03-28                             | Clauses 8 (8.3.2 and 8.8 skimmed), 9, 10.3 and 11. Not read: the abstract tests and annexes.                                                                                                                 |
| MAPS | OGC API - Maps - Part 1: Core 1.0, OGC 20-058 (`docs.ogc.org/is/20-058`)          | Approved 2024-06-12, published 2024-08-09                             | The conformance class list and clause 8 (Map Tilesets) only.                                                                                                                                                 |
| TJ   | TileJSON 3.0.0 (`mapbox/tilejson-spec`, `3.0.0/README.md`)                        | Current text                                                          | In full.                                                                                                                                                                                                     |
| PM   | PMTiles version 3 (`protomaps/PMTiles`, `spec/v3/spec.md`)                        | Current text                                                          | In full.                                                                                                                                                                                                     |
| MVT  | Mapbox Vector Tile specification 2.1 (`mapbox/vector-tile-spec`, `2.1/README.md`) | Current text                                                          | Clauses 2 (file format), 3 (projection), 4.1 (layers) only. The geometry and attribute encodings were not read.                                                                                              |

Also fetched and used: the normative JSON schemas at `schemas.opengis.net/tms/2.0/json/` (`tileSet.json`, `tileMatrixSet.json`, `link.json`, and what they reference) and the registered `WebMercatorQuad` definition at `http://www.opengis.net/def/tilematrixset/OGC/1.0/WebMercatorQuad`.

Citations read like `OT §7.1.1 Req 1` (OT clause 7.1.1, Requirement 1), `TMS §8.2.2 Table 13`, `CMN §9.3.1 Req 16`, `TJ §3.2`, `PM §3.2`.

Three things to know before relying on a citation:

- OT §2 says its resource paths ("common paths") are examples and not required; other paths are allowed if the API definition and the links describe them (OT §2.4 NOTE, OT Table 1 NOTE). The path layout in section 3 is therefore ours.
- OT §3 cites OGC API - Common Parts 1 and 2 as drafts, and OT §6.3 calls OGC API - Maps a candidate standard. Part 1 of Common and Part 1 of Maps are now Approved (rows CMN and MAPS above); I did not check Common Part 2. The register entries from bundu-standards#41 list the five tile standards and not these. See section 12.5.
- The two register rules in the status table (OGC canonical, TileJSON derived) are as recorded with the adoption. I read the description of bundu-standards#41, not `register/register.yaml`.

## 2. Conformance classes

A conformance claim is made per Web API, and every dataset root in section 3 is its own Web API with its own `/conformance`. Conformance "shall be checked using all the relevant tests specified in Annex A" for each class declared (OT §2.5). Rule **[ours]**: a class is added to a dataset's `conformsTo` only when it is implemented for that dataset and its tests pass in CI. "First slice" below means the first release of the Rust origin, for the base map.

### 2.1 OGC API - Tiles

URIs are `http://www.opengis.net/spec/ogcapi-tiles-1/1.0/conf/{name}` (OT Table 7).

| Class                               | First slice          | Why                                                                                                                                                                                                                                              |
| ----------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core`                              | Yes                  | The tile resource (OT §7). Every tile API declares it.                                                                                                                                                                                           |
| `tileset`                           | Yes                  | Tileset metadata (OT §8, Req 8). Core Req 1C needs a way to get the URL template; this is it.                                                                                                                                                    |
| `tilesets-list`                     | Yes                  | A `/tiles` list per dataset (OT §9). Prerequisite of `dataset-tilesets`.                                                                                                                                                                         |
| `dataset-tilesets`                  | Yes                  | Links the landing page to the tilesets list (OT §10). Its prerequisites include OGC API - Common Part 1 core (OT §10.1), so we implement the Common classes below.                                                                               |
| `geodata-tilesets`                  | No                   | Needs OGC API - Common Part 2 collections (OT §11.1). A dataset here is one root with no `/collections`.                                                                                                                                         |
| `collections-selection`             | No                   | Same prerequisite (OT §12.1). A tile is never a composition chosen by the caller.                                                                                                                                                                |
| `datetime`                          | Not for the base map | For time-series layers (weather) when they ship, declared only by those datasets. It brings two parameters, `datetime` and `subset=datetime(...)` (OT §13.3 Req 17, 18; §13.4 Req 19 to 21; tests A.7.1 and A.7.2). Not built. See section 12.2. |
| `oas30`                             | No                   | OT §14 and CMN §11 are specific to OpenAPI 3.0 (CMN Req 22 names `version=3.0`). Our contract is OpenAPI 3.1 (org rule). We do not claim a 3.0 class. The `service-desc` link still points at the OpenAPI document (CMN Req 14).                 |
| `xml`                               | No                   | Would make `application/xml` mandatory on every list and tileset (OT §15, Req 24). No consumer.                                                                                                                                                  |
| `png`                               | Yes, for `map`       | Raster tiles (OT §16.2, Req 26).                                                                                                                                                                                                                 |
| `mvt`                               | Yes, for `vector`    | Vector tiles (OT §16.7, Req 33).                                                                                                                                                                                                                 |
| `jpeg`, `tiff`, `netcdf`, `geojson` | No                   | No layer needs them. PNG is the better format for transparency and few colours (OT §7.1.6 Rec 2).                                                                                                                                                |

### 2.2 OGC API - Common Part 1 and OGC 2D TMS

| Class                                                                                                                                                                                     | First slice | Why                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http://www.opengis.net/spec/ogcapi-common-1/1.0/conf/core`                                                                                                                               | Yes         | HTTP 1.1, status codes, query-parameter rules (CMN §8). Prerequisite of `dataset-tilesets`.                                                                                      |
| `http://www.opengis.net/spec/ogcapi-common-1/1.0/conf/landing-page`                                                                                                                       | Yes         | Landing page, API definition link, conformance resource (CMN §9).                                                                                                                |
| `http://www.opengis.net/spec/ogcapi-common-1/1.0/conf/json`                                                                                                                               | Yes         | JSON for the landing page and conformance (CMN §10.3, Req 20, 21).                                                                                                               |
| `.../ogcapi-common-1/1.0/conf/html`                                                                                                                                                       | No          | A SHOULD (CMN §8.7 Rec 11), skipped in the first slice.                                                                                                                          |
| `http://www.opengis.net/spec/tms/2.0/conf/{name}` for `tilematrixset`, `json-tilematrixset`, `tilematrixsetlimits`, `json-tilematrixsetlimits`, `tilesetmetadata`, `json-tilesetmetadata` | Yes         | We serve exactly these documents (TMS §2). Declaring them is our choice **[ours]**: OT Req 7 requires listing the classes of OT Table 7, and says nothing about the TMS classes. |
| TMS `variablematrixwidth`, `xml-*`                                                                                                                                                        | No          | No variable-width tile matrix set (TMS §6.2.2), no XML.                                                                                                                          |

### 2.3 OGC API - Maps

Nothing is declared. OGC API - Maps Part 1 is approved, but "supporting map tiles and map tilesets without conforming to this requirements class is possible" (MAPS §8.1). We implement none of its parameters (`bgcolor`, `transparent`, `scale-denominator`, `width`, `height`, `mm-per-pixel`). Its conformance URIs and link relations are spelled with `https://` (`https://www.opengis.net/spec/ogcapi-maps-1/1.0/conf/...`), while OT spells its own with `http://`; the difference is listed in section 12.

## 3. Datasets, resources and paths

### 3.1 Two kinds of dataset

| Kind     | `dataType` (TMS Table 18)                                                        | Tile media type                                                   | URL suffix               | Landing page link relation                               |
| -------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------ | -------------------------------------------------------- |
| `vector` | `vector`: vector based elements, such as features with geometries and properties | `application/vnd.mapbox-vector-tile` (OT Req 33; MVT §2.2 SHOULD) | `.mvt` (MVT §2.1 SHOULD) | `http://www.opengis.net/def/rel/ogc/1.0/tilesets-vector` |
| `map`    | `map`: images representing colors for pictorial representation on the screen     | `image/png` (OT Req 26)                                           | `.png`                   | `http://www.opengis.net/def/rel/ogc/1.0/tilesets-map`    |

The base map is a `vector` dataset. A rendered raster layer, such as weather rain, is a `map` dataset. `coverage` is not used.

### 3.2 Path layout **[ours]**

```text
https://maps.nyuchi.com/v1/
  tileMatrixSets                                                   all datasets share these
  tileMatrixSets/{tileMatrixSetId}
  datasets/{datasetId}/                                            landing page (the "root")
  datasets/{datasetId}/conformance
  datasets/{datasetId}/tiles                                       tilesets list
  datasets/{datasetId}/tiles/{tileMatrixSetId}                     tileset metadata
  datasets/{datasetId}/tiles/{tileMatrixSetId}/{tileMatrix}/{tileRow}/{tileCol}.{ext}   one tile
```

Why this shape:

- It follows the "common paths" of OT Table 8, which the standard says are examples (section 1). `/tiles` under the root is OT §10.4 Req 12 and Rec 10; `/tiles/{tileMatrixSetId}` is the form the abstract tests expect for a tileset (OT Annex A.3, abstract test A.9, step 6).
- One kind per root. OT Table 4 shows `/map/tiles` for a root that offers both a vector and a map view. Our roots offer one kind, so a `map` dataset also lists its tilesets at `{root}/tiles`; the link relation (`tilesets-map`), not the path, says the kind. Req 12 asks for a tileset list at "…/tiles" under the dataset resource, which this satisfies.
- `{tileMatrix}/{tileRow}/{tileCol}` is the common order the standard recommends (OT §7.1.1 Rec 1, SHOULD). Row comes before column, so the path reads `z/y/x`, the reverse of the habitual `z/x/y`. TileJSON replaces its `{z}`, `{x}` and `{y}` tokens by name wherever they sit in the URL (TJ §3.2), so the order should not matter to MapLibre; that has not been run (section 10).
- `{datasetId}` follows the existing name rule `^[a-z][a-z0-9-]{0,31}$`, 1 to 32 characters (`src/validate.ts`). An id is stable and never reused.
- The tile matrix sets are one shared copy; every landing page links to them with the `tiling-schemes` relation (OT §8.3.1; Rec 6D).
- The `/v1` prefix is the version of this contract. The OGC class versions are in the conformance URIs.

### 3.3 Resources

All are `GET`; `HEAD` is answered the same way without a body **[ours]**. All JSON is `application/json` (TMS Req 7 and Req 25 for the TMS and tileset documents; CMN Req 20 for the landing page and conformance).

| Resource             | Path                                                                    | Class                                  | Required content                                                                                                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Landing page         | `{root}/`                                                               | CMN `landing-page`, `json`             | `links` required; `title`, `description`, `attribution` (CMN §9.1.2 Req 13). Links: `service-desc` (CMN Req 14), `http://www.opengis.net/def/rel/ogc/1.0/conformance` (CMN Req 13), `tilesets-vector` or `tilesets-map` (OT Req 11), `tiling-schemes` (OT Rec 6D). |
| Conformance          | `{root}/conformance`                                                    | CMN `landing-page`                     | `{"conformsTo": [...]}` listing the classes of section 2 (CMN Req 16, 17; OT Req 7).                                                                                                                                                                               |
| Tile matrix set list | `/v1/tileMatrixSets`                                                    | OT Rec 6                               | `{"tileMatrixSets": [{id, uri, title, links}]}` (OT §8.3.2).                                                                                                                                                                                                       |
| Tile matrix set      | `/v1/tileMatrixSets/{tileMatrixSetId}`                                  | TMS `json-tilematrixset`               | The registered definition, byte for byte. A local copy is recommended (OT §8.1) and, for a set not in a register, the API SHOULD serve it (OT Rec 6B).                                                                                                             |
| Tilesets list        | `{root}/tiles`                                                          | OT `tilesets-list`, `dataset-tilesets` | `{"tilesets": [...]}`; each item has `dataType`, `crs`, a `self` link, a `http://www.opengis.net/def/rel/ogc/1.0/tiling-scheme` link and `tileMatrixSetURI` (OT §9.2.2 Req 10). SHOULD have a `title` (Rec 9).                                                     |
| Tileset metadata     | `{root}/tiles/{tileMatrixSetId}`                                        | OT `tileset`                           | TileSetMetadata JSON (OT Req 8, TMS Req 17, 18, Table 13). Section 3.4.                                                                                                                                                                                            |
| Tileset as TileJSON  | `{root}/tiles/{tileMatrixSetId}?f=tilejson`                             | derived (section 5)                    | TileJSON 3.0.0. Linked from the tileset metadata with `rel: alternate`.                                                                                                                                                                                            |
| Tile                 | `{root}/tiles/{tileMatrixSetId}/{tileMatrix}/{tileRow}/{tileCol}.{ext}` | OT `core` + `mvt` or `png`             | Section 3.5.                                                                                                                                                                                                                                                       |

The API definition is the repo's `GET /openapi.json` (OpenAPI 3.1), linked as `service-desc` from every landing page (CMN Req 14). `{root}/api` is not provided; that is a SHOULD (CMN §9.2.1 Rec 15) and section 12 lists it.

The query parameter `f` selects the representation (CMN §8.7 allows a query parameter for this). It is declared on every JSON resource with the value `json`; on the tileset metadata it also accepts `tilejson`. `f` wins over `Accept` **[ours]**. The tileset metadata endpoint must also negotiate `application/json` through `Accept` (OT Req 8A).

### 3.4 Tileset metadata

The JSON schema (`tileSet.json`, fetched 2026-11-04) requires `dataType` and `crs` and forbids no additional members. The other Table 13 members are populated as follows.

| Member                 | Populated                         | Source                                                                                                                                                                                              | Citation                        |
| ---------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `title`, `description` | Yes                               | Registry (section 7)                                                                                                                                                                                | TMS Table 13                    |
| `keywords`             | If the registry has them          | Registry; a plain array of strings in JSON                                                                                                                                                          | TMS Table 10                    |
| `version`              | Yes                               | Archive metadata `version` (a semver string, PM §5). Bump rule below. For time-series layers see section 12.2.                                                                                      | TMS Table 13                    |
| `pointOfContact`       | If the registry has `contact`     | Registry                                                                                                                                                                                            | TMS Table 13                    |
| `attribution`          | Yes                               | Rendered from the credits file only (section 7)                                                                                                                                                     | TMS Table 13 note b             |
| `license`              | Yes                               | Registry `licence`                                                                                                                                                                                  | TMS Table 13                    |
| `accessConstraints`    | Yes                               | `access: open` gives `unclassified`; `access: keyed` gives `restricted` **[ours]**. The code list is a security classification (TMS Table 17), not a licensing vocabulary; this is the nearest fit. | TMS Table 17                    |
| `mediaTypes`           | Never                             | "Intended for offline use"; online, the `item` links carry the media type                                                                                                                           | TMS Table 13 note c             |
| `dataType`, `crs`      | Yes                               | Dataset kind; `http://www.opengis.net/def/crs/EPSG/0/3857` for `WebMercatorQuad`                                                                                                                    | TMS Table 13                    |
| `epoch`                | Never                             | Not a dynamic-CRS use                                                                                                                                                                               | TMS Table 13                    |
| `tileMatrixSet`        | Never                             | The object form is "not intended for OGC APIs"; we link instead                                                                                                                                     | TMS §8.2.2 Req 17 NOTE 1        |
| `tileMatrixSetURI`     | Yes                               | Canonical registered URI                                                                                                                                                                            | TMS Req 17B (SHALL); OT Req 8C  |
| `tileMatrixSetLimits`  | Always                            | Computed from the storage bounds and zooms with TMS Annex I.1. Always emitted so that min and max zoom are derivable                                                                                | TMS Req 18B (SHALL for partial) |
| `boundingBox`          | Yes                               | `{crs: CRS84, lowerLeft, upperRight}`                                                                                                                                                               | OT Rec 7 (SHOULD)               |
| `created`, `updated`   | `updated` yes; `created` if known | RFC 3339 UTC                                                                                                                                                                                        | TMS Table 13                    |
| `layers`               | Yes                               | `vector`: one entry per MVT layer, from the archive's `vector_layers`. `map`: one entry for the layer.                                                                                              | TMS Table 14                    |
| `style`                | No                                | Styles are not OGC resources here (section 3.6)                                                                                                                                                     | TMS Table 16                    |
| `centerPoint`          | Yes                               | `{crs: CRS84, coordinates: [lon, lat], tileMatrix}`                                                                                                                                                 | TMS Table 20                    |
| `links`                | Yes                               | Table below                                                                                                                                                                                         | TMS Table 13 note j; OT Req 8   |

Version bump rule **[ours]**, because TJ §3.17 says implementations MUST NOT use tiles of different major versions: a rebuild from newer map data increments the minor version; a change of layer names or fields is a major change and publishes a new dataset id instead (section 8.1), so that the URL tells the two apart and no cache or client mixes them.

Links on a tileset:

| `rel`                                                  | `type`                                              | Notes                                                                                                                                                                                               |
| ------------------------------------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `self`                                                 | `application/json`                                  | OT Req 10B.                                                                                                                                                                                         |
| `alternate`                                            | `application/json+vnd.mapbox.tilejson`              | The TileJSON. This `rel` and `type` string are exactly as printed in TMS Annex H.1 (informative); `f=tilejson` is the example's query form. Only for `WebMercatorQuad` (section 5).                 |
| `http://www.opengis.net/def/rel/ogc/1.0/tiling-scheme` | `application/json`                                  | SHALL (OT Req 8D).                                                                                                                                                                                  |
| `item`                                                 | `application/vnd.mapbox-vector-tile` or `image/png` | `templated: true` (SHALL, OT Req 8G), the three variables `{tileMatrix}`, `{tileRow}`, `{tileCol}` (Req 8E), and `type` because the link is format-specific (Req 8F). One `item` link per encoding. |
| `http://www.opengis.net/def/rel/ogc/1.0/dataset`       | `application/json`                                  | The landing page.                                                                                                                                                                                   |
| `http://www.opengis.net/def/rel/ogc/1.0/conformance`   | `application/json`                                  | SHOULD (OT Rec 8).                                                                                                                                                                                  |
| `license`                                              | none                                                | IANA relation to the licence text **[ours]**. OT §5.2 allows additional links.                                                                                                                      |

### 3.5 Tile resource

Path parameters (OT §7.1.2 to 7.1.5):

- `tileMatrixSetId`: a string. An extra variable the API definition MAY add to make paths homogeneous (OT Per 1).
- `tileMatrix`: a string, the `id` of a TileMatrix. For `WebMercatorQuad`, `"0"` to `"24"` (TMS Annex D.1). Only ids listed in `tileMatrixSetLimits` are served; a matrix not listed "should be interpreted as a tileMatrix that is not available" (TMS Req 16B).
- `tileRow`: an integer from 0 to MatrixHeight - 1, within the limits (OT Table 9). Row 0 is the top, because the tile matrix's corner of origin is `topLeft`, the default (TMS §6.1.1, Table 8).
- `tileCol`: an integer from 0 to MatrixWidth - 1, within the limits (OT Table 9).
- The suffix (`.mvt`, `.png`) selects the encoding, as in the standard's own example (TMS Annex H.1). `Accept` is not used on tile URLs **[ours]**, so a cache never has to vary on it (section 8).

The text of OT Req 3 and Req 4 mentions MatrixWidth for the row and MatrixHeight for the column. That is swapped relative to OT Table 9. We follow Table 9. `WebMercatorQuad` is square, so no tile is affected.

Responses:

| Case                                                                                                                          | Status                                                | Basis                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tile with content                                                                                                             | 200                                                   | OT Req 5A. One tile only (Req 26A, 33A). `map`: the PNG is exactly `tileWidth` by `tileHeight` pixels, 256 for `WebMercatorQuad` (Req 5C), uses alpha for partial transparency (Req 26C), and all tiles of a tileset follow the same portrayal rules (Req 26D).                                                                                        |
| Inside the limits, no data (`vector`)                                                                                         | 204                                                   | OT Req 6B allows 204 or a blank 200.                                                                                                                                                                                                                                                                                                                   |
| Inside the limits, no data (`map`)                                                                                            | 200 with a fully transparent PNG of tile size         | OT Req 6B accepts "a 200 with the content of a blank response compatible with the requested media type"; its test A.7 gives a PNG "with internal headers and no pixels" as an example. A transparent tile-size PNG also meets Req 5C. The choice of 200 over 204 for rasters is ours: browser raster loaders' 204 handling was not checked. **[ours]** |
| Valid in the tile matrix set but outside the dataset's limits (a zoom it does not hold, or a row or column outside its range) | 404                                                   | OT Req 6A: outside "the tile matrix set or tile matrix set limits" the status is 404 or 400. TMS §8.1.2: the area outside the limits is empty space the tileset does not cover.                                                                                                                                                                        |
| Not valid in the tile matrix set (a `tileMatrix` id the set does not define, a row or column beyond the matrix)               | 400                                                   | OT Req 6A permits 400 or 404; 400 is what the scaffold does for these.                                                                                                                                                                                                                                                                                 |
| Malformed path value (not an integer, a leading zero)                                                                         | 400                                                   | CMN Table 2. Stricter than the standard, as the scaffold already is **[ours]**.                                                                                                                                                                                                                                                                        |
| A suffix the dataset does not offer                                                                                           | 404                                                   | No such resource. The scaffold's `format_mismatch`.                                                                                                                                                                                                                                                                                                    |
| Unknown query parameter, or an invalid value                                                                                  | 400                                                   | CMN §8.3 Req 2, Req 3 (the permitted tolerances are not used). This also keeps tile cache keys free of junk.                                                                                                                                                                                                                                           |
| `If-None-Match` matches                                                                                                       | 304                                                   | CMN §8.4 Rec 8 (entity tags SHOULD be supported).                                                                                                                                                                                                                                                                                                      |
| Method other than GET or HEAD                                                                                                 | 405                                                   | CMN Table 2.                                                                                                                                                                                                                                                                                                                                           |
| Rate limited                                                                                                                  | 429 with `Retry-After`                                | HTTP. Raised by the edge (section 8).                                                                                                                                                                                                                                                                                                                  |
| Any other error                                                                                                               | RFC 9457 problem document, `application/problem+json` | CMN §8.2 Rec 3 and §10.3 Rec 18 recommend a problem-details report (they cite RFC 7807; RFC 9457 obsoletes it and is the org's rule).                                                                                                                                                                                                                  |

Response headers on a tile: `Content-Type`; `Content-Encoding: gzip` when the stored tile is gzip (PM §3.2 Tile Compression); `ETag`; `Cache-Control`; `Vary` (section 8). Optional headers named by the standard and not in the first slice: `OATiles-hint: empty` or `full` (OT §7.1.6 Rec 4); `OGCAPI-datetime` (OT §13.5 Rec 14, with the `datetime` class).

### 3.6 What is not an OGC resource here

Styles, fonts and sprites are MapLibre assets. None of the five adopted standards covers them (OGC API - Styles is not adopted), and `style` in the tileset metadata is not populated. Their routes (`/v1/styles`, `/v1/fonts`, `/v1/sprites`) are unchanged by this contract. A style references a tileset through its TileJSON (section 5).

## 4. Tile matrix sets

| Id                                                                                                       | URI                                                                       | CRS       | First slice | Notes                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WebMercatorQuad`                                                                                        | `http://www.opengis.net/def/tilematrixset/OGC/1.0/WebMercatorQuad`        | EPSG:3857 | Yes         | The grid of the mass market: TMS Annex D.1 names Google Maps, Bing Maps and OpenStreetMap tiles. It is also what XYZ tiles in MapLibre use. 25 matrices, `"0"` to `"24"`, 256 by 256 pixel tiles, matrix 0 is 1 by 1 and matrix _z_ is 2^_z_ by 2^_z_, corner of origin top left. The only set TileJSON can express (TJ §3.15). TMS D.1 says it "should be limited to visualization": no distance measurement, no routing. |
| `WorldCRS84Quad`                                                                                         | `http://www.opengis.net/def/tilematrixset/OGC/1.0/WorldCRS84Quad`         | CRS84     | No          | TMS Annex D.2.1 (the recommended variant; D.2.2 is the EPSG:4326 axis-order variant). A dataset may add it only if its storage or renderer produces tiles in it. Its scale denominators equal `WebMercatorQuad`'s but the identifiers are shifted by one (TMS D.2 NOTE 2), a source of confusion.                                                                                                                          |
| `WorldMercatorWGS84Quad`                                                                                 | `http://www.opengis.net/def/tilematrixset/OGC/1.0/WorldMercatorWGS84Quad` | EPSG:3395 | No          | Ellipsoidal Mercator (TMS Annex D.3). TMS D.1 NOTE 4 recommends it where positioning accuracy matters. We have no such consumer. Revisit if routing arrives.                                                                                                                                                                                                                                                               |
| UTM, polar stereographic, Lambert azimuthal and conic (Annex D.4 to D.8), GNOSIS and CDB grids (Annex E) | n/a                                                                       | various   | No          | No consumer. The variable-width grids need the `variablematrixwidth` class (TMS §6.2.2).                                                                                                                                                                                                                                                                                                                                   |

A second tile matrix set is a second tile pyramid, not a view of the first. Tiles are not reprojected between sets, because re-sampling degrades them (TMS §6.1.3).

The registered `WebMercatorQuad` JSON was fetched on 2026-11-04. It has 25 matrices, validates against `tileMatrixSet.json`, and its numbers match Annex D.1 (section 10).

## 5. TileJSON, derived from the tileset metadata

The rule from the register: the OGC tileset metadata is canonical; a TileJSON document is derived from it and never states a bound, zoom range or tile URL the metadata does not (**[ours]**, enforced by making the derivation one pure function of one tileset document, with no access to the registry). The standard itself describes a TileJSON as an alternate representation of a tileset (TMS Table 13 note j; Annex H.1). TileJSON "usually implies a WebMercatorQuad TileMatrixSet and the reference to it is implicit" (OT §8.2.2). It assumes the spherical Mercator profile (TJ §3.15), so a tileset in any other tile matrix set has no `alternate` link and no TileJSON.

| TileJSON member                                   | From the tileset                                       | Rule                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tilejson` (TJ §3.1)                              | none                                                   | The constant `"3.0.0"`: the version of the format being written.                                                                                                                                                                                                                                                     |
| `tiles` (TJ §3.2)                                 | the `item` link whose `type` is the dataset's encoding | `{tileMatrix}` becomes `{z}`, `{tileRow}` becomes `{y}`, `{tileCol}` becomes `{x}`. The URL is absolute (TJ requires it). It is the same string as the OGC link apart from the variable names, so MapLibre and an OGC client fetch and cache the same URLs.                                                          |
| `scheme` (TJ §3.15)                               | the tile matrix set's `cornerOfOrigin`                 | `topLeft`, the default for `WebMercatorQuad`, gives `"xyz"` (TMS Table 8 footnote a). `bottomLeft` would give `"tms"`; we have none.                                                                                                                                                                                 |
| `name` (TJ §3.14)                                 | `title`                                                | Verbatim.                                                                                                                                                                                                                                                                                                            |
| `description` (TJ §3.8)                           | `description`                                          | Verbatim.                                                                                                                                                                                                                                                                                                            |
| `version` (TJ §3.17)                              | `version`                                              | Only if it is a valid semver string; otherwise omitted. TJ requires semver, TMS does not.                                                                                                                                                                                                                            |
| `attribution` (TJ §3.4)                           | `attribution`                                          | Verbatim. Both standards warn that the text may be shown as HTML (TJ §3.4; TMS Table 13 note b): it is generated only from the credits file.                                                                                                                                                                         |
| `minzoom`, `maxzoom` (TJ §3.12, 3.13)             | `tileMatrixSetLimits`                                  | The smallest and largest numeric `tileMatrix` id listed. For `WebMercatorQuad` the id is the zoom.                                                                                                                                                                                                                   |
| `bounds` (TJ §3.5)                                | `boundingBox`                                          | `[lowerLeft[0], lowerLeft[1], upperRight[0], upperRight[1]]`, which is west, south, east, north. Requires `crs` CRS84, and a box that does not cross the antimeridian (TJ forbids wrapping).                                                                                                                         |
| `center` (TJ §3.6)                                | `centerPoint`                                          | `[lon, lat, Number(tileMatrix)]`, only if `centerPoint.crs` is CRS84 and the id is an integer. A tileset without a CRS84 center point has no `center`: the default CRS of a center point is the tileset's (EPSG:3857, metres), and the derivation does not transform.                                                |
| `vector_layers` (TJ §3.3)                         | `layers` (vector only)                                 | `id` from `id`; `fields` from `propertiesSchema.properties` (value is the property's `title`, else `String`, `Number` or `Boolean` from its JSON Schema `type`); `minzoom` and `maxzoom` from `minTileMatrix` and `maxTileMatrix`; `description`. Omitted for `map` datasets, where TJ §3.3 says it is not required. |
| `legend`, `fillzoom`, `data`, `grids`, `template` | none                                                   | Never emitted. The tileset metadata has no counterpart, so the TileJSON may not state them. Weather legends live in the style and the registry until the metadata can carry them (section 12).                                                                                                                       |

How a style references it: the vector source carries `url` and nothing else, exactly as the scaffold does today:

```json
{ "type": "vector", "url": "https://maps.nyuchi.com/v1/datasets/basemap/tiles/WebMercatorQuad?f=tilejson" }
```

A raster source also needs `tileSize`, which TileJSON cannot carry. The style generator reads it from the tile matrix set (`tileWidth` 256), so the style says `"tileSize": 256`. To my knowledge MapLibre's default for raster sources is 512, and an unset value would then ask for the wrong zoom; I did not check that, and none of this was run (section 10).

Credits: styles add none. The only credit channel is the source's `attribution`, so a client that reads the style (MapLibre, through TileJSON) and a client that reads the OGC tileset show the same text, because both are produced by `attributionHtml()` from `src/credits.ts` (section 7).

## 6. PMTiles is storage, never the API

A dataset's tiles live in one PMTiles archive (version 3) or are rendered on demand. Clients never see byte ranges, offsets or a `pmtiles://` URL, and no OGC link points at an archive. If downloadable regions for offline use are offered later, they are a separate resource (media type `application/vnd.pmtiles`, PM §1) outside this contract.

| PMTiles                                                                                      | Tileset                                                                                                        | Rule                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header: Tile Type `0x01` MVT (PM §3.2)                                                       | `dataType: vector`; `item` link type `application/vnd.mapbox-vector-tile`, suffix `.mvt`                       | PM §5: an MVT archive MUST have `vector_layers` in its metadata. An archive without it is refused at registration.                                                                                                                                                         |
| Tile Type `0x02` PNG                                                                         | `dataType: map`; `image/png`, suffix `.png`                                                                    |                                                                                                                                                                                                                                                                            |
| Tile Type `0x03` JPEG, `0x04` WebP, `0x05` AVIF, `0x06` MapLibre Vector Tile, `0x00` unknown | none                                                                                                           | Refused at registration: no declared class covers them (OT Per 2 would allow another format, but none of the five standards defines these as tile encodings here).                                                                                                         |
| Min Zoom, Max Zoom (PM §3.2)                                                                 | first and last `tileMatrix` id in `tileMatrixSetLimits`                                                        | Zoom _z_ is `tileMatrix` `"z"` in `WebMercatorQuad`.                                                                                                                                                                                                                       |
| Min Position, Max Position (PM §3.4)                                                         | `boundingBox` (CRS84) and, per zoom, the rows of `tileMatrixSetLimits`                                         | Positions are signed 32-bit integers, longitude then latitude, divided by 10,000,000. Limits come from TMS Annex I.1 applied to the box at each zoom.                                                                                                                      |
| Center Zoom, Center Position (PM §3.2)                                                       | `centerPoint` `{crs: CRS84, coordinates: [lon, lat], tileMatrix: String(centerZoom)}`                          |                                                                                                                                                                                                                                                                            |
| Tile Compression `gzip` (PM §3.3)                                                            | `Content-Encoding: gzip` on the tile                                                                           | `none`: no header. `brotli`, `zstd`: the origin decodes for clients that do not accept them, or the archive is refused. The scaffold refuses with a 500; the choice is open (section 12).                                                                                  |
| Internal Compression, directories, Hilbert tile ids                                          | none                                                                                                           | Internal to the reader.                                                                                                                                                                                                                                                    |
| Metadata `vector_layers` (PM §5; TJ §3.3)                                                    | `layers[]`: `id`; `propertiesSchema` from `fields`; `minTileMatrix`, `maxTileMatrix` from `minzoom`, `maxzoom` | `fields` values `Number`, `String`, `Boolean` become JSON Schema `number`, `string`, `boolean` (TMS Table 21); any other description becomes `{"description": ...}`.                                                                                                       |
| Metadata `version` (PM §5, semver)                                                           | `version`                                                                                                      | The only archive field served as is, besides the layer list. Absent: `version` is omitted.                                                                                                                                                                                 |
| Metadata `name`, `description`, `attribution`, `type`, `encoding`                            | none                                                                                                           | Never served. Title and description come from the registry; credits only from the credits file (a writer may put any text in an archive's `attribution`); `type` (`baselayer`/`overlay`) has no OGC or TileJSON counterpart; an `encoding` such as `terrarium` is refused. |

PMTiles addresses a tile by z, x, y with tile ids on a Hilbert curve (PM §4.1). The chapter I read does not state the direction of y. The contract assumes `y` is the row counted from the top (XYZ), which is what `WebMercatorQuad` uses; this must be confirmed against a real archive before anything ships, because the scaffold has only been tested against small in-memory archives.

## 7. Credits, licence and the layer registry

Nothing is served without a licence and a credit (issues #3 and #4). The registry is the one place a dataset is declared; everything in sections 3 and 5 is generated from it plus the storage.

| Registry field         | Values                                | Becomes                                                                                                                                                                              |
| ---------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                   | `[a-z][a-z0-9-]*`                     | `{datasetId}`                                                                                                                                                                        |
| `kind`                 | `vector`, `map`                       | `dataType`, media type, suffix, link relation (section 3.1)                                                                                                                          |
| `title`, `description` | text                                  | `title`, `description` of the landing page and tileset                                                                                                                               |
| `owner`                | `bundu`, `nyuchi`                     | No member at the tileset root exists for it (TMS Table 13). It is carried as `layers[].publisher` (TMS Table 14) where a layer entry is emitted, and otherwise only in the registry. |
| `licence`              | an SPDX id, or a named Nyuchi licence | `license`, and a `license` link when the licence has a URL                                                                                                                           |
| `access`               | `open`, `keyed`                       | `accessConstraints` (section 3.4). Key transport is not defined here (section 12).                                                                                                   |
| `credits`              | one or more ids from `src/credits.ts` | `attribution`, rendered by `attributionHtml(ids)`. The ids themselves are not published.                                                                                             |
| `refresh`              | a cadence rule                        | `updated`, and the cache lifetimes of section 8. The rule has no OGC member.                                                                                                         |
| `contact`              | optional                              | `pointOfContact`                                                                                                                                                                     |
| `storage`              | an archive key, or a renderer         | Section 6                                                                                                                                                                            |

Rules **[ours]**:

1. A dataset whose registry entry lacks `owner`, `licence`, `access`, `refresh`, `title` or at least one credit, or names a credit id the credits file does not hold, is a configuration error that stops the process at startup. It is never served half-described.
2. The one credit channel is `attribution`. The landing page, the tileset metadata and the TileJSON carry the same string. An archive's own `attribution` is never served.
3. A Nyuchi-owned dataset is its own dataset with its own storage, never merged into the OpenStreetMap-derived base archive. This is the boundary recorded in #4: OpenStreetMap data is ODbL and a derivative database could pull other data under it. The contract enforces it by keeping one archive per dataset. Whether tiles are a Produced Work, and the exact licence, are not settled here (`README.md` says to confirm with counsel).
4. `attribution` is a single string for a whole tileset. Where a layer has an ordered chain of sources (#3), the string must therefore credit every source that may serve it, so none is used uncredited. Crediting only the source on screen needs one tileset per source; that is open (section 12.3).

## 8. Cache contract and the edge/origin split

### 8.1 What the origin guarantees

The origin is the product. Run alone, with no Cloudflare in front, it answers every resource in section 3, with these headers. The starting values are the scaffold's constants (`src/http.ts`); they are **[ours]** and tunable per dataset by its `refresh` rule.

| Resource                                                                               | `Cache-Control`                                                         | Validator                                                                                                                  |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Tile (200)                                                                             | `public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400` | Strong `ETag`: storage version, tile address and the content coding applied (opaque to clients). `304` on `If-None-Match`. |
| Empty tile (204, or the blank PNG)                                                     | `public, max-age=3600, s-maxage=86400`                                  | As above.                                                                                                                  |
| Tile outside the dataset's limits (404)                                                | `public, max-age=300, s-maxage=300`                                     | None. A short life, so an extended archive is not hidden for long.                                                         |
| Landing page, conformance, tilesets list, tileset metadata, TileJSON, tile matrix sets | `public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400`    | Strong `ETag` of the body, one per content coding.                                                                         |
| Every other error (400, 404 for an unknown dataset or suffix, 405, 406, 429, 5xx)      | `no-store`                                                              | None.                                                                                                                      |

Time-series tiles are not covered by this table; see section 12.2. A URL that does not carry everything that determines its bytes must never be `immutable`. Where two rows could apply, the more specific one wins.

`Vary` **[ours]**:

- `Vary: Origin` on every response whose CORS headers depend on the request origin. Today that is every `/v1` response (`README.md`). A shared cache then keeps one copy per origin value; section 12 records the cost.
- `Vary: Accept-Encoding` where the origin chooses a content coding. Tiles are stored gzip, so the origin must decode them for a client that does not accept gzip; the scaffold sends gzip unconditionally.
- No `Vary: Accept` on tile URLs, because the suffix selects the encoding.

Replacing an archive. The edge Worker's own cache key includes the dataset `version` (as `TILES_VERSION` does in the scaffold), so at the Worker the change is exact. A shared cache that keys on the URL alone cannot see the version: after a rebuild it serves the old tile until its copy expires, up to the `s-maxage` above (30 days for tiles) unless the dataset's URLs are purged, and a browser for up to `max-age`. What the origin guarantees is the validator: once a copy expires, `If-None-Match` fails against the new `ETag`. A dataset that cannot accept that window sets shorter lifetimes through its `refresh` rule, and a release purges the dataset's URLs at the CDN in use. A major change is a new dataset id (section 3.4). Unknown query parameters are rejected (section 3.5), so a cache key can be the normalised URL.

### 8.2 What the edge does, and only that

The Cloudflare Worker is one edge in front of the origin (#4). Any CDN that honours the headers above could replace it without an origin change.

| Duty                                                                                                        | Edge           | Origin                                                      |
| ----------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------- |
| Serve every resource and status of sections 3 and 5                                                         | Passes through | Yes                                                         |
| Cache by `Cache-Control` and `ETag`                                                                         | Cache API      | Sets them; works uncached                                   |
| CORS allow-list (CMN §8.5 Rec 9: SHOULD support cross-origin; "support can also be added in a proxy layer") | Yes            | May also answer, so a browser can reach it without the edge |
| Rate limit before the origin                                                                                | Yes            | Not required                                                |
| Serve a stale tile, else a labelled placeholder, when the origin or a source fails                          | Yes            | No                                                          |

A fallback tile is a degraded answer, never truth. The placeholder depends on the kind **[ours]**. A `map` dataset gets a fully transparent PNG of tile size with status 200, so an image loader shows nothing and not an error. A `vector` dataset gets a 503 problem document, never a PNG, because an MVT decoder cannot read one; a client reports a failed vector tile and leaves it out (not run, section 10). Either way the response is labelled (`X-Map-Tile: unavailable`; #3 used `empty` for this case, but `empty` is better kept for "no data here"), carries `Cache-Control: no-store`, and never replaces a real answer in a cache. The source that served a tile is named in `X-Map-Source` (#3). Both headers are **[ours]** and not in the standards.

## 9. Examples

Section 10.1 says which of these documents were validated and against what: 9.3, 9.5 and the full weather document behind 9.7 against the normative schemas; 9.1, 9.2 and 9.4 only for their required members; 9.6 is the output of the derivation and was not run through a TileJSON validator. The values are illustrative: the box is the Zimbabwe region of `scripts/extract-regions.geojson` at zooms 0 to 14, not a real archive. The licence on the base-map example is the README's working assumption, not a settled classification.

### 9.1 Landing page, `GET /v1/datasets/basemap/`

```json
{
  "title": "Nyuchi Maps base map",
  "description": "Streets, places and boundaries from OpenStreetMap, as vector tiles.",
  "attribution": "<a href=\"https://maps.nyuchi.com\">Nyuchi Maps</a> | <a href=\"https://www.openstreetmap.org/copyright\">© OpenStreetMap contributors</a>",
  "links": [
    { "rel": "self", "type": "application/json", "title": "This document", "href": "https://maps.nyuchi.com/v1/datasets/basemap/" },
    { "rel": "service-desc", "type": "application/json", "title": "API definition (OpenAPI 3.1)", "href": "https://maps.nyuchi.com/openapi.json" },
    { "rel": "http://www.opengis.net/def/rel/ogc/1.0/conformance", "type": "application/json", "title": "Conformance classes", "href": "https://maps.nyuchi.com/v1/datasets/basemap/conformance" },
    { "rel": "http://www.opengis.net/def/rel/ogc/1.0/tilesets-vector", "type": "application/json", "title": "Vector tilesets", "href": "https://maps.nyuchi.com/v1/datasets/basemap/tiles" },
    { "rel": "http://www.opengis.net/def/rel/ogc/1.0/tiling-schemes", "type": "application/json", "title": "Tile matrix sets", "href": "https://maps.nyuchi.com/v1/tileMatrixSets" }
  ]
}
```

### 9.2 Conformance, `GET /v1/datasets/basemap/conformance`

```json
{
  "conformsTo": [
    "http://www.opengis.net/spec/ogcapi-common-1/1.0/conf/core",
    "http://www.opengis.net/spec/ogcapi-common-1/1.0/conf/landing-page",
    "http://www.opengis.net/spec/ogcapi-common-1/1.0/conf/json",
    "http://www.opengis.net/spec/ogcapi-tiles-1/1.0/conf/core",
    "http://www.opengis.net/spec/ogcapi-tiles-1/1.0/conf/tileset",
    "http://www.opengis.net/spec/ogcapi-tiles-1/1.0/conf/tilesets-list",
    "http://www.opengis.net/spec/ogcapi-tiles-1/1.0/conf/dataset-tilesets",
    "http://www.opengis.net/spec/ogcapi-tiles-1/1.0/conf/mvt",
    "http://www.opengis.net/spec/tms/2.0/conf/tilematrixset",
    "http://www.opengis.net/spec/tms/2.0/conf/json-tilematrixset",
    "http://www.opengis.net/spec/tms/2.0/conf/tilematrixsetlimits",
    "http://www.opengis.net/spec/tms/2.0/conf/json-tilematrixsetlimits",
    "http://www.opengis.net/spec/tms/2.0/conf/tilesetmetadata",
    "http://www.opengis.net/spec/tms/2.0/conf/json-tilesetmetadata"
  ]
}
```

### 9.3 Tilesets list, `GET /v1/datasets/basemap/tiles`

```json
{
  "tilesets": [
    {
      "title": "Nyuchi Maps base map",
      "dataType": "vector",
      "crs": "http://www.opengis.net/def/crs/EPSG/0/3857",
      "tileMatrixSetURI": "http://www.opengis.net/def/tilematrixset/OGC/1.0/WebMercatorQuad",
      "links": [
        { "rel": "self", "type": "application/json", "href": "https://maps.nyuchi.com/v1/datasets/basemap/tiles/WebMercatorQuad" },
        { "rel": "http://www.opengis.net/def/rel/ogc/1.0/tiling-scheme", "type": "application/json", "href": "https://maps.nyuchi.com/v1/tileMatrixSets/WebMercatorQuad" }
      ]
    }
  ]
}
```

### 9.4 Tile matrix set list, `GET /v1/tileMatrixSets`

```json
{
  "tileMatrixSets": [
    {
      "id": "WebMercatorQuad",
      "uri": "http://www.opengis.net/def/tilematrixset/OGC/1.0/WebMercatorQuad",
      "title": "Google Maps Compatible for the World",
      "links": [{ "rel": "self", "type": "application/json", "href": "https://maps.nyuchi.com/v1/tileMatrixSets/WebMercatorQuad" }]
    }
  ]
}
```

### 9.5 Tileset metadata, vector, `GET /v1/datasets/basemap/tiles/WebMercatorQuad`

```json
{
  "title": "Nyuchi Maps base map",
  "description": "Streets, places and boundaries from OpenStreetMap, as vector tiles.",
  "version": "1.0.0",
  "attribution": "<a href=\"https://maps.nyuchi.com\">Nyuchi Maps</a> | <a href=\"https://www.openstreetmap.org/copyright\">© OpenStreetMap contributors</a>",
  "license": "ODbL-1.0",
  "accessConstraints": "unclassified",
  "dataType": "vector",
  "crs": "http://www.opengis.net/def/crs/EPSG/0/3857",
  "tileMatrixSetURI": "http://www.opengis.net/def/tilematrixset/OGC/1.0/WebMercatorQuad",
  "tileMatrixSetLimits": [
    { "tileMatrix": "0", "minTileRow": 0, "maxTileRow": 0, "minTileCol": 0, "maxTileCol": 0 },
    { "tileMatrix": "1", "minTileRow": 1, "maxTileRow": 1, "minTileCol": 1, "maxTileCol": 1 },
    { "tileMatrix": "2", "minTileRow": 2, "maxTileRow": 2, "minTileCol": 2, "maxTileCol": 2 },
    { "tileMatrix": "3", "minTileRow": 4, "maxTileRow": 4, "minTileCol": 4, "maxTileCol": 4 },
    { "tileMatrix": "4", "minTileRow": 8, "maxTileRow": 9, "minTileCol": 9, "maxTileCol": 9 },
    { "tileMatrix": "5", "minTileRow": 17, "maxTileRow": 18, "minTileCol": 18, "maxTileCol": 18 },
    { "tileMatrix": "6", "minTileRow": 34, "maxTileRow": 36, "minTileCol": 36, "maxTileCol": 37 },
    { "tileMatrix": "7", "minTileRow": 69, "maxTileRow": 72, "minTileCol": 72, "maxTileCol": 75 },
    { "tileMatrix": "8", "minTileRow": 139, "maxTileRow": 144, "minTileCol": 145, "maxTileCol": 151 },
    { "tileMatrix": "9", "minTileRow": 278, "maxTileRow": 288, "minTileCol": 291, "maxTileCol": 303 },
    { "tileMatrix": "10", "minTileRow": 556, "maxTileRow": 577, "minTileCol": 583, "maxTileCol": 606 },
    { "tileMatrix": "11", "minTileRow": 1113, "maxTileRow": 1155, "minTileCol": 1167, "maxTileCol": 1212 },
    { "tileMatrix": "12", "minTileRow": 2227, "maxTileRow": 2310, "minTileCol": 2334, "maxTileCol": 2424 },
    { "tileMatrix": "13", "minTileRow": 4454, "maxTileRow": 4620, "minTileCol": 4669, "maxTileCol": 4849 },
    { "tileMatrix": "14", "minTileRow": 8908, "maxTileRow": 9240, "minTileCol": 9338, "maxTileCol": 9698 }
  ],
  "boundingBox": { "crs": "http://www.opengis.net/def/crs/OGC/1.3/CRS84", "lowerLeft": [25.2, -22.45], "upperRight": [33.1, -15.55] },
  "updated": "2026-11-04T00:00:00Z",
  "layers": [
    { "id": "water", "dataType": "vector", "geometryDimension": 2, "publisher": "Bundu Foundation",
      "propertiesSchema": { "type": "object", "properties": { "kind": { "type": "string" } } } },
    { "id": "roads", "dataType": "vector", "geometryDimension": 1, "publisher": "Bundu Foundation",
      "propertiesSchema": { "type": "object", "properties": { "kind": { "type": "string" }, "name": { "type": "string" }, "oneway": { "type": "boolean" } } } }
  ],
  "centerPoint": { "crs": "http://www.opengis.net/def/crs/OGC/1.3/CRS84", "coordinates": [31.05, -17.83], "tileMatrix": "9" },
  "links": [
    { "rel": "self", "type": "application/json", "href": "https://maps.nyuchi.com/v1/datasets/basemap/tiles/WebMercatorQuad" },
    { "rel": "alternate", "type": "application/json+vnd.mapbox.tilejson", "href": "https://maps.nyuchi.com/v1/datasets/basemap/tiles/WebMercatorQuad?f=tilejson" },
    { "rel": "http://www.opengis.net/def/rel/ogc/1.0/tiling-scheme", "type": "application/json", "href": "https://maps.nyuchi.com/v1/tileMatrixSets/WebMercatorQuad" },
    { "rel": "item", "type": "application/vnd.mapbox-vector-tile", "templated": true, "href": "https://maps.nyuchi.com/v1/datasets/basemap/tiles/WebMercatorQuad/{tileMatrix}/{tileRow}/{tileCol}.mvt" },
    { "rel": "http://www.opengis.net/def/rel/ogc/1.0/dataset", "type": "application/json", "href": "https://maps.nyuchi.com/v1/datasets/basemap/" },
    { "rel": "http://www.opengis.net/def/rel/ogc/1.0/conformance", "type": "application/json", "href": "https://maps.nyuchi.com/v1/datasets/basemap/conformance" },
    { "rel": "license", "href": "https://opendatacommons.org/licenses/odbl/1-0/" }
  ]
}
```

The limits were computed with TMS Annex I.1 from the box above, and the same box gives the same numbers from an independent slippy-map formula at zooms 0, 5, 9 and 14. The box covers Zimbabwe only. The real extract is Zimbabwe plus three city boxes (`scripts/extract-regions.geojson`), so its header box is the union of all four, and its limits are one rectangle per zoom covering the gaps between them. A tile inside the rectangle but outside a region is "inside the limits, no data": 204 (section 3.5).

### 9.6 The TileJSON derived from 9.5, `GET .../tiles/WebMercatorQuad?f=tilejson`

```json
{
  "tilejson": "3.0.0",
  "tiles": ["https://maps.nyuchi.com/v1/datasets/basemap/tiles/WebMercatorQuad/{z}/{y}/{x}.mvt"],
  "name": "Nyuchi Maps base map",
  "description": "Streets, places and boundaries from OpenStreetMap, as vector tiles.",
  "version": "1.0.0",
  "attribution": "<a href=\"https://maps.nyuchi.com\">Nyuchi Maps</a> | <a href=\"https://www.openstreetmap.org/copyright\">© OpenStreetMap contributors</a>",
  "scheme": "xyz",
  "minzoom": 0,
  "maxzoom": 14,
  "bounds": [25.2, -22.45, 33.1, -15.55],
  "center": [31.05, -17.83, 9],
  "vector_layers": [
    { "id": "water", "fields": { "kind": "String" } },
    { "id": "roads", "fields": { "kind": "String", "name": "String", "oneway": "Boolean" } }
  ]
}
```

### 9.7 Tileset metadata, map (illustrative weather layer)

Only what differs from 9.5 is shown; the omitted members follow the same rules. The `version` here is a model run time, which is not a semver string, so the derived TileJSON has no `version` (section 5). How a run and a valid time are represented is open (section 12.2).

```json
{
  "title": "Rain (illustrative)",
  "version": "2026-11-04T06:00:00Z",
  "license": "<licence id from the registry>",
  "accessConstraints": "unclassified",
  "dataType": "map",
  "crs": "http://www.opengis.net/def/crs/EPSG/0/3857",
  "tileMatrixSetURI": "http://www.opengis.net/def/tilematrixset/OGC/1.0/WebMercatorQuad",
  "layers": [{ "id": "rain", "dataType": "map" }],
  "links": [
    { "rel": "item", "type": "image/png", "templated": true, "href": "https://maps.nyuchi.com/v1/datasets/weather-rain/tiles/WebMercatorQuad/{tileMatrix}/{tileRow}/{tileCol}.png" }
  ]
}
```

## 10. Test matrix

### 10.1 What I ran (2026-11-04, scratch scripts, not in the repo)

| Check                                                                                                                                                                          | Result                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Example 9.5, and the full weather tileset of which 9.7 shows the differing members, validate against the normative `tileSet.json` (draft 2019-09, with its referenced schemas) | 0 errors each. A deliberately broken copy (no `crs`, bad `dataType`, null `href`) gives 3 errors, so the validator does reject. |
| Every JSON block of 9.1 to 9.6 equals the document the scripts generated and validated; the 9.7 members equal the generated ones                                               | Equal (the first draft of the 9.5 limits, typed by hand, was wrong in four rows; this check caught it).                         |
| Examples 9.1, 9.2, 9.4: required members only                                                                                                                                  | Present (`links` on the landing page, `conformsTo`, `tileMatrixSets`). No schema was run on them.                               |
| Example 9.3 validates against the tilesets-list schema of OT Req 10C                                                                                                           | 0 errors.                                                                                                                       |
| Registered `WebMercatorQuad` (fetched from the OGC definitions server) validates against `tileMatrixSet.json` and matches TMS Annex D.1                                        | 0 errors; 25 matrices `"0"` to `"24"`, all 256 by 256, matrix 0 is 1 by 1, matrix 14 is 16,384 wide.                            |
| `tileMatrixSetLimits` by TMS Annex I.1 against an independent slippy-map formula, zooms 0, 5, 9, 14                                                                            | Identical.                                                                                                                      |
| The derivation of section 5 applied to both tilesets                                                                                                                           | Runs; every member of the output traces to a tileset member; the map TileJSON has no `vector_layers` and no `version`.          |

Not run: any TileJSON validator, and the OGC abstract tests.

### 10.2 What is not tested

All client rows are **UNTESTED**. The statements about OpenLayers and QGIS are MapTiler's, from its OGC API - Tiles guide as quoted in #4, and I have not checked them.

| Client or tool                                                        | What it exercises                                                       | State        | What to look for                                                                                                                                                           |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MapLibre GL JS via a style `url` to the TileJSON                      | Vector and raster sources, attribution, zoom range                      | **UNTESTED** | Tokens in `{z}/{y}/{x}` order resolve; `204` is treated as an empty vector tile; the attribution shows once; a raster source with `tileSize: 256` requests the right zoom. |
| OpenLayers `OGCMapTile` and `OGCVectorTile`                           | Reading the tileset metadata URL, the `item` links, the tile matrix set | **UNTESTED** | MapTiler's guide says OpenLayers does not read the tile grid or `centerPoint` from the tileset by itself.                                                                  |
| QGIS (raster tiles through GDAL's OGC API driver)                     | Landing page, tilesets list, tileset                                    | **UNTESTED** | MapTiler's guide reports QGIS 3.38 with GDAL 3.9 on Windows, raster only, on a draft implementation "likely to change".                                                    |
| OGC abstract tests (OT Annex A) for each declared class               | The claim in `/conformance`                                             | **UNTESTED** | Whether an executable test suite for OGC API - Tiles 1.0 exists and can run in CI was not checked.                                                                         |
| Header checks (`ETag`, `304`, `Vary`, `Content-Encoding`) with `curl` | The cache contract                                                      | **UNTESTED** | Nothing implements the contract yet.                                                                                                                                       |
| A real PMTiles archive                                                | The PMTiles mapping, y direction, directory depth                       | **UNTESTED** | None exists; the scaffold was tested only against small in-memory archives.                                                                                                |

The tests the implementation owes, once there is code: the JSON schema checks of 10.1 on every resource it serves; the derivation as a pure function with a test that no TileJSON member lacks a source; a test that the landing page, tileset and TileJSON carry the same `attribution`; and one test per row of the status table in 3.5.

## 11. Delta from the scaffold

The scaffold on `staging` (PR #1) is a TypeScript Worker over one PMTiles archive in R2. It serves none of the OGC resources. Nothing is provisioned or deployed (`README.md`), so changing paths now breaks no consumer. The list below comes from reading `src/index.ts`, `src/http.ts`, `src/validate.ts` and `src/archive.ts`; it is not a proof that nothing else differs.

| Today                                                                                                                          | Under this contract                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `GET /v1/tiles.json`                                                                                                           | `GET /v1/datasets/basemap/tiles/WebMercatorQuad?f=tilejson`                                                     |
| `GET /v1/tiles/{z}/{x}/{y}.mvt`                                                                                                | `GET /v1/datasets/basemap/tiles/WebMercatorQuad/{tileMatrix}/{tileRow}/{tileCol}.mvt`                           |
| `GET /v1/sources/{id}/tiles.json` and `.../tiles/{z}/{x}/{y}.{ext}`                                                            | the same two, under `/v1/datasets/{id}/`                                                                        |
| (none)                                                                                                                         | landing page, conformance, tilesets list, tileset metadata, tile matrix sets                                    |
| TileJSON states `scheme`, `bounds`, `center`, `minzoom`, `maxzoom` from the PMTiles header                                     | The same members, derived from the tileset metadata, whose limits come from the header                          |
| `SOURCES` registry: archive key and credit ids                                                                                 | The layer registry of section 7 (adds `kind`, `owner`, `licence`, `access`, `refresh`)                          |
| Tile `ETag` `"<archive etag>:<z>/<x>/<y>"`                                                                                     | The same idea, opaque to clients                                                                                |
| Unknown query parameters ignored on tiles                                                                                      | Rejected with 400                                                                                               |
| Errors are `{"error": "<code>"}` (`jsonError`)                                                                                 | RFC 9457 `application/problem+json` documents (section 3.5)                                                     |
| A tile outside the archive's bounds but inside its zoom range: 204 (the scaffold has no limits)                                | 404 outside the declared limits; 204 only inside them                                                           |
| Row or column beyond the matrix, or zoom above `MAX_ZOOM` (22): 400                                                            | 400 for what the tile matrix set cannot hold, bounded by the set (ids 0 to 24); 404 beyond the dataset's limits |
| Archive tile types served: MVT, PNG, JPEG, WebP, AVIF, MapLibre Vector Tile (`.mvt`, `.png`, `.jpg`, `.webp`, `.avif`, `.mlt`) | MVT and PNG only; other types are refused at registration (section 6)                                           |
| Cache keys ignore the query string; the Worker's key includes `TILES_VERSION`                                                  | Same at the Worker; a URL-keyed CDN relies on lifetimes, purges and the validator (section 8.1)                 |
| Styles, fonts, sprites, `/health`, `/openapi.json`                                                                             | Unchanged, except that a style's vector source `url` points at the new TileJSON                                 |

## 12. Not verified, and open

### 12.1 Could not read or confirm

- **Clients.** None of the clients in 10.2 was run.
- **A real archive.** The y direction of PMTiles (section 6), directory depth and R2 range-read latency are unconfirmed.
- **The standards' full text.** I read the parts listed in section 1 and not the rest; in particular OT Annex A.5, A.6, A.8 to A.10.5 and the XML parts of TMS.
- **The TileJSON media type.** The `alternate` link `type` is the string printed in TMS Annex H.1, `application/json+vnd.mapbox.tilejson`. TJ §2 defines no media type, and I did not find that string registered. The TileJSON response itself is served as `application/json`, so the link's `type` is a hint and does not match the response header.
- **The register's own text.** I read the description of bundu-standards#41 and not `register/register.yaml`.

### 12.2 Time-series layers: how a tile that does not exist until asked for appears

What the standards say:

- A tileset describes the space of addressable tiles (tile matrix set, limits, bounding box), not which tiles are stored. A tile inside it with nothing stored is simply a tile: the server answers 204 or a blank 200 when there is nothing (OT Req 6B; TMS Req 18B). Rendering on demand needs no special metadata.
- Time on the tile request is the `datetime` class: `datetime` (an RFC 3339 instant or an interval, open ends with `..`) and `subset=datetime(...)` (OT §13). The server MAY return the closest or last previous time (OT Per 7), and SHOULD say which instant it returned in an `OGCAPI-datetime` header (OT Rec 14).
- For Geodata Tilesets, OT §13.2 says the collection description should state the temporal extent (OGC API - Common Part 2, which we do not implement); it names no place for a dataset root, and adds that a future revision of TMS "could take precedence". The TMS 2.0 tileset metadata has no temporal member (Table 13; `tileSet.json`). TMS Annex J (informative) sketches an `extraDimensions` member of a tile matrix or of the limits, with a time dimension; it is not in the 2.0 JSON schema, though the schema does not forbid extra members.
- OT `datetime` addresses one time axis. A forecast has two: the model run and the valid time. OGC API - Tiles has no concept of a run.

Two shapes, neither chosen:

- **A. One dataset per layer, `datetime` is the valid time.** The server picks the newest run that covers it; the run id goes in the `ETag` and a header. Tile URLs keep Core's shape; the same URL changes content when a new run lands, so it revalidates and is never `immutable`. The list of available times needs a place the standard does not give.
- **B. One dataset per published run,** each with `datetime` for the valid time and `immutable` tile URLs. A "latest" dataset's `item` links point at the newest run. Tiles are immutable, at the cost of many datasets and clients that must re-read the tileset to follow "latest".

Invariants for either: the bytes for one (dataset, run, valid time, z, row, column) never change; a URL that does not carry the run is never `immutable`; a response says which time and which source it came from; a degraded fallback is never cached as truth. The `datetime` class also obliges `subset=datetime(...)`.

### 12.3 Open design points

- **Base-map schema.** OpenMapTiles or the Protomaps schema is undecided and is not decided here. It decides the MVT layer and field names, so it fills `layers[]`; the contract does not depend on which.
- **Source-level credits.** `attribution` is one string per tileset (section 7, rule 4). Crediting only the source that served a tile needs one tileset per source of a layer, or a client that reads `X-Map-Source`. #3 should decide.
- **High-DPI raster tiles.** OT Req 5C makes an image tile exactly `tileWidth` by `tileHeight`, 256 for `WebMercatorQuad`, unless an extension overrides it. A 512-pixel tile would need a tile matrix set with 512-pixel tiles (the API may define its own, OT Rec 6B) or an extension. Not decided.
- **Keyed datasets.** `access: keyed` has no defined key transport. The only security requirement I found in CMN is inside its OpenAPI 3.0 class, which we do not claim (Req 27: document the security scheme in the API definition). A key in the query string would have to be declared in the API definition (CMN Req 2 rejects only parameters the definition does not specify), would have to be left out of the shared cache key, and leaks through logs and referrers; a header key cannot be added by a plain image loader without client code. Open.
- **Units and legends.** The JSON `propertiesSchema` has no member for `uom` or `observedProperty` (TMS Table 21: "N/A"), so UCUM units for weather values cannot ride in the standard tileset metadata. They stay in the registry and the style.
- **Languages.** Titles and descriptions are single-language. The standards use `Accept-Language` negotiation and `hreflang` (TMS Table 10; CMN §8.6 Rec 10). Shona and Ndebele are not provided.
- **CORS and `Vary: Origin`.** An allow-list with `Vary: Origin` splits shared-cache entries per origin. Open datasets could answer `*` and drop the `Vary`. That is a policy choice, not made here.
- **Compression the origin cannot pass through.** Refuse a non-gzip archive, or decode for the client. Open.

### 12.4 Skipped recommendations (SHOULD) and other deviations

| Item                                                  | Source                                                                                                                                                                                       | Why skipped                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Link-Template` header on the tileset response        | OT §8.2.2 Rec 5                                                                                                                                                                              | It cites an Internet-Draft.                                                                                                                                                                                                                     |
| `OATiles-hint: empty` or `full`                       | OT §7.1.6 Rec 4                                                                                                                                                                              | Needs a guarantee about all deeper zooms. A later optimisation.                                                                                                                                                                                 |
| `{root}/api`                                          | CMN §9.2.1 Rec 15                                                                                                                                                                            | The `service-desc` link is the way in.                                                                                                                                                                                                          |
| HTML encoding of the API resources                    | CMN §8.7 Rec 11; OT Per 3                                                                                                                                                                    | No consumer yet.                                                                                                                                                                                                                                |
| `oas30` classes                                       | OT §14; CMN §11                                                                                                                                                                              | Our API definition is OpenAPI 3.1.                                                                                                                                                                                                              |
| `https` versus `http` in link relation and class URIs | OT §5.2 versus MAPS §8.2                                                                                                                                                                     | OT prints `http://www.opengis.net/def/rel/ogc/1.0/tilesets-map`; MAPS prints the same relation with `https://`. We publish OT's spelling because OT is the adopted standard. A client that compares strings literally will not match the other. |
| Standard text that disagrees with itself              | OT Req 3, 4 (row and column limits swapped); TMS Table 14 (`maxScaleDenominator` and `maxCellSize` carry each other's definition); TMS Table 13 `mediaType` versus the schema's `mediaTypes` | We follow the tables and the schema.                                                                                                                                                                                                            |

### 12.5 Needs the owner

- **The register.** The five entries do not include OGC API - Common Part 1 (OGC 19-072), a prerequisite of the `dataset-tilesets` class we declare (OT §10.1). OGC API - Maps Part 1 is optional (section 2.3). Either add Common Part 1 to the register or accept the dependency in writing.
- **A date in the register.** bundu-standards#41 and the #4 comment say OGC 17-083r4 was approved 2022-03-24. The document's own header says approval 2022-02-20 and publication 2022-09-09. I did not find where 2022-03-24 comes from; check the entry.
- **The base-map schema** when it is ready to be chosen.
- **Counsel,** on the licence of the tiles and of the Kweli-derived layer, as #4 already records.
