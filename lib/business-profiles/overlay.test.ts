import { describe, it, expect } from "vitest";
import { overlayProfile, hasRealContact, isProfileFilled } from "./overlay";
import { coerceBusinessData } from "@/lib/style-match/autofill/types";
import type { BusinessProfileData } from "./types";

describe("overlayProfile", () => {
  it("real profile values win; empty profile fields keep the invented copy", () => {
    const copy = coerceBusinessData({
      business_name: "Invented Co",
      industry: "invented industry",
    });
    const data = coerceBusinessData({ business_name: "Café Luna" });
    const out = overlayProfile(copy, data);
    expect(out.business_name).toBe("Café Luna"); // real wins
    expect(out.industry).toBe("invented industry"); // blank in profile → kept
  });

  it("an empty profile overlays nothing", () => {
    const copy = coerceBusinessData({ business_name: "Invented Co" });
    const out = overlayProfile(copy, coerceBusinessData({}));
    expect(out.business_name).toBe("Invented Co");
  });

  it("overlays contact only when it has a real value", () => {
    const copy = coerceBusinessData({});
    const withContact = coerceBusinessData({
      contact: {
        whatsapp: "5512345678",
        phone: null,
        email: null,
        address: null,
        socials: null,
      },
    });
    expect(overlayProfile(copy, withContact).contact?.whatsapp).toBe(
      "5512345678",
    );

    const emptyContact = coerceBusinessData({
      contact: {
        whatsapp: null,
        phone: null,
        email: null,
        address: null,
        socials: null,
      },
    });
    expect(overlayProfile(copy, emptyContact).contact).toBe(copy.contact);
  });
});

describe("isProfileFilled", () => {
  const profile = (over: Partial<BusinessProfileData>): BusinessProfileData => ({
    ...coerceBusinessData({}),
    ...over,
  });

  it("is false for the empty lazy default", () => {
    expect(isProfileFilled(coerceBusinessData({}))).toBe(false);
  });

  it("is true with a business name", () => {
    expect(isProfileFilled(coerceBusinessData({ business_name: "Café Luna" }))).toBe(
      true,
    );
  });

  it("is true with only a brand accent (no copy/contact)", () => {
    expect(isProfileFilled(profile({ brand: { accent: "#1166EE", logoUrl: null } }))).toBe(
      true,
    );
  });

  it("is true with a contact value", () => {
    expect(
      isProfileFilled(
        coerceBusinessData({
          contact: {
            whatsapp: "5512345678",
            phone: null,
            email: null,
            address: null,
            socials: null,
          },
        }),
      ),
    ).toBe(true);
  });
});

describe("hasRealContact", () => {
  it("is false for null or an all-empty block", () => {
    expect(hasRealContact(null)).toBe(false);
    expect(hasRealContact(coerceBusinessData({}).contact)).toBe(false);
  });

  it("is true when any field (incl. a social) is set", () => {
    expect(
      hasRealContact({
        whatsapp: "55",
        phone: null,
        email: null,
        address: null,
        socials: null,
      }),
    ).toBe(true);
    expect(
      hasRealContact({
        whatsapp: null,
        phone: null,
        email: null,
        address: null,
        socials: {
          instagram: "@x",
          facebook: null,
          tiktok: null,
          website: null,
        },
      }),
    ).toBe(true);
  });
});
