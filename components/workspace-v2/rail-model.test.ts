import { describe, expect, it } from "vitest";
import {
  EDITAR_ITEMS,
  NAVEGAR_ITEMS,
  railModeFor,
} from "./rail-model";

describe("railModeFor", () => {
  it("is navegar with no project", () => {
    expect(railModeFor({ entryMode: "choosing", hasProject: false, navigating: false })).toBe("navegar");
  });
  it("is editar when a project is loaded and not navigating", () => {
    expect(railModeFor({ entryMode: "editing", hasProject: true, navigating: false })).toBe("editar");
  });
  it("is navegar when a project is loaded but the user opened a Navegar section (App)", () => {
    expect(railModeFor({ entryMode: "editing", hasProject: true, navigating: true })).toBe("navegar");
  });
});

describe("coverage — every current chrome function keeps a home", () => {
  it("Navegar holds all app sections incl. Explore + Mi negocio", () => {
    const views = NAVEGAR_ITEMS.map((i) => i.view);
    for (const v of ["projects", "templates", "marketing", "modulos", "analytics", "messages", "explore", "business"] as const) {
      expect(views).toContain(v);
    }
  });
  it("Editar holds all editing tools", () => {
    const ids = EDITAR_ITEMS.map((i) => i.id);
    for (const id of ["site", "chat", "images", "library", "3d", "insights", "versions"] as const) {
      expect(ids).toContain(id);
    }
  });
});
