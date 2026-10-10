// @vitest-environment jsdom
//
// EL CHAT VACÍO DE UNA APP HABLA DE LA APP. Visto el 09/10 al comprobar el
// texto de la caja: en una app, el título seguía siendo «¿Qué le hacemos hoy a
// tu página?» y las sugerencias, de página («Pon fotos de verdad en la portada»,
// «Publica mi página»).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({ useTranslations: () => (clave: string) => clave }));

import { EmptyState } from "./new-chat-panel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

function montar(esApp: boolean, onPick: (texto: string) => void = () => {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<EmptyState onPick={onPick} disabled={false} esApp={esApp} />));
  return host;
}

const sugerencias = (host: HTMLElement) => [...host.querySelectorAll("button")].map((b) => b.textContent);

describe("el chat vacío", () => {
  it("🔴 en una app: su título y sus sugerencias (datos, inicio de sesión, móvil, publicar)", () => {
    const host = montar(true);
    expect(host.querySelector("h2")?.textContent).toBe("newChat.emptyApp.title");
    expect(sugerencias(host)).toEqual([
      "newChat.emptyApp.suggestions.data",
      "newChat.emptyApp.suggestions.login",
      "newChat.emptyApp.suggestions.mobile",
      "newChat.emptyApp.suggestions.publish",
    ]);
    // El subtítulo no nombra la página: es el mismo.
    expect(host.querySelector("p")?.textContent).toBe("newChat.empty.subtitle");
  });

  it("una sugerencia de la app se manda tal cual", () => {
    const onPick = vi.fn();
    const host = montar(true, onPick);
    act(() => host.querySelector("button")!.click());
    expect(onPick).toHaveBeenCalledWith("newChat.emptyApp.suggestions.data");
  });

  it("en una página, como siempre", () => {
    const host = montar(false);
    expect(host.querySelector("h2")?.textContent).toBe("newChat.empty.title");
    expect(sugerencias(host)).toEqual([
      "newChat.empty.suggestions.photos",
      "newChat.empty.suggestions.form",
      "newChat.empty.suggestions.mobile",
      "newChat.empty.suggestions.publish",
    ]);
  });
});
