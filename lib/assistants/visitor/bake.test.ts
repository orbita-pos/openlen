// What publishing bakes as the page's bubble (phase 2A): her, when she is on the page; today's assistant otherwise.
import { describe, expect, it } from "vitest";

import { assistantBakeOf } from "./bake";

const LUCIA = { name: "Lucía", color: "#5FB8A6", shape: "drop" };

describe("assistantBakeOf", () => {
  it("publishing bakes her when she is on the page, and not the old assistant", () => {
    expect(assistantBakeOf({ legacyEnabled: true, businessName: "Pastelería Canela", onPage: LUCIA })).toEqual({
      enabled: true,
      businessName: "Pastelería Canela",
      persona: { name: "Lucía", color: "#5FB8A6", shape: "drop" },
    });
  });

  it("without her, today's assistant as before", () => {
    expect(assistantBakeOf({ legacyEnabled: true, businessName: "Taller", onPage: null })).toEqual({ enabled: true, businessName: "Taller" });
  });

  it("neither: no bubble", () => {
    expect(assistantBakeOf({ legacyEnabled: false, businessName: "Taller", onPage: null })).toBeUndefined();
  });

  it("a shape or color that isn't hers never reaches the page", () => {
    expect(assistantBakeOf({ legacyEnabled: false, businessName: "T", onPage: { ...LUCIA, color: "red;}</style>" } })?.persona?.color).toBe("#F4A48B");
    expect(assistantBakeOf({ legacyEnabled: false, businessName: "T", onPage: { ...LUCIA, shape: "<script>" } })?.persona?.shape).toBe("blob");
  });
});
