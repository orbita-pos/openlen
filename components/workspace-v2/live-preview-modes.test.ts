import { describe, expect, it } from "vitest";

import { editorCanSaveDom, modelJsShouldRun, type EditorModes } from "./live-preview-modes";

const QUIETO: EditorModes = {
  editingActive: false,
  inspectMode: false,
  sectionSelectMode: false,
  // El estado NORMAL de un proyecto abierto: la zona de soltar está armada.
  dropEnabled: true,
};

describe("cuándo corre el JavaScript del modelo", () => {
  it("🔴 con la página SÓLO abierta corre — `dropEnabled` no lo apaga", () => {
    // El fallo exacto del 2026-08-23: `dropEnabled` vale
    // `entryMode === "editing" && !!loadedProject`, o sea siempre. Contarlo
    // como modo de edición dejaba la función encendida y muerta a la vez.
    expect(modelJsShouldRun(QUIETO, true)).toBe(true);
    expect(editorCanSaveDom(QUIETO)).toBe(false);
  });

  it("se apaga en cada modo que puede GUARDAR el DOM vivo", () => {
    for (const modo of ["editingActive", "inspectMode", "sectionSelectMode"] as const) {
      expect(modelJsShouldRun({ ...QUIETO, [modo]: true }, true), modo).toBe(false);
      expect(editorCanSaveDom({ ...QUIETO, [modo]: true }), modo).toBe(true);
    }
  });

  it("sin cápsula no corre nada, se edite o no", () => {
    expect(modelJsShouldRun(QUIETO, false)).toBe(false);
    expect(modelJsShouldRun({ ...QUIETO, editingActive: true }, false)).toBe(false);
  });

  it("la zona de soltar no cambia la respuesta en ningún caso", () => {
    // Si algún día alguien la vuelve a meter, esta falla.
    for (const editingActive of [false, true]) {
      const con = { ...QUIETO, editingActive, dropEnabled: true };
      const sin = { ...QUIETO, editingActive, dropEnabled: false };
      expect(modelJsShouldRun(con, true)).toBe(modelJsShouldRun(sin, true));
    }
  });
});
