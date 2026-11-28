import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";

// The icon seam: every `Icon.astro` import (ours and @bundu/ui's own) resolves to RadixIcon.
const RADIX = fileURLToPath(
  new URL("./src/components/RadixIcon.astro", import.meta.url),
);
const iconSeam = {
  name: "radix-icon-seam",
  enforce: "pre",
  resolveId(source) {
    return /(^|\/)Icon\.astro$/.test(source) ? RADIX : null;
  },
};
export default defineConfig({
  output: "static",
  devToolbar: { enabled: false },
  build: { inlineStylesheets: "never", assets: "_a" },
  vite: { plugins: [iconSeam, tailwindcss()] },
});
