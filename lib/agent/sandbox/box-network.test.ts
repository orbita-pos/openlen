import { describe, expect, it } from "vitest";

import { BOX_MARKER_HEADER } from "./box-marker";
import { PAGE_CDNS, boxNetworkFor } from "./box-network";

describe("the box's network for its project", () => {
  const hosts = {
    canvasHost: "lienzo-0123456789abcdef0123456789abcdef.openlen.app",
    backendHost: "abcdefghijklmnopqrst.openlen.app",
    publishedHost: "masa.openlen.app",
  };

  it("opens the project's canvas, backend and published page, each with the marker", () => {
    const n = boxNetworkFor({ ...hosts, marker: "p.mac" })!;
    expect(n.hosts).toEqual([hosts.canvasHost, hosts.backendHost, hosts.publishedHost]);
    expect(n.headers).toEqual({ [BOX_MARKER_HEADER]: "p.mac" });
  });

  it("only what the project has (no backend, never published)", () => {
    expect(boxNetworkFor({ canvasHost: hosts.canvasHost, backendHost: null, publishedHost: null, marker: "p.mac" })!.hosts).toEqual([hosts.canvasHost]);
  });

  it("🔴 without a marker, none of OpenLen's hosts: a curl from the box could write to production", () => {
    expect(boxNetworkFor({ ...hosts, marker: null })).toBeNull();
  });

  it("nothing to open, nothing", () => {
    expect(boxNetworkFor({ canvasHost: null, backendHost: null, publishedHost: null, marker: "p.mac" })).toBeNull();
  });

  it("the CDNs pages load their styles, fonts and libraries from", () => {
    for (const h of ["cdn.tailwindcss.com", "fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com", "cdn.shopify.com"]) expect(PAGE_CDNS).toContain(h);
  });

  // Shopify (spec local 2026-10-22-shopify-storefront, §6.2): the connected store, allowed
  // with no header rule — it isn't OpenLen's.
  const STORE = ["hydrogen-preview.myshopify.com", "checkout.hydrogen.shop"];

  it("the connected store's hosts beside OpenLen's, which keep their marker", () => {
    const n = boxNetworkFor({ canvasHost: hosts.canvasHost, backendHost: null, publishedHost: null, marker: "p.mac", thirdPartyHosts: STORE })!;
    expect(n.hosts).toEqual([hosts.canvasHost]);
    expect(n.headers).toEqual({ [BOX_MARKER_HEADER]: "p.mac" });
    expect(n.thirdPartyHosts).toEqual(STORE);
  });

  it("without a marker the store is still reachable, but none of OpenLen's hosts", () => {
    expect(boxNetworkFor({ ...hosts, marker: null, thirdPartyHosts: STORE })).toEqual({ hosts: [], headers: {}, thirdPartyHosts: STORE });
    expect(boxNetworkFor({ canvasHost: null, backendHost: null, publishedHost: null, marker: "p.mac", thirdPartyHosts: [] })).toBeNull();
  });
});
