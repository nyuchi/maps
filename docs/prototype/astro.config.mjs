import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
export default defineConfig({
  output: "static",
  devToolbar: { enabled: false },
  build: { inlineStylesheets: "never", assets: "_a" },
  vite: { plugins: [tailwindcss()] },
});
