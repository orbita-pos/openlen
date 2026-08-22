// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyModuleIntent, detectModuleIntent } from "./module-intent";

describe("detectModuleIntent", () => {
  // El marcador se detecta esté en la etiqueta que esté: el modelo lo pone en un
  // <section> o en un <div> según le convenga, y el puente tiene que verlo igual.
  it("detecta el hueco de Catálogo en cualquier etiqueta", () => {
    for (const html of [
      "<section data-ol-collection-section></section>",
      "<div data-ol-collection-section></div>",
    ]) {
      expect(detectModuleIntent(html)).toEqual({ collections: true, scene3d: false });
    }
  });

  it("una página sin huecos no enciende nada", () => {
    expect(detectModuleIntent("<p>hi</p>")).toEqual({ collections: false, scene3d: false });
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
      "<section data-ol-collection-section></section>",
    );
    expect([...r.enabled].sort()).toEqual(["collections"]);
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

  it("detects the 3D scene marker and enables scene3d", () => {
    const html = '<section data-ol-3d-scene></section>';
    const { settings, enabled } = applyModuleIntent(undefined, html);
    expect(enabled).toContain("scene3d");
    expect(settings.scene3d?.enabled).toBe(true);
  });
});
