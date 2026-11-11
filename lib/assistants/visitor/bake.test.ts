// What publishing bakes as the page's bubble (phase 2A): her, when she is on the page; today's assistant otherwise.
import { describe, expect, it } from "vitest";

import { DEFAULT_LOOK } from "@/lib/figure/look";

import { assistantBakeOf } from "./bake";

const LOOK = { v: 1, shape: "heart", color: "#5fb8a6", eyes: "round", eyewear: "none", accessory: "crown" } as const;
const LUCIA = { name: "Lucía", color: "#5fb8a6", look: LOOK };

describe("assistantBakeOf", () => {
  it("publishing bakes her when she is on the page, with her whole figure, and not the old assistant", () => {
    expect(assistantBakeOf({ legacyEnabled: true, businessName: "Pastelería Canela", onPage: LUCIA })).toEqual({
      enabled: true,
      businessName: "Pastelería Canela",
      persona: { name: "Lucía", look: LOOK },
    });
  });

  it("without her, today's assistant as before", () => {
    expect(assistantBakeOf({ legacyEnabled: true, businessName: "Taller", onPage: null })).toEqual({ enabled: true, businessName: "Taller" });
  });

  it("neither: no bubble", () => {
    expect(assistantBakeOf({ legacyEnabled: false, businessName: "Taller", onPage: null })).toBeUndefined();
  });

  it("🔴 a row from before the figures bakes the default look in the color it had", () => {
    expect(assistantBakeOf({ legacyEnabled: false, businessName: "T", onPage: { name: "Lucía", color: "#5FB8A6" } })?.persona?.look).toEqual({ ...DEFAULT_LOOK, color: "#5fb8a6" });
  });

  it("🔴 a look or a color that isn't of the catalog never reaches the page", () => {
    expect(assistantBakeOf({ legacyEnabled: false, businessName: "T", onPage: { name: "L", color: "red;}</style>", look: { ...LOOK, shape: "<script>" } } })?.persona?.look).toEqual(DEFAULT_LOOK);
    expect(assistantBakeOf({ legacyEnabled: false, businessName: "T", onPage: { name: "L", color: "#5fb8a6", look: { ...LOOK, color: "red;}</style>" } } })?.persona?.look).toEqual({ ...DEFAULT_LOOK, color: "#5fb8a6" });
  });
});
