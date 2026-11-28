import { CONSOLE_KEYS_URL } from "../config";

/** The sidebar, the drawer and (for the first five) the phone's bottom bar. */
export const NAV = [
  {
    href: "/",
    label: "Overview",
    icon: "home",
    group: "Maps",
    description: "Service health, tile facts and coverage",
  },
  {
    href: "/explorer/",
    label: "Explorer",
    icon: "map-pin",
    group: "Build",
    description: "The live map, light and dark",
  },
  {
    href: "/embed-builder/",
    label: "Embed builder",
    icon: "code",
    group: "Build",
    description: "Iframe and script snippets with a live preview",
  },
  {
    href: "/endpoints/",
    label: "Endpoints",
    icon: "terminal",
    group: "Build",
    description: "TileJSON, tiles, styles, glyphs and sprites, with snippets",
  },
  {
    href: CONSOLE_KEYS_URL,
    label: "Keys and usage",
    icon: "key",
    group: "Manage",
    badge: "Console",
    description:
      "Opens the Nyuchi Console, where API keys and usage live once the Maps API is enabled",
  },
  {
    href: "/docs/",
    label: "Docs",
    icon: "book",
    group: "Learn",
    description: "The contract, the tile format and the credit rule",
  },
  {
    href: "/status/",
    label: "Status",
    icon: "activity",
    group: "Learn",
    description: "Live checks of this service, measured from your browser",
  },
] as const;

export const GROUP_ORDER = ["Maps", "Build", "Manage", "Learn"];

export const PHONE_NAV = [
  { href: "/", label: "Overview", icon: "home" },
  { href: "/endpoints/", label: "Endpoints", icon: "terminal" },
  { href: "/explorer/", label: "Explorer", icon: "map-pin", fab: true },
  { href: "/embed-builder/", label: "Embed", icon: "code" },
  { href: "/docs/", label: "Docs", icon: "book" },
];
