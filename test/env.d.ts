// The bindings from wrangler.jsonc, as the Worker sees them in `cloudflare:test`.
export {};

declare global {
  namespace Cloudflare {
    interface Env {
      MAPS_BUCKET: R2Bucket;
    }
  }
}
