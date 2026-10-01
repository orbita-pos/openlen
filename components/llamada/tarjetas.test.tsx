import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import wsPage from "../../messages/es/wsPage.json";
import llamada from "../../messages/es/llamada.json";

vi.mock("next-intl", () => ({
  useTranslations: (espacio?: string) => (clave: string, valores?: Record<string, string>) => {
    let v: unknown = espacio?.startsWith("llamada") ? llamada : wsPage;
    for (const parte of [...(espacio ?? "").split(".").slice(1), ...clave.split(".")]) {
      v = (v as Record<string, unknown> | undefined)?.[parte];
    }
    if (typeof v !== "string") return clave;
    return v.replace(/\{(\w+)\}/g, (_m, k: string) => String(valores?.[k] ?? ""));
  },
}));

import { TarjetasDeLaLlamada } from "./tarjetas";

let contenedor: HTMLDivElement | null = null;
let raiz: Root | null = null;

function pintar(props: Parameters<typeof TarjetasDeLaLlamada>[0]): HTMLDivElement {
  contenedor = document.createElement("div");
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
  act(() => {
    raiz!.render(<TarjetasDeLaLlamada {...props} />);
  });
  return contenedor;
}

afterEach(() => {
  if (raiz) act(() => raiz!.unmount());
  contenedor?.remove();
  raiz = null;
  contenedor = null;
});

// LA TARJETA DEL BORRADOR SALÍA EN BLANCO (llamadas del 01/10). Las tarjetas
// del chat pintan con clases que sólo existen dentro de `.workspace-v2`
// (`fg`, `bg-elev`, `bd`, `bg-[var(--accent-strong)]`…, en
// app/[locale]/new/tokens.css). Fuera de ahí no pintan nada: la caja del texto
// heredaba el blanco de la pantalla de la llamada y quedaba blanco sobre blanco.
describe("las tarjetas del chat dentro de la llamada", () => {
  it("el borrador lleva el texto de Len y vive dentro de .workspace-v2", () => {
    const el = pintar({
      projectId: "p1",
      tarjetas: [
        {
          tipo: "respuesta",
          respuesta: {
            action: "responder",
            para: "chat",
            id: "c1",
            con: "Juan",
            texto: "Sí, abrimos el domingo de 9 a 2.",
            botones: ["enviar"],
            correo: null,
            whatsapp: null,
          },
        },
      ],
    });
    const caja = el.querySelector("textarea");
    expect(caja?.value).toBe("Sí, abrimos el domingo de 9 a 2.");
    expect(caja?.closest(".workspace-v2")).not.toBeNull();
  });

  it("la de publicar, también", () => {
    const el = pintar({
      projectId: "p1",
      tarjetas: [{ tipo: "publicar", confirm: { action: "publicar", subdominio: "pizarron", idiomas: [], republicar: false } }],
    });
    const boton = el.querySelector("button");
    expect(boton).not.toBeNull();
    expect(boton?.closest(".workspace-v2")).not.toBeNull();
  });

  // jsdom no aplica hojas de estilo: que la clase esté puesta no sirve de nada
  // si la página no carga las reglas. /new las carga desde su page.tsx; la
  // llamada, desde la suya.
  it("la página de la llamada carga los tokens del workspace", () => {
    const pagina = fs.readFileSync(path.join(process.cwd(), "app", "[locale]", "llamada", "page.tsx"), "utf8");
    expect(pagina).toMatch(/^import "\.\.\/new\/tokens\.css";$/m);
  });
});
