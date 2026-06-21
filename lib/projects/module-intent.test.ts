// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyModuleIntent, detectModuleIntent } from "./module-intent";

describe("detectModuleIntent", () => {
  it("detects bookings + collections placeholders", () => {
    expect(detectModuleIntent("<section data-ol-bookings-section></section>")).toEqual({
      bookings: true,
      collections: false,
    });
    expect(detectModuleIntent("<div data-ol-collection-section></div>")).toEqual({
      bookings: false,
      collections: true,
    });
    expect(detectModuleIntent("<p>hi</p>")).toEqual({ bookings: false, collections: false });
  });
});

describe("applyModuleIntent", () => {
  it("enables a module whose placeholder appears", () => {
    const r = applyModuleIntent(undefined, "<section data-ol-collection-section></section>");
    expect(r.enabled).toEqual(["collections"]);
    expect(r.settings.collections?.enabled).toBe(true);
  });

  it("enables both when both appear, preserving existing settings", () => {
    const r = applyModuleIntent(
      { analyticsDisabled: true },
      "<section data-ol-bookings-section></section><section data-ol-collection-section></section>",
    );
    expect([...r.enabled].sort()).toEqual(["bookings", "collections"]);
    expect(r.settings.bookings?.enabled).toBe(true);
    expect(r.settings.collections?.enabled).toBe(true);
    expect(r.settings.analyticsDisabled).toBe(true);
  });

  it("is a no-op (same ref, empty enabled) when there are no markers", () => {
    const settings = { collections: { enabled: true } };
    const r = applyModuleIntent(settings, "<p>no markers here</p>");
    expect(r.enabled).toEqual([]);
    expect(r.settings).toBe(settings);
  });

  it("is a no-op when the module is already enabled", () => {
    const settings = { collections: { enabled: true } };
    const r = applyModuleIntent(settings, "<section data-ol-collection-section></section>");
    expect(r.enabled).toEqual([]);
    expect(r.settings).toBe(settings);
  });

  it("does NOT bridge comments/members/broadcast markers", () => {
    expect(applyModuleIntent(undefined, "<section data-ol-comments-section></section>").enabled).toEqual([]);
  });
});
