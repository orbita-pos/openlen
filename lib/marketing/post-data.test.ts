import { describe, expect, it } from "vitest";
import { buildPostData, extractRootToken } from "./post-data";

const pageHtml = `<html><head><style>:root{--accent:#2F6B3E;--bg:#FBF7EF}</style></head><body><h1>Café Terral</h1></body></html>`;

describe("extractRootToken", () => {
  it("pulls a css var from :root", () => {
    expect(extractRootToken(pageHtml, "--accent")).toBe("#2F6B3E");
    expect(extractRootToken(pageHtml, "--missing")).toBeNull();
  });
});

describe("buildPostData", () => {
  it("prefers profile data, falls back to page", () => {
    const d = buildPostData({
      html: pageHtml, subdomain: "terral", pageTitle: "Café Terral",
      profile: { business_name: "Terral Café", contact: { whatsapp: "5215512345678", phone: "55 1234 5678", address: null, socials: null }, brand: { logoUrl: null, accent: "#AA3311" } } as never,
      userOffer: "2x1 en latte",
    });
    expect(d.businessName).toBe("Terral Café");
    expect(d.accent).toBe("#AA3311");
    expect(d.offer).toBe("2x1 en latte");
    expect(d.url).toBe("terral.openlen.com");
    expect(d.phone).toBe("55 1234 5678");
    expect(d.logoInitial).toBe("T");
  });
  it("works with no profile at all (page-derived)", () => {
    const d = buildPostData({ html: pageHtml, subdomain: null, profile: null, pageTitle: "Café Terral" });
    expect(d.businessName).toBe("Café Terral");
    expect(d.accent).toBe("#2F6B3E");
    expect(d.url).toBeUndefined();
  });
});
