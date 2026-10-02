// @vitest-environment jsdom
// La lente «Código» abierta en un fichero pedido desde el Chat (la #9 de
// plans/len-agente-2026/notas/fase-5-taller.md). Arnés manual de react-dom +
// act(), como `terminal-view.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { CodeView } from "./code-view";
import { comentariosDelChat } from "@/lib/workspace-v2/comentarios-de-lineas";
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
  comentar: {
    comentarLinea: (n: number) => `Comentar la línea ${n}`,
    placeholder: "Dile a Len qué cambiar aquí…",
    anadir: "Añadir al mensaje",
    cancelar: "Cancelar",
    quitar: "Quitar el comentario",
    enElMensaje: "va en tu próximo mensaje",
    tope: "Ya hay 10 comentarios esperando",
  },
  editar: {
    editar: "Editar",
    guardar: "Guardar",
    guardando: "Guardando…",
    descartar: "Descartar",
    cargando: "Cargando…",
    cambio: "Este archivo cambió mientras lo editabas. No se guardó nada.",
    cargarAhora: "Cargar lo de ahora",
    rechazado: "No se guardó:",
    error: "No se pudo guardar.",
    nota: "Se guarda como tu versión.",
  },
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

function tecla(el: EventTarget, key: string, extra: KeyboardEventInit = {}, atendida = false) {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra });
  if (atendida) e.preventDefault();
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
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

    expect(tecla(input, "Escape").defaultPrevented).toBe(true);
    expect(input.value).toBe("");
    expect(onClose).not.toHaveBeenCalled();
    // Como en /new, donde React escucha en el propio `document`: la tecla llega
    // al oyente de la lente aunque el buscador la parara, y manda la marca.
    tecla(document, "Escape", {}, true);
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

describe("CodeView — colores de sintaxis (la #15)", () => {
  it("un HTML se pinta con sus colores y un fichero sin lenguaje conocido, sin ellos; el texto no cambia", async () => {
    const { el, render } = await pintar({ ruta: "/menu/index.html", n: 10 });
    expect([...el.querySelectorAll("section .sx-etq")].map((s) => s.textContent)).toEqual(["h1", "h1"]);
    expect(el.querySelector("section code")!.textContent).toContain("<h1>Menú</h1>");
    await render({ ruta: "/datos/reservas.json", n: 11 });
    expect([...el.querySelectorAll("section .sx-pro")].map((s) => s.textContent)).toEqual(['"nombre"']);
  });
});

