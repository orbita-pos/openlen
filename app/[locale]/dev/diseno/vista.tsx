"use client";

// El panel de Diseño DE VERDAD (ver page.tsx) con tres elementos de ejemplo: un
// texto que se repite y ya tiene un cambio, una foto, y nada elegido. Sólo
// existe en desarrollo.

import { useReducer, useState } from "react";

import "../../new/tokens.css";

import { DESIGN_PROPERTIES, type DesignSelection } from "@/lib/apps/design/types";
import { designEditsReducer, EMPTY_DESIGN_EDITS } from "@/components/workspace-v2/design-mode/design-edits";
import { DesignPanel } from "@/components/workspace-v2/design-mode/design-panel";

const ESTILOS = Object.fromEntries(DESIGN_PROPERTIES.map((p) => [p, ""])) as Record<(typeof DESIGN_PROPERTIES)[number], string>;

const TEXTO: DesignSelection = {
  key: "texto", chain: [{ path: "/src/App.tsx", line: 7, component: null }], primary: 0, tag: "li", text: "Cancún, 4 noches",
  textEditable: true, copies: 6, screen: "#/", designId: null, fonts: ["Fraunces"], image: null,
  styles: {
    ...ESTILOS, "font-family": "Fraunces", "font-size": "16px", "font-weight": "500", "line-height": "24px", "letter-spacing": "normal",
    "text-align": "left", "text-decoration-line": "none", color: "rgb(29, 78, 216)", "background-color": "rgba(0, 0, 0, 0)",
    "margin-top": "0px", "margin-right": "0px", "margin-bottom": "8px", "margin-left": "0px",
    "padding-top": "12px", "padding-right": "16px", "padding-bottom": "12px", "padding-left": "16px",
    "border-color": "rgb(229, 231, 235)", "border-style": "solid", "border-width": "1px", "border-radius": "12px",
    opacity: "1", "box-shadow": "none",
  },
};
const FOTO: DesignSelection = {
  ...TEXTO, key: "foto", tag: "img", text: "", textEditable: false, copies: 1,
  image: { src: "/hero.jpg", alt: "La playa al atardecer" },
};

function inicial() {
  let s = designEditsReducer(EMPTY_DESIGN_EDITS, { type: "select", selection: FOTO });
  s = designEditsReducer(s, { type: "select", selection: TEXTO });
  return designEditsReducer(s, { type: "set", key: "texto", field: "font-size", value: "20px" });
}

export function VistaDelPanelDeDiseno({ oscuro }: { oscuro: boolean }) {
  const [state, dispatch] = useReducer(designEditsReducer, undefined, inicial);
  const [nota, setNota] = useState("");
  const vacio = () => {};
  const panel = (selectedKey: string | null, busy = false) => (
    <div className="h-full shadow-2xl">
      <DesignPanel
        state={state}
        selectedKey={selectedKey}
        generalNote={nota}
        busy={busy}
        onChange={(key, field, value) => dispatch({ type: "set", key, field, value })}
        onPhoto={vacio}
        onNote={(key, note) => dispatch({ type: "note", key, note })}
        onGeneralNote={setNota}
        onUndo={() => dispatch({ type: "undo" })}
        onRedo={() => dispatch({ type: "redo" })}
        onResetElement={(key) => dispatch({ type: "resetElement", key })}
        onSelectParent={vacio}
        onClose={vacio}
      />
    </div>
  );
  return (
    <div className={oscuro ? "dark" : ""} style={{ width: "100vw", height: "100vh" }}>
      <div className="workspace-v2 flex h-full justify-end gap-6 bg-preview-a">
        {panel(null)}
        {panel("foto", true)}
        {panel("texto")}
      </div>
    </div>
  );
}
