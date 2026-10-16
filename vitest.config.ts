import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Tests run inside workerd via the Workers Vitest pool, against the real
// wrangler.jsonc. R2 and the rate limiter are stubbed in test/helpers.ts:
// no test ever touches a real bucket, the network or Cloudflare.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
