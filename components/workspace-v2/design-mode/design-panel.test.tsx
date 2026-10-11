import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DESIGN_PROPERTIES, type DesignSelection } from "@/lib/apps/design/types";
import { designEditsReducer, EMPTY_DESIGN_EDITS } from "./design-edits";
import { DesignPanelView, type DesignPanelViewProps } from "./design-panel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});
const t = (k: string, v?: Record<string, string>) => (v ? `${k}(${Object.values(v).join(",")})` : k);
const styles = Object.fromEntries(DESIGN_PROPERTIES.map((p) => [p, ""])) as DesignSelection["styles"];
const sel: DesignSelection = {
  key: "a", chain: [{ path: "/src/App.tsx", line: 7, component: null }], primary: 0, tag: "li", text: "Cancún",
  textEditable: true, copies: 6, screen: "#/", styles: { ...styles, "font-size": "16px" }, image: null, designId: null,
  fonts: ["Fraunces"],
};
const vacio = () => {};

function montar(p: Partial<DesignPanelViewProps> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const state = designEditsReducer(EMPTY_DESIGN_EDITS, { type: "select", selection: sel });
  act(() => {
    root.render(
      <DesignPanelView state={state} selectedKey="a" generalNote="" busy={false} t={t}
        onChange={vacio} onPhoto={vacio} onNote={vacio} onGeneralNote={vacio} onUndo={vacio} onRedo={vacio}
        onResetElement={vacio} onResetAll={vacio} onSelectParent={vacio} onApply={vacio} onClose={vacio} {...p} />,
    );
  });
  return host;
}

describe("el panel de diseño", () => {
  it("avisa de las copias de una lista", () => {
    expect(montar().textContent).toContain("designMode.copies(6)");
  });
  it("cambiar el tamaño de letra llama a onChange con el valor CSS", () => {
    const onChange = vi.fn();
    const host = montar({ onChange });
    const input = host.querySelector('input[name="font-size"]') as HTMLInputElement;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "48px");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("a", "font-size", "48px");
  });
  it("🔴 «Aplicar» está apagado sin cambios y mientras Len trabaja", () => {
    const boton = (h: HTMLElement) => h.querySelector('[data-testid="design-apply"]') as HTMLButtonElement;
    expect(boton(montar()).disabled).toBe(true);
    const conCambio = designEditsReducer(designEditsReducer(EMPTY_DESIGN_EDITS, { type: "select", selection: sel }), { type: "set", key: "a", field: "font-size", value: "48px" });
    expect(boton(montar({ state: conCambio })).disabled).toBe(false);
    const ocupado = montar({ state: conCambio, busy: true });
    expect(boton(ocupado).disabled).toBe(true);
    expect(ocupado.textContent).toContain("designMode.busy");
  });
  it("el tipo de letra ofrece las fuentes que ya carga la app y las de Google Fonts", () => {
    const opciones = [...montar().querySelectorAll("#openlen-design-fonts option")].map((o) => (o as HTMLOptionElement).value);
    expect(opciones[0]).toBe("Fraunces");
    expect(opciones).toContain("Inter");
    expect(opciones).toContain("Raleway");
  });
  it("un texto con hijos no se puede cambiar en el panel", () => {
    const state = designEditsReducer(EMPTY_DESIGN_EDITS, { type: "select", selection: { ...sel, textEditable: false } });
    expect(montar({ state }).querySelector('textarea[name="text"]')).toBeNull();
  });
});