describe("CodeView — comentar una línea para el siguiente mensaje (la #8)", () => {
  const escribirEn = (area: HTMLTextAreaElement, texto: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      setter.call(area, texto);
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("el número abre la caja; Enter lo deja esperando el mensaje, con el código de esa línea; Escape no cierra la lente", async () => {
    comentariosDelChat.vaciar("p1");
    const onClose = vi.fn();
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    roots.push(root);
    await act(async () => {
      root.render(<CodeView html="<h1>Lienzo</h1>" projectId="p1" rutaActual="/index.html" peticion={null} onClose={onClose} labels={labels} />);
    });
    act(() => el.querySelector<HTMLButtonElement>('[data-comentar-linea="1"]')!.click());
    const area = el.querySelector<HTMLTextAreaElement>("[data-caja-de-comentario] textarea")!;
    expect(document.activeElement).toBe(area);
    // Escape la cierra, y no cierra la lente.
    expect(tecla(area, "Escape").defaultPrevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(el.querySelector("[data-caja-de-comentario]")).toBeNull();

    act(() => el.querySelector<HTMLButtonElement>('[data-comentar-linea="1"]')!.click());
    const otra = el.querySelector<HTMLTextAreaElement>("[data-caja-de-comentario] textarea")!;
    escribirEn(otra, "pon un título más corto");
    tecla(otra, "Enter");
    expect(comentariosDelChat.lista("p1")).toMatchObject([
      { ruta: "/index.html", linea: 1, codigo: "<h1>Lienzo</h1>", texto: "pon un título más corto" },
    ]);
    expect(el.querySelector("[data-caja-de-comentario]")).toBeNull();
    expect(el.querySelector("[data-comentario-pendiente]")!.textContent).toContain("pon un título más corto");
    // Quitarlo lo saca de la cola.
    act(() => el.querySelector<HTMLButtonElement>("[data-comentario-pendiente] button")!.click());
    expect(comentariosDelChat.lista("p1")).toHaveLength(0);
  });
});

describe("CodeView — editar a mano (la #18)", () => {
  async function abrirMenu(respuestaDelPut: () => Response) {
    const llamadas: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        llamadas.push({ url, ...(init ? { init } : {}) });
        if (init?.method === "PUT") return respuestaDelPut();
        if (url.includes("?ruta=")) return new Response(JSON.stringify({ contenido: '{"hoy":12}' }));
        return new Response(JSON.stringify(LISTA));
      }),
    );
    const onClose = vi.fn();
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    roots.push(root);
    await act(async () => {
      root.render(
        <CodeView html="<h1>Lienzo</h1>" projectId="p1" rutaActual="/index.html" peticion={{ ruta: "/menu/index.html", n: 1 }} onClose={onClose} labels={labels} />,
      );
    });
    const editar = [...el.querySelectorAll("button")].find((b) => b.textContent === "Editar")!;
    await act(async () => editar.click());
    const area = el.querySelector<HTMLTextAreaElement>("[data-editor-de-fichero] textarea")!;
    return { el, area, llamadas, onClose };
  }
  const escribirEn = (area: HTMLTextAreaElement, texto: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      setter.call(area, texto);
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("empieza por lo GUARDADO, Ctrl+S guarda con su base y vuelve a la vista; Escape no cierra la lente", async () => {
    const { el, area, llamadas, onClose } = await abrirMenu(() => new Response(JSON.stringify({ contenido: "<h1>Carta</h1>\n" })));
    expect(area.value).toBe("<h1>Menú</h1>");
    expect(tecla(area, "Escape").defaultPrevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    escribirEn(area, "<h1>Carta</h1>");
    await act(async () => {
      area.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
    });
    const put = llamadas.find((l) => l.init?.method === "PUT")!;
    expect(put.url).toBe("/api/projects/p1/ficheros");
    expect(JSON.parse(String(put.init!.body))).toEqual({ ruta: "/menu/index.html", contenido: "<h1>Carta</h1>", base: "<h1>Menú</h1>" });
    expect(el.querySelector("[data-editor-de-fichero]")).toBeNull();
    // Y se vuelve a pedir la lista, para enseñar lo guardado.
    expect(llamadas.filter((l) => !l.init?.method).length).toBeGreaterThanOrEqual(3);
  });

  it("🔴 si cambió mientras lo editabas, no se guarda nada y se puede cargar lo de ahora", async () => {
    const { el, area } = await abrirMenu(() => new Response(JSON.stringify({ error: "cambio", actual: "<h1>Menú de Len</h1>" }), { status: 409 }));
    escribirEn(area, "<h1>Carta</h1>");
    await act(async () => [...el.querySelectorAll("button")].find((b) => b.textContent === "Guardar")!.click());
    expect(el.textContent).toContain("Este archivo cambió mientras lo editabas");
    act(() => [...el.querySelectorAll("button")].find((b) => b.textContent === "Cargar lo de ahora")!.click());
    expect(el.querySelector<HTMLTextAreaElement>("[data-editor-de-fichero] textarea")!.value).toBe("<h1>Menú de Len</h1>");
  });

  it("lo que una guarda rechaza dice por qué; lo que se calcula al abrirlo no tiene «Editar»", async () => {
    const { el, area } = await abrirMenu(
      () => new Response(JSON.stringify({ error: "rechazado", detalle: "menu/index.html: not saved — JavaScript…" }), { status: 422 }),
    );
    escribirEn(area, "<h1>Carta</h1><script>x()</script>");
    await act(async () => [...el.querySelectorAll("button")].find((b) => b.textContent === "Guardar")!.click());
    expect(el.textContent).toContain("No se guardó:");
    expect(el.textContent).toContain("menu/index.html: not saved — JavaScript…");

    const otro = document.createElement("div");
    document.body.appendChild(otro);
    const root = createRoot(otro);
    roots.push(root);
    await act(async () => {
      root.render(
        <CodeView html="<h1>Lienzo</h1>" projectId="p1" rutaActual="/index.html" peticion={{ ruta: "/resultados/visitas.json", n: 1 }} onClose={() => {}} labels={labels} />,
      );
    });
    expect([...otro.querySelectorAll("button")].some((b) => b.textContent === "Editar")).toBe(false);
  });
});
