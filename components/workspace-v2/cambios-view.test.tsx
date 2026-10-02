// @vitest-environment jsdom
// La lente «Cambios» con colores de sintaxis (la #15 de
// plans/len-agente-2026/notas/fase-5-taller.md). Arnés manual de react-dom +
// act(), como `terminal-view.test.tsx`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { CambiosView } from "./cambios-view";
import type { CambiosDeUnTurno } from "@/lib/workspace-v2/cambios-en-vivo";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom no tiene matchMedia; `useIsMobile` lo pregunta. Ancho de escritorio salvo que la prueba diga otra cosa.
let movil = false;
window.matchMedia = ((query: string) => ({
  matches: movil && query === "(max-width: 767px)",
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia;

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
  movil = false;
});

const TURNO: CambiosDeUnTurno = {
  turnId: "t1",
  pedido: "Cambia la dirección",
  ficheros: [
    {
      ruta: "/contacto/index.html",
      tipo: "texto",
      antes: "<main>\n<script>\nconst x = 1;\n</script>\n<address>Calle Marea 12</address>\n</main>\n",
      despues: "<main>\n<script>\nconst x = 2;\n</script>\n<address>Calle Gaviotas 7</address>\n</main>\n",
    },
    { ruta: "/notas.txt", tipo: "texto", antes: "uno <b>\n", despues: "dos <b>\n" },
  ],
};

function pintar(ruta: string): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  act(() => root.render(<CambiosView turnos={[TURNO]} peticion={{ turnId: "t1", ruta, n: 1 }} onClose={() => {}} />));
  return el;
}

describe("CambiosView — colores de sintaxis", () => {
  it("colorea con el fichero ENTERO: una línea dentro de <script> sale como JavaScript", () => {
    const el = pintar("/contacto/index.html");
    expect([...el.querySelectorAll(".sx-pal")].map((s) => s.textContent)).toEqual(["const", "const"]);
    expect([...el.querySelectorAll(".sx-num")].map((s) => s.textContent)).toEqual(["1", "2"]);
    expect([...el.querySelectorAll(".sx-etq")].map((s) => s.textContent)).toContain("address");
    // El fondo dice quitada o añadida; el texto del código no se tiñe de rojo ni de verde.
    expect(el.innerHTML).not.toContain("text-red-800");
  });

  it("sin lenguaje conocido, sin colores", () => {
    const el = pintar("/notas.txt");
    expect(el.querySelector('[class^="sx-"], [class*=" sx-"]')).toBeNull();
    expect(el.textContent).toContain("dos <b>");
  });
});

describe("CambiosView — en el móvil (la #16)", () => {
  it("en el escritorio, la lista de ficheros y la vista lado a lado", () => {
    const el = pintar("/contacto/index.html");
    expect(el.querySelector("select[aria-label='preview.cambios.files']")).toBeNull();
    expect(el.textContent).toContain("preview.cambios.ladoALado");
  });

  it("el fichero se elige en un selector de la cabecera, como DeepSeek, y sólo la vista unificada", () => {
    movil = true;
    const el = pintar("/contacto/index.html");
    const selector = el.querySelector<HTMLSelectElement>("select[aria-label='preview.cambios.files']")!;
    expect([...selector.options].map((o) => o.textContent)).toEqual(["contacto/index.html  +2 −2", "notas.txt  +1 −1"]);
    expect(el.textContent).not.toContain("preview.cambios.ladoALado");
    // Elegir otro lo enseña.
    act(() => {
      selector.value = "/notas.txt";
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(el.textContent).toContain("dos <b>");
    expect(el.textContent).not.toContain("Calle Gaviotas 7");
  });
});
