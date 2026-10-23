// What the box may reach of OpenLen (plan local 2026-10-21-playwright-in-the-box): its project's canvas
// (the draft, for its tests), backend and published page, each with E2B's header rule that adds the box's
// marker (./box-marker.ts) — so from the box, production is read-only. And, since Shopify (spec local
// 2026-10-22-shopify-storefront, §6.2), the project's connected store: not OpenLen's, so no rule. Pure:
// herramienta.ts gathers the hosts, the driver turns this into E2B's allowOut and rules.

import { BOX_MARKER_HEADER } from "./box-marker";

/** Where pages load their styles, fonts and libraries from: without them a page in the box renders bare. */
export const PAGE_CDNS: readonly string[] = [
  "cdn.tailwindcss.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "cdnjs.cloudflare.com",
  // Shopify's Storefront Web Components and its product images.
  "cdn.shopify.com",
];

export interface BoxNetwork {
  /** OpenLen's hosts of the project: allowed, each with a header rule (E2B: up to 10). */
  readonly hosts: readonly string[];
  readonly headers: Readonly<Record<string, string>>;
  /** Hosts that aren't OpenLen's (the connected Shopify store): allowed, with no header rule. */
  readonly thirdPartyHosts?: readonly string[];
}

export function boxNetworkFor(i: {
  readonly canvasHost: string | null;
  readonly backendHost: string | null;
  readonly publishedHost: string | null;
  readonly marker: string | null;
  readonly thirdPartyHosts?: readonly string[];
}): BoxNetwork | null {
  const thirdParty = i.thirdPartyHosts ?? [];
  // Without the marker nothing would make production read-only for the box: none of OpenLen's hosts.
  const hosts = i.marker ? [i.canvasHost, i.backendHost, i.publishedHost].filter((h): h is string => Boolean(h)) : [];
  if (hosts.length > 0) return { hosts, headers: { [BOX_MARKER_HEADER]: i.marker! }, ...(thirdParty.length > 0 ? { thirdPartyHosts: thirdParty } : {}) };
  return thirdParty.length > 0 ? { hosts: [], headers: {}, thirdPartyHosts: thirdParty } : null;
}
