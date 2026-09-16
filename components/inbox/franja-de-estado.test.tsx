import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Las cadenas REALES del español, no un doble: así, si la Tarea 4 se dejó una
// clave, esta prueba lo dice en vez de pasar con un stub complaciente.
import mensajes from "../../messages/es/wsPage.json";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string, valores?: Record<string, string>) => {
    let v: unknown = mensajes;
    for (const parte of clave.split(".")) v = (v as Record<string, unknown> | undefined)?.[parte];
    if (typeof v !== "string") return clave;
    return v.replace(/\{(\w+)\}/g, (_m, k: string) => String(valores?.[k] ?? ""));
  },
}));

import { FranjaDeEstado } from "./franja-de-estado";

const BASE = {
  projectId: "p1",
  nombrePagina: "Taller Sauco",
  publicada: true,
  cambiosSinPublicar: false,
  asistente: false,
  chat: false,
};

let contenedor: HTMLDivElement | null = null;
let raiz: Root | null = null;

function pintar(props: Parameters<typeof FranjaDeEstado>[0]): HTMLDivElement {
  contenedor = document.createElement("div");
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
  act(() => {
    raiz!.render(<FranjaDeEstado {...props} />);
  });
  return contenedor;
}

afterEach(() => {
  if (raiz) act(() => raiz!.unmount());
  contenedor?.remove();
  raiz = null;
  contenedor = null;
});

describe("FranjaDeEstado", () => {
  it("🔴 dice quién contesta, con el nombre de la página", () => {
    const c = pintar({ ...BASE, asistente: true, chat: true });
    const franja = c.querySelector('[role="status"]');
    expect(franja).not.toBeNull();
    expect(franja!.textContent).toContain("Taller Sauco");
    expect(franja!.textContent).toMatch(/contesta la IA/i);
  });

  it("🔴 SIN PROYECTO no pinta nada — la bandeja suelta sigue igual", () => {
    // El alcance viene del taller (?project=<id>&view=messages). Sin ese
    // parámetro la bandeja es de la CUENTA y la configuración es del PROYECTO:
    // mezclarlas es la costura que esta franja evita.
    const c = pintar({ ...BASE, projectId: null });
    expect(c.innerHTML).toBe("");
  });

  it("dice que falta publicar cuando la página no está publicada", () => {
    const c = pintar({ ...BASE, asistente: true, publicada: false });
    expect(c.querySelector('[role="status"]')!.textContent).toMatch(/publiques/i);
  });

  it("🔴 PUBLICADA pero con cambios sin publicar: también «cuando publiques»", () => {
    // Las burbujas se hornean al publicar: encender el asistente no la pone en
    // la página viva hasta volver a publicar. Ver lib/inbox/estado-de-la-burbuja.ts.
    const c = pintar({ ...BASE, asistente: true, cambiosSinPublicar: true });
    expect(c.querySelector('[role="status"]')!.textContent).toMatch(/publiques/i);
  });

  it("BRAZO DE CONTROL: el texto CAMBIA con el estado", () => {
    // Si la franja pintara siempre la misma cadena, las pruebas de arriba
    // podrían pasar por coincidencia de subcadena.
    const a = pintar({ ...BASE }).textContent;
    const b = pintar({ ...BASE, asistente: true, chat: true }).textContent;
    expect(a).not.toBe(b);
  });
});
