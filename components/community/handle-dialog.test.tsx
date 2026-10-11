// @vitest-environment jsdom
//
// La ventana del @ (projects-view, /me y «Cambiar @» del perfil). 🔴 Habla el
// idioma de la interfaz, y la tarjeta blanca lleva su propio color de texto: en
// las páginas oscuras (el perfil, /me) heredaba el claro y el título, «Cancelar»
// y lo escrito quedaban blanco sobre blanco.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import messages from "@/messages/es/explore.json";
import HandleDialog from "./handle-dialog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

function render(): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="es" messages={{ explore: messages }}>
        <HandleDialog open onClose={() => {}} onSaved={() => {}} />
      </NextIntlClientProvider>,
    ),
  );
  return host;
}

describe("la ventana del @", () => {
  it("🔴 habla el idioma de la interfaz", () => {
    const host = render();
    expect(host.querySelector("h2")?.textContent).toBe("Elige tu @");
    const labels = [...host.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toEqual(["Cancelar", "Guardar"]);
    expect(host.querySelector("input")?.placeholder).toBe("tunombre");
  });

  it("🔴 el motivo de un @ que no vale, también", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({ ok: false, error: "taken" }) })) as unknown as typeof fetch;
    const host = render();
    const save = [...host.querySelectorAll("button")].find((b) => b.textContent === "Guardar")!;
    await act(async () => save.click());
    expect(host.textContent).toContain("Ese @ ya lo tiene otra persona.");
  });

  it("🔴 la tarjeta blanca no hereda el texto claro de una página oscura", () => {
    const host = render();
    const card = host.querySelector("h2")!.parentElement!;
    expect(card.className).toContain("bg-white");
    expect(card.className).toContain("text-neutral-900");
  });
});
