// @vitest-environment jsdom
// La lente «Código» abierta en un fichero pedido desde el Chat (la #9 de
// plans/len-agente-2026/notas/fase-5-taller.md). Arnés manual de react-dom +
// act(), como `terminal-view.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { CodeView } from "./code-view";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const labels = {
  title: "El código",
  close: "Cerrar",
  copy: "Copiar",
  copied: "Copiado",
  document: "Documento",
  lines: "líneas",
  files: "Archivos",
  loading: "Cargando…",
  loadError: "No se pudieron leer.",
  readOnly: "Sólo lectura",
  noEsta: "ya no está.",
};

const LISTA = {
  ficheros: [
    { ruta: "/index.html", contenido: "<h1>Portada</h1>" },
    { ruta: "/menu/index.html", contenido: "<h1>Menú</h1>" },
    { ruta: "/datos/reservas.json", contenido: '[{"nombre":"Ana"}]' },
  ],
  perezosos: ["/resultados/visitas.json"],
};

const roots: Root[] = [];
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("?ruta=")
        ? new Response(JSON.stringify({ contenido: '{"hoy":12}' }))
        : new Response(JSON.stringify(LISTA)),
    ),
  );
});
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function pintar(peticion: { ruta: string; n: number } | null) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  const render = async (p: typeof peticion) => {
    await act(async () => {
      root.render(<CodeView html="<h1>Lienzo</h1>" projectId="p1" rutaActual="/index.html" peticion={p} onClose={() => {}} labels={labels} />);
    });
  };
  await render(peticion);
  return { el, render };
}

const elegido = (el: HTMLElement) => el.querySelector("header span")?.textContent;

describe("CodeView con una petición del Chat", () => {
  it("se abre en ESE fichero, con su carpeta desplegada", async () => {
    const { el } = await pintar({ ruta: "/datos/reservas.json", n: 1 });
    expect(elegido(el)).toBe("datos/reservas.json");
    expect(el.textContent).toContain('[{"nombre":"Ana"}]');
    expect(el.querySelector('[aria-current="true"]')!.textContent).toBe("reservas.json");
  });

  it("con la lente ya abierta, una petición nueva cambia de fichero; la misma otra vez no hace nada", async () => {
    const { el, render } = await pintar(null);
    expect(elegido(el)).toBe("index.html");
    await render({ ruta: "/menu/index.html", n: 2 });
    expect(elegido(el)).toBe("menu/index.html");
    expect(el.textContent).toContain("<h1>Menú</h1>");
    expect(el.querySelector('[aria-current="true"]')!.textContent).toBe("index.html");
  });

  it("un fichero de los que se calculan al abrirlos se pide solo", async () => {
    const { el } = await pintar({ ruta: "/resultados/visitas.json", n: 3 });
    await act(async () => {});
    expect(el.textContent).toContain('{"hoy":12}');
  });

  it("si el fichero ya no está, lo dice en vez de quedarse cargando", async () => {
    const { el } = await pintar({ ruta: "/clases/index.html", n: 4 });
    expect(el.textContent).toContain("clases/index.html · ya no está.");
    expect(el.textContent).not.toContain("Cargando…");
  });
});
