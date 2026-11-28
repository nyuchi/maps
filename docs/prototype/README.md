# Console prototype

A static visual prototype of the Nyuchi Maps developer console, for the design
in [../console-design.md](../console-design.md). It is **not** shipped by the
Worker and nothing in it is production code. All figures, keys and origins on
its pages are invented, and each page says so.

It is built from the real Mzizi Dashboard Standard: the pure Astro app
components of [`@bundu/ui`](https://www.npmjs.com/package/@bundu/ui) 0.17.0
(MIT), the Mzizi tokens, floor and density CSS, and the Nyuchi brand overlay.
Things that are ours are marked `TODO(mzizi)` or as proposals:
`src/styles/maps-pill.css` (the pill and round-icon overlay),
`src/components/BottomNav.astro` (a port of the registry's `mzizi-bottom-nav`,
which has Rust and React builds only), `src/components/ThemeToggle.astro` and
`public/shell.js` (a round theme switch in the sidebar footer, and a real button
with `aria-expanded` for the shell's collapse toggle), and
`src/components/RadixIcon.astro` (the icon seam: Radix icons, generated into
`src/radix.ts` by `scripts/gen-radix.mjs`, stand in for every Mzizi icon, inside
`@bundu/ui` too). `public/proposed-nyuchi-maps-icon.svg` is a proposal for the owner
to approve, not a logo in use; the sidebar uses the official Nyuchi mark.

The Explorer, Embed builder and Coverage pages draw the real map with the
vendored MapLibre GL JS. They read styles and tiles from
`http://localhost:8787`, so run the Worker against the real bucket first.

```sh
# 1. The Worker, with local origins allowed (.dev.vars is git-ignored).
printf 'PUBLIC_BASE_URL=http://localhost:8787\nALLOWED_ORIGINS=http://localhost:8787,http://localhost:8788\n' > .dev.vars
npx wrangler dev --remote --port 8787

# 2. The prototype (needs Node for Astro; Deno can run the same commands).
cd docs/prototype
npm install --legacy-peer-deps
npm run build
python3 -m http.server 8788 --directory dist
```

Then open `http://localhost:8788`. Delete `.dev.vars` when you are done.
