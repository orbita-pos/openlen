import { describe, expect, it } from "vitest";

import { instructionsUrl, providerFromNs } from "./dns-instructions";

describe("the provider behind a domain, by its name servers", () => {
  it("recognizes the common ones", () => {
    expect(providerFromNs(["ns1.domaincontrol.com", "ns2.domaincontrol.com"])).toBe("godaddy");
    expect(providerFromNs(["dns1.registrar-servers.com"])).toBe("namecheap");
    expect(providerFromNs(["ns1.dns-parking.com"])).toBe("hostinger");
    expect(providerFromNs(["Lola.NS.Cloudflare.com."])).toBe("cloudflare");
    expect(providerFromNs(["ns-cloud-a1.googledomains.com"])).toBe("squarespace");
    expect(providerFromNs(["ns1.otro.mx"])).toBe("other");
    expect(providerFromNs([])).toBe("other");
  });

  it("each known provider has its help page; other has none", () => {
    for (const p of ["godaddy", "namecheap", "hostinger", "cloudflare", "squarespace"] as const) expect(instructionsUrl(p)).toMatch(/^https:\/\//);
    expect(instructionsUrl("other")).toBeNull();
  });
});
