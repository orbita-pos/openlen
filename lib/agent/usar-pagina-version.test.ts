// @vitest-environment node
//
// THE EYES' TAB RELOADS WHEN A TOOL'S THEME CHANGES (spec local 2026-11-04-herramientas-hechas-por-len, §4.8 step 6):
// a tool reads its context when it boots, so `dark: true` on a tab already open in light has to load it again — found
// in the real run, where Len saw the light colours and painted the dark ones himself.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { tabVersionOf } = await import("./usar-pagina");

const opciones = { files: { "/src/main.tsx": "x" }, pagina: null };

describe("tabVersionOf", () => {
  it("the same document in light and in dark are two versions", () => {
    expect(tabVersionOf("<html></html>", opciones, "light")).not.toBe(tabVersionOf("<html></html>", opciones, "dark"));
  });

  it("the same document and theme are one version; a page without a tool keeps its version", () => {
    expect(tabVersionOf("<html></html>", opciones, "dark")).toBe(tabVersionOf("<html></html>", opciones, "dark"));
    expect(tabVersionOf("<html></html>", opciones, undefined)).toBe(tabVersionOf("<html></html>", opciones, undefined));
    expect(tabVersionOf("<html></html>", opciones, undefined)).not.toBe(tabVersionOf("<html></html>", opciones, "light"));
  });
});
