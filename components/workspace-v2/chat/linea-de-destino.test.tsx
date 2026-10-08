// @vitest-environment jsdom
//
// LA LÍNEA DE A QUIÉN VA lo que se escribe (el chat del equipo), con los textos
// REALES en español. Arnés manual de react-dom + act(), como `database-view.test.tsx`.
import { afterEach, describe, expect, it } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import panelsChat from "@/messages/es/panelsChat.json";
import { LineaDeDestino } from "./linea-de-destino";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ELI = { userId: "u-eli", nombre: "Eli Editor" };
const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

function pinta(ui: ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<NextIntlClientProvider locale="es" messages={{ panelsChat }}>{ui}</NextIntlClientProvider>));
  return host;
}

describe("la línea de a quién va", () => {
  it("🔴 dice a quién va el mensaje, con el nombre en su color", () => {
    const host = pinta(<LineaDeDestino destino={{ tipo: "personas", personas: [ELI] }} puedeLen colorDe={() => "red"} />);
    expect(host.textContent).toBe("Para Eli Editor · Len no responde");
    const nombre = [...host.querySelectorAll("span")].find((s) => s.textContent === "Eli Editor");
    expect(nombre?.style.color).toBe("red");
  });

  it("🔴 a un lector que menciona a Len le dice que no puede", () => {
    const host = pinta(<LineaDeDestino destino={{ tipo: "len" }} puedeLen={false} colorDe={() => "red"} />);
    expect(host.textContent).toBe("Solo los editores pueden pedirle cosas a Len");
  });
});
