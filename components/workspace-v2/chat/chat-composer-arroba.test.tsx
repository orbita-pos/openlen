// EL @ EN LA CAJA DEL CHAT (el chat del equipo): escribir «@» sugiere a Len y a
// la gente del proyecto, Enter elige en vez de enviar, y la mención queda en su
// color dentro de la caja, como en los hilos del código.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({ useTranslations: () => (clave: string) => clave }));

import { ChatComposer } from "./chat-composer";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

const ELI = { userId: "u-eli", nombre: "Eli Editor" };

function Compositor({ onSubmit, conGente }: { onSubmit: () => void; conGente: boolean }) {
  const [v, setV] = useState("");
  const ta = useRef<HTMLTextAreaElement | null>(null);
  return (
    <ChatComposer
      value={v}
      onChange={setV}
      onSubmit={onSubmit}
      onStop={() => {}}
      busy={false}
      textareaRef={ta}
      comments={[]}
      onRemoveComment={() => {}}
      scopedSelection={null}
      sectionSelectMode={false}
      attachedImage={null}
      onAttachImage={() => {}}
      onClearAttachedImage={() => {}}
      effort="auto"
      effortLevels={["low", "medium", "high"]}
      effortResolvesTo="medium"
      onEffortChange={() => {}}
      mode="len"
      {...(conGente ? { mencionables: { gente: [ELI], colorDe: () => "rgb(9, 8, 7)", conLen: true } } : {})}
    />
  );
}

function montar(conGente = true) {
  const onSubmit = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<Compositor onSubmit={onSubmit} conGente={conGente} />));
  const caja = host.querySelector("textarea")!;
  const escribir = (texto: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(caja, texto);
      caja.setSelectionRange(texto.length, texto.length);
      caja.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const enter = () => act(() => void caja.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  return { host, caja, escribir, enter, onSubmit };
}

describe("el @ en la caja del chat", () => {
  it("🔴 «@E» sugiere a Eli; Enter lo elige (no envía) y la mención queda en su color en la caja", () => {
    const { host, caja, escribir, enter, onSubmit } = montar();
    escribir("hola @E");
    const menu = host.querySelector("[data-arroba]");
    expect(menu?.textContent).toContain("@Eli Editor");
    enter();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(caja.value).toBe("hola @Eli Editor ");
    const pintada = host.querySelector<HTMLElement>('[data-mencion="persona"]');
    expect(pintada?.textContent).toBe("@Eli Editor");
    expect(pintada?.style.color).toBe("rgb(9, 8, 7)");
    enter();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("«@L» sugiere a Len, en naranja", () => {
    const { host, escribir } = montar();
    escribir("@L");
    expect(host.querySelector("[data-arroba]")?.textContent).toContain("@Len");
  });

  it("sin gente (proyecto sin miembros), la caja de siempre: ni desplegable, y Enter envía", () => {
    const { host, escribir, enter, onSubmit } = montar(false);
    escribir("@L");
    expect(host.querySelector("[data-arroba]")).toBeNull();
    enter();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("cuando llega la gente", () => {
  it("🔴 encender los colores no cambia la caja: sigue siendo el mismo textarea, con el foco", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => root.render(<Compositor onSubmit={() => {}} conGente={false} />));
    const antes = host.querySelector("textarea")!;
    antes.focus();
    act(() => root.render(<Compositor onSubmit={() => {}} conGente />));
    const despues = host.querySelector("textarea")!;
    expect(despues).toBe(antes);
    expect(document.activeElement).toBe(antes);
  });
});
