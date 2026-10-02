// @vitest-environment jsdom
// La lente «Código» abierta en un fichero pedido desde el Chat (la #9 de
// plans/len-agente-2026/notas/fase-5-taller.md). Arnés manual de react-dom +
// act(), como `terminal-view.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { CodeView } from "./code-view";
import { cambiosEnVivo } from "@/lib/workspace-v2/cambios-en-vivo";

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
  buscar: "Buscar en los archivos",
  limpiar: "Borrar la búsqueda",
  porNombre: "Por nombre",
  enFicheros: "Dentro de los archivos",
  sinResultados: (q: string) => `Nada coincide con «${q}».`,
  masCoincidencias: (n: number) => `Y ${n} más.`,
  sinContenido: (n: number) => `${n} sólo por nombre.`,
  marcaNuevo: "Nuevo en esta sesión",
  marcaCambiado: "Cambió en esta sesión",
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

/** Escribir en un input controlado por React: el setter nativo y el evento `input`. */
function escribir(input: HTMLInputElement, texto: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, texto);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function tecla(el: Element, key: string, extra: KeyboardEventInit = {}) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...extra }));
  });
}

describe("CodeView — buscar en los archivos (la #11)", () => {
  const buscador = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[aria-label="Buscar en los archivos"]')!;

  it("por nombre y por dentro, con lo que casó resaltado; el lienzo cuenta como la página abierta", async () => {
    const { el } = await pintar(null);
    escribir(buscador(el), "menu");
    expect(el.textContent).toContain("Por nombre");
    expect(el.textContent).toContain("Dentro de los archivos");
    expect([...el.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["Menú"]);
    // El árbol se va mientras hay algo escrito.
    expect(el.querySelector("nav button[aria-expanded]")).toBeNull();
    // La portada se busca como está en el LIENZO, no como está guardada.
    escribir(buscador(el), "lienzo");
    expect(el.textContent).toContain("index.html");
    escribir(buscador(el), "portada");
    expect(el.textContent).toContain("Nada coincide con «portada».");
  });

  it("los que se calculan al abrirlos se encuentran por nombre, y se dice que sólo por nombre", async () => {
    const { el } = await pintar(null);
    escribir(buscador(el), "visitas");
    expect(el.textContent).toContain("1 sólo por nombre.");
  });

  it("pulsar una línea abre el fichero y la resalta", async () => {
    const { el } = await pintar(null);
    escribir(buscador(el), "ana");
    const linea = [...el.querySelectorAll("nav button")].find((b) => b.textContent?.includes('[{"nombre":"Ana"}]'))!;
    act(() => (linea as HTMLButtonElement).click());
    expect(elegido(el)).toBe("datos/reservas.json");
    expect(el.querySelector('[data-linea="1"]')!.className).toContain("bg-accent-soft");
  });

  it("flechas y Enter abren el resultado activo; Escape borra la búsqueda y no cierra la lente", async () => {
    const onClose = vi.fn();
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = createRoot(div);
    roots.push(root);
    await act(async () => {
      root.render(<CodeView html="<h1>Lienzo</h1>" projectId="p1" rutaActual="/index.html" onClose={onClose} labels={labels} />);
    });
    const input = buscador(div);
    escribir(input, "h1");
    // Activo, el primero (portada, línea 1); una flecha abajo, el de menú.
    tecla(input, "ArrowDown");
    tecla(input, "Enter");
    expect(elegido(div)).toBe("menu/index.html");

    tecla(input, "Escape");
    expect(input.value).toBe("");
    expect(onClose).not.toHaveBeenCalled();
    tecla(input, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Mayús+F lleva al buscador", async () => {
    const { el } = await pintar(null);
    tecla(document.body, "F", { ctrlKey: true, shiftKey: true });
    expect(document.activeElement).toBe(buscador(el));
  });
});

describe("CodeView — la marca de «cambiado» en el árbol (la #19)", () => {
  it("un punto con su texto junto a cada fichero que cambió en la pestaña, y atenuado junto a sus carpetas", async () => {
    cambiosEnVivo.guardar("p-marcas", {
      turnId: "t1",
      pedido: "x",
      ficheros: [
        { ruta: "/menu/index.html", tipo: "texto", antes: "<h1>Menu</h1>", despues: "<h1>Menú</h1>" },
        { ruta: "/datos/reservas.json", tipo: "texto", antes: null, despues: "[]" },
      ],
    });
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = createRoot(div);
    roots.push(root);
    await act(async () => {
      root.render(<CodeView html="<h1>Lienzo</h1>" projectId="p-marcas" rutaActual="/index.html" onClose={() => {}} labels={labels} />);
    });
    const marcadas = [...div.querySelectorAll("nav [title]")].map((m) => [m.closest("button")!.querySelector(".truncate")!.textContent, m.getAttribute("title")]);
    expect(marcadas).toEqual([
      ["reservas.json", "Nuevo en esta sesión"],
      ["index.html", "Cambió en esta sesión"],
    ]);
    // La portada no cambió: sin marca. Las carpetas de los marcados, con su punto.
    const portada = [...div.querySelectorAll("nav button")].find((b) => b.textContent === "index.html" && !b.closest("ul ul"));
    expect(portada?.querySelector("[title]")).toBeFalsy();
    expect(div.querySelectorAll("nav button[aria-expanded] .opacity-40")).toHaveLength(2);
  });
});
