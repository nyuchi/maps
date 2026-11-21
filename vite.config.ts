// Vite+ configuration: the org's standard check and format settings.
// See nyuchi/.github/.github/workflows/reusable-vite-plus.yml.
//
// A plain object rather than defineConfig() from "vite-plus": this repo
// does not install vite-plus as a dependency, so `vp` comes from CI
// (voidzero-dev/setup-vp) or a global install (`npm i -g vite-plus`).
const config = {
  // `vp check` reads ONLY this block. These values mirror .prettierrc, which
  // the org lint uses on Markdown and JSON. Keep the two identical: two
  // formatters with different settings on one file can never both pass.
  fmt: {
    printWidth: 80,
    proseWrap: "preserve",
    tabWidth: 2,
    useTabs: false,
    endOfLine: "lf",
    trailingComma: "all",
    sortPackageJson: false,
    overrides: [
      {
        files: ["*.md", "*.mdx"],
        options: { embeddedLanguageFormatting: "off" },
      },
    ],
  },
};

export default config;
