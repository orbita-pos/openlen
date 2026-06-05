import { describe, it, expect } from "vitest";
import { seedBrandIntoHtml, profileMeta } from "./seed-html";
import { coerceBusinessData } from "@/lib/style-match/autofill/types";
import type { BusinessProfileData } from "./types";

const HTML =
  "<html><head><title>x</title></head><body><h1>Hi</h1></body></html>";

function profile(over: Partial<BusinessProfileData> = {}): BusinessProfileData {
  return { ...coerceBusinessData({}), ...over };
}

describe("seedBrandIntoHtml", () => {
  it("is a no-op for an empty profile (Business seeds, never gates)", () => {
    expect(seedBrandIntoHtml(HTML, profile())).toBe(HTML);
  });

  it("applies the brand accent when set", () => {
    const out = seedBrandIntoHtml(
      HTML,
      profile({ brand: { accent: "#1166EE", logoUrl: null } }),
    );
    expect(out).toContain("data-ol-accent-applied");
    expect(out).toContain("#1166ee");
  });

  it("appends a contact widget when there is real contact", () => {
    const out = seedBrandIntoHtml(
      HTML,
      profile({
        contact: {
          whatsapp: "5512345678",
          phone: null,
          email: null,
          address: null,
          socials: null,
        },
      }),
    );
    expect(out).toContain("data-ol-contact-widget");
    expect(out).toContain("wa.me/");
  });

  it("recolor:false keeps the design's accent but still adds the contact widget", () => {
    const data = profile({
      brand: { accent: "#1166EE", logoUrl: null },
      contact: {
        whatsapp: "5512345678",
        phone: null,
        email: null,
        address: null,
        socials: null,
      },
    });
    const out = seedBrandIntoHtml(HTML, data, { recolor: false });
    expect(out).not.toContain("data-ol-accent-applied");
    expect(out).toContain("data-ol-contact-widget");
  });

  it("adds NO contact widget when the contact block is all empty", () => {
    const out = seedBrandIntoHtml(
      HTML,
      profile({
        contact: {
          whatsapp: null,
          phone: null,
          email: null,
          address: null,
          socials: null,
        },
      }),
    );
    expect(out).not.toContain("data-ol-contact-widget");
  });

  it("is idempotent — re-seeding never duplicates the widget or accent", () => {
    const data = profile({
      brand: { accent: "#1166EE", logoUrl: null },
      contact: {
        whatsapp: "5512345678",
        phone: null,
        email: null,
        address: null,
        socials: null,
      },
    });
    const once = seedBrandIntoHtml(HTML, data);
    const twice = seedBrandIntoHtml(once, data);
    expect(twice).toBe(once);
    expect(twice.match(/data-ol-contact-widget/g)?.length).toBe(1);
    expect(twice.match(/data-ol-accent-applied/g)?.length).toBe(1);
  });
});

describe("profileMeta", () => {
  it("maps logo + first photo", () => {
    const m = profileMeta(
      profile({
        brand: { accent: null, logoUrl: "https://x/logo.png" },
        photos: ["https://x/p1.jpg", "https://x/p2.jpg"],
      }),
    );
    expect(m).toEqual({
      logoUrl: "https://x/logo.png",
      ogImage: "https://x/p1.jpg",
    });
  });

  it("is undefined-valued when the profile has no logo/photos", () => {
    expect(profileMeta(profile())).toEqual({
      logoUrl: undefined,
      ogImage: undefined,
    });
  });
});
