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
    for (const h of ["cdn.tailwindcss.com", "fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com"]) expect(PAGE_CDNS).toContain(h);
  });
});
