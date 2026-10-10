// @vitest-environment jsdom
//
// EL CHAT PLEGADO EN EL PROYECTO EN BLANCO. Visto en producción (10/10): `/new`
// reutiliza el mismo proyecto en blanco, y quien iba a otro proyecto, abría el
// chat y volvía a «nuevo» encontraba el chat abierto junto al compositor del
// centro: el «ya lo plegué» de ese proyecto seguía recordado.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { useCollapseWhileBlank } from "./use-collapse-while-blank";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

function setup() {
  const collapse = vi.fn();
  function Probe(props: { isBlank: boolean; projectId: string | null }) {
    useCollapseWhileBlank({ ...props, collapse });
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const show = (isBlank: boolean, projectId: string | null) => act(() => root!.render(<Probe isBlank={isBlank} projectId={projectId} />));
  return { collapse, show };
}

describe("el chat en el proyecto en blanco", () => {
  it("se pliega al llegar al proyecto en blanco", () => {
    const { collapse, show } = setup();
    show(true, "blanco");
    expect(collapse).toHaveBeenCalledTimes(1);
  });

  it("abierto a mano sin salir del proyecto en blanco, no se vuelve a plegar", () => {
    const { collapse, show } = setup();
    show(true, "blanco");
    show(true, "blanco");
    expect(collapse).toHaveBeenCalledTimes(1);
  });

  it("un proyecto con contenido no lo pliega", () => {
    const { collapse, show } = setup();
    show(false, "caja");
    expect(collapse).not.toHaveBeenCalled();
  });

  it("🔴 al volver al mismo proyecto en blanco desde otro, se pliega otra vez", () => {
    const { collapse, show } = setup();
    show(true, "blanco");
    show(false, "caja"); // otro proyecto: ahí se abre el chat
    show(true, "blanco"); // «nuevo» reutiliza el mismo proyecto en blanco
    expect(collapse).toHaveBeenCalledTimes(2);
  });

  it("🔴 y también si el proyecto deja de estar en blanco y vuelve a estarlo sin cambiar de id", () => {
    const { collapse, show } = setup();
    show(true, "blanco");
    show(false, "blanco"); // un turno lo llenó…
    show(true, "blanco"); // …y deshacerlo lo dejó en blanco otra vez
    expect(collapse).toHaveBeenCalledTimes(2);
  });
});
