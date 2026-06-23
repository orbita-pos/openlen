import { describe, it, expect } from "vitest";
import { normalizeProfileData } from "./normalize";

describe("normalizeProfileData", () => {
  it("preserves an explicit showContactWidget:false", () => {
    expect(normalizeProfileData({ showContactWidget: false }).showContactWidget).toBe(false);
  });

  it("preserves an explicit showContactWidget:true", () => {
    expect(normalizeProfileData({ showContactWidget: true }).showContactWidget).toBe(true);
  });

  it("leaves showContactWidget undefined when absent (defaults ON downstream)", () => {
    expect(normalizeProfileData({}).showContactWidget).toBeUndefined();
  });

  it("ignores non-boolean showContactWidget", () => {
    expect(normalizeProfileData({ showContactWidget: "yes" }).showContactWidget).toBeUndefined();
  });

  it("preserves a valid contactWidgetSide and drops an invalid one", () => {
    expect(normalizeProfileData({ contactWidgetSide: "left" }).contactWidgetSide).toBe("left");
    expect(normalizeProfileData({ contactWidgetSide: "right" }).contactWidgetSide).toBe("right");
    expect(normalizeProfileData({ contactWidgetSide: "top" }).contactWidgetSide).toBeUndefined();
  });

  it("still normalizes brand/photos/links alongside the flag", () => {
    const out = normalizeProfileData({
      showContactWidget: false,
      brand: { accent: "#112233", logoUrl: "https://x/l.png" },
      photos: ["https://x/p.jpg", 7],
      links: [{ type: "website", url: "https://x.com" }, { url: "" }],
    });
    expect(out.showContactWidget).toBe(false);
    expect(out.brand).toEqual({ accent: "#112233", logoUrl: "https://x/l.png" });
    expect(out.photos).toEqual(["https://x/p.jpg"]);
    expect(out.links).toEqual([{ type: "website", url: "https://x.com" }]);
  });
});
