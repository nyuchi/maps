/**
 * The one place the site's deployment facts live. Nothing else in the site
 * writes an origin, a path or a flag.
 */

/** This site: the dashboard, the embed page, and the tile origin behind the API. */
export const SITE_ORIGIN = "https://maps.nyuchi.com";

/**
 * Whether the public Maps API at api.nyuchi.com is live. While it is not,
 * every page that shows api.nyuchi.com URLs marks them "available when the
 * Maps API is enabled". Flip this one constant when the Nyuchi API serves
 * /v1/maps; the wording changes everywhere at once.
 */
export const MAPS_API_ENABLED = false;

/** The public API base. Maps is a namespace of the one Nyuchi API. */
export const MAPS_API_BASE = "https://api.nyuchi.com/v1/maps";

/** The Nyuchi Console page where signed-in developers get keys and see usage. */
export const CONSOLE_KEYS_URL =
  "https://platform.nyuchi.com/dashboard/developer/keys";

export const DOCS_URL = "https://docs.nyuchi.com";
export const PLATFORM_STATUS_URL = "https://status.nyuchi.com";

/** What the API badge says, in one phrase. */
export const API_BADGE = MAPS_API_ENABLED
  ? "Available"
  : "Available when the Maps API is enabled";
