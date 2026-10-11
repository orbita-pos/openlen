import { describe, expect, it } from "vitest";
import { DESIGN_PROPERTIES, type DesignSelection } from "@/lib/apps/design/types";
import { changesOf, designEditsReducer, EMPTY_DESIGN_EDITS, pendingCount, previewMessagesOf, toDesignRequest } from "./design-edits";

const styles = Object.fromEntries(DESIGN_PROPERTIES.map((p) => [p, ""])) as DesignSelection["styles"];
const sel = (key: string, extra: Partial<DesignSelection> = {}): DesignSelection => ({
  key, chain: [{ path: "/src/App.tsx", line: 7, component: null }], primary: 0, tag: "h1", text: "Hola",
  textEditable: true, copies: 1, screen: "#/", styles: { ...styles, "font-size": "32px", color: "rgb(17, 24, 39)" },
  image: null, designId: null, fonts: [], ...extra,
});

describe("los cambios pendientes del modo Diseño", () => {
  it("elegir no cuenta como cambio; cambiar sí, con su antes y su después", () => {
    let s = designEditsReducer(EMPTY_DESIGN_EDITS, { type: "select", selection: sel("a") });
    expect(pendingCount(s)).toBe(0);
    s = designEditsReducer(s, { type: "set", key: "a", field: "font-size", value: "48px" });
    s = designEditsReducer(s, { type: "set", key: "a", field: "text", value: "Paquetes" });
    expect(pendingCount(s)).toBe(1);
    expect(changesOf(s.elements.a!)).toEqual([
      { property: "font-size", before: "32px", after: "48px" },
      { property: "text", before: "Hola", after: "Paquetes" },
    ]);
  });

  it("volver al valor de antes no es un cambio", () => {
    let s = designEditsReducer(EMPTY_DESIGN_EDITS, { type: "select", selection: sel("a") });
    s = designEditsReducer(s, { type: "set", key: "a", field: "font-size", value: "32px" });
    expect(pendingCount(s)).toBe(0);
  });

  it("deshacer, rehacer y restaurar", () => {
    let s = designEditsReducer(EMPTY_DESIGN_EDITS, { type: "select", selection: sel("a") });
    s = designEditsReducer(s, { type: "set", key: "a", field: "color", value: "#1d4ed8" });
    s = designEditsReducer(s, { type: "undo" });
    expect(pendingCount(s)).toBe(0);
    s = designEditsReducer(s, { type: "redo" });
    expect(pendingCount(s)).toBe(1);
    s = designEditsReducer(s, { type: "resetAll" });
    expect(pendingCount(s)).toBe(0);
    expect(s.order).toEqual([]);
  });

  it("toDesignRequest: sólo lo que cambió, con la nota general; tope de 20 elementos", () => {
    let s = EMPTY_DESIGN_EDITS;
    for (let i = 0; i < 22; i++) {
      s = designEditsReducer(s, { type: "select", selection: sel(`k${i}`) });
      s = designEditsReducer(s, { type: "set", key: `k${i}`, field: "color", value: "#000000" });
    }
    s = designEditsReducer(s, { type: "select", selection: sel("sin-cambios") });
    const { request, tooBig } = toDesignRequest(s, "hazlo en tres columnas");
    expect(tooBig).toBe(false);
    expect(request!.elements).toHaveLength(20);
    expect(request!.note).toBe("hazlo en tres columnas");
    expect(request!.elements[0]).toMatchObject({ tag: "h1", screen: "#/", changes: [{ property: "color", before: "rgb(17, 24, 39)", after: "#000000" }] });
  });

  it("🔴 clear (cambiar de proyecto) lo vacía todo, también el historial: deshacer no resucita cambios de otro proyecto", () => {
    let s = designEditsReducer(EMPTY_DESIGN_EDITS, { type: "select", selection: sel("a") });
    s = designEditsReducer(s, { type: "set", key: "a", field: "color", value: "#000000" });
    s = designEditsReducer(s, { type: "clear" });
    expect(s).toEqual(EMPTY_DESIGN_EDITS);
    expect(pendingCount(designEditsReducer(s, { type: "undo" }))).toBe(0);
  });

  it("sin cambios ni nota, no hay nada que aplicar", () => {
    const s = designEditsReducer(EMPTY_DESIGN_EDITS, { type: "select", selection: sel("a") });
    expect(toDesignRequest(s, "  ").request).toBeNull();
  });

  it("previewMessagesOf: manda la vista previa de lo que cambió y limpia lo que se restauró", () => {
    const a = designEditsReducer(EMPTY_DESIGN_EDITS, { type: "select", selection: sel("a") });
    const b = designEditsReducer(a, { type: "set", key: "a", field: "font-size", value: "48px" });
    expect(previewMessagesOf(a, b)).toEqual([
      { type: "openlen:design-preview", key: "a", screen: "#/", target: { path: "/src/App.tsx", line: 7, tag: "h1" }, styles: { "font-size": "48px" } },
    ]);
    const c = designEditsReducer(b, { type: "resetElement", key: "a" });
    expect(previewMessagesOf(b, c)).toEqual([{ type: "openlen:design-clear", key: "a" }]);
  });
});
