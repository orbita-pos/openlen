// What the box may reach of OpenLen (plan local 2026-10-21-playwright-in-the-box): its project's canvas
// (the draft, for its tests), backend and published page, each with E2B's header rule that adds the box's
// marker (./box-marker.ts) — so from the box, production is read-only. Pure: herramienta.ts gathers the
// hosts, the driver turns this into E2B's allowOut and rules.

import { BOX_MARKER_HEADER } from "./box-marker";

/** Where pages load their styles, fonts and libraries from: without them a page in the box renders bare. */
export const PAGE_CDNS: readonly string[] = [
  "cdn.tailwindcss.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "cdnjs.cloudflare.com",
];

export interface BoxNetwork {
  /** OpenLen's hosts of the project: allowed, each with a header rule (E2B: up to 10). */
  readonly hosts: readonly string[];
  readonly headers: Readonly<Record<string, string>>;
}

export function boxNetworkFor(i: {
  readonly canvasHost: string | null;
  readonly backendHost: string | null;
  readonly publishedHost: string | null;
  readonly marker: string | null;
}): BoxNetwork | null {
  // Without the marker nothing would make production read-only for the box: none of OpenLen's hosts.
  if (!i.marker) return null;
  const hosts = [i.canvasHost, i.backendHost, i.publishedHost].filter((h): h is string => Boolean(h));
  return hosts.length > 0 ? { hosts, headers: { [BOX_MARKER_HEADER]: i.marker } } : null;
}
