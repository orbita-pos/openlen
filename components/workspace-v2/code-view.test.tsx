// @vitest-environment jsdom
// LA LENTE «CÓDIGO», COMO VS CODE: el explorador (crear, renombrar, borrar,
// carpetas), las pestañas con el editor de verdad (CodeMirror), guardar con su
// base, buscar (la #11), la marca de lo cambiado (la #19), comentar una línea
// para Len (la #8) y el fichero pedido desde el Chat (la #9). Arnés manual de
// react-dom + act(), como `terminal-view.test.tsx`; el servidor, un `fetch`
// falso que hace de `/api/projects/[id]/ficheros`.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";

import { CodeView } from "./code-view";
import { esperaALen } from "./hilos-del-codigo";
import { comentariosDelChat } from "@/lib/workspace-v2/comentarios-de-lineas";
import { cambiosEnVivo } from "@/lib/workspace-v2/cambios-en-vivo";
import { turnosDelHilo } from "@/lib/workspace-v2/turnos-del-hilo";

// `next/dynamic` carga el editor aparte: aquí, con React.lazy, para esperarlo.
vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return {
    default: (cargar: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>) => {
      const Perezoso = React.lazy(cargar);
      return (p: Record<string, unknown>) => React.createElement(React.Suspense, { fallback: null }, React.createElement(Perezoso, p));
    },
  };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // jsdom no mide: CodeMirror pregunta por rectángulos que aquí no existen.
  const vacio = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getClientRects ??= vacio;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});

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
    guardar: "Guardar",
    guardando: "Guardando…",
    cargando: "Cargando…",
    cambio: "Este archivo cambió mientras lo editabas. No se guardó nada.",
    cargarAhora: "Cargar lo de ahora",
    rechazado: "No se guardó:",
    error: "No se pudo guardar.",
    nota: "Se guarda como tu versión.",
  },
  ide: {
    nuevoArchivo: "Nuevo archivo",
    nuevaCarpeta: "Nueva carpeta",
    contraer: "Contraer carpetas",
    actualizar: "Actualizar",
    acciones: "Más acciones",
    renombrar: "Renombrar",
    borrar: "Borrar",
    copiarRuta: "Copiar ruta",
    nombre: "Nombre",
    nombreInvalido: "Nombre no válido",
    existe: (ruta: string) => `Ya existe ${ruta}.`,
    pagina: "Las páginas no se renombran desde aquí.",
    portada: "La portada no se puede borrar.",
    confirmarBorrar: (ruta: string) => `¿Borrar ${ruta}?`,
    confirmarBorrarCarpeta: (ruta: string) => `¿Borrar la carpeta ${ruta}?`,
    confirmarCerrar: (nombre: string) => `${nombre} tiene cambios. ¿Cerrar?`,
    cerrarPestana: "Cerrar",
    sinGuardar: "Sin guardar",
    vacio: "Abre un archivo.",
    comentarAyuda: "Pulsa el número de una línea para comentarla a Len.",
    carpetaVacia: "Vacía",
    cerrarAviso: "Cerrar el aviso",
    noSeHizo: "No se hizo:",
    dividir: "Dividir a la derecha",
    abrirAlLado: "Abrir al lado",
    subidos: (n: number) => `${n} subidos.`,
    noSubidos: "No se subieron:",
    motivo: { tipo: "tipo", grande: "grande", nombre: "nombre", demasiados: "demasiados" },
    reemplazar: (n: number, lista: string) => `¿Reemplazar ${lista}?`,
    subiendo: "Subiendo…",
  },
};

/** El servidor de mentira: la lista, y lo que le llega por cada método. */
let LISTA: { ficheros: { ruta: string; contenido: string }[]; perezosos: string[] };
let llamadas: { metodo: string; url: string; cuerpo: unknown }[];
let respuesta: (metodo: string, url: string, cuerpo: unknown) => Response | null;

const roots: Root[] = [];
let n = 0;
let proyecto = "";
beforeEach(() => {
  // Cada prueba, su proyecto: lo abierto se recuerda por proyecto.
  proyecto = `p${++n}`;
  LISTA = {
    ficheros: [
      { ruta: "/index.html", contenido: "<h1>Portada</h1>" },
      { ruta: "/menu/index.html", contenido: "<h1>Menú</h1>" },
      { ruta: "/datos/reservas.json", contenido: '[{"nombre":"Ana"}]' },
    ],
    perezosos: ["/.openlen/resultados/visitas.json"],
  };
  llamadas = [];
  respuesta = () => null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const metodo = init?.method ?? "GET";
      const cuerpo = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      llamadas.push({ metodo, url, cuerpo });
      const propia = respuesta(metodo, url, cuerpo);
      if (propia) return propia;
      if (metodo === "GET" && url.includes("?ruta=")) return new Response(JSON.stringify({ contenido: '{"hoy":12}' }));
      if (metodo === "GET") return new Response(JSON.stringify(LISTA));
      return new Response(JSON.stringify({ rutas: [] }));
    }),
  );
  vi.stubGlobal("confirm", vi.fn(() => true));
});
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function esperar(cond: () => unknown, veces = 60) {
  for (let i = 0; i < veces && !cond(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

async function pintar(o: { peticion?: { ruta: string; n: number } | null; onClose?: () => void; id?: string; labels?: typeof labels } = {}) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  const render = async (peticion: { ruta: string; n: number } | null = o.peticion ?? null) => {
    await act(async () => {
      root.render(
        <CodeView
          html="<h1>Lienzo</h1>"
          projectId={o.id ?? proyecto}
          rutaActual="/index.html"
          peticion={peticion}
          onClose={o.onClose ?? (() => {})}
          labels={o.labels ?? labels}
        />,
      );
    });
    await esperar(() => el.querySelector(".cm-editor") || el.textContent?.includes(labels.ide.vacio));
  };
  await render();
  return { el, root, render };
}

const editor = (el: HTMLElement) => EditorView.findFromDOM(el.querySelector<HTMLElement>(".cm-editor")!)!;
const texto = (el: HTMLElement) => editor(el).state.doc.toString();
const escribir = (el: HTMLElement, nuevo: string) =>
  act(() => {
    const v = editor(el);
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: nuevo } });
  });
const pestanas = (el: HTMLElement) => [...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
const activa = (el: HTMLElement) => el.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
const botonDelArbol = (el: HTMLElement, nombre: string) =>
  [...el.querySelectorAll<HTMLButtonElement>("nav li button")].find((b) => b.querySelector(".truncate")?.textContent === nombre)!;
// Por comparación y no con un selector: «Ctrl+\» lleva una barra que CSS se come.
const porEtiqueta = (el: HTMLElement, etiqueta: string) =>
  [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === etiqueta)!;
const tecla = (target: Element, key: string, extra: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
};
const escribirNombre = async (el: HTMLElement, nombre: string) => {
  const caja = el.querySelector<HTMLInputElement>('nav input[aria-label="Nombre"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(caja, nombre);
    caja.dispatchEvent(new Event("input", { bubbles: true }));
  });
  tecla(caja, "Enter");
  await esperar(() => false, 3);
};

describe("CodeView — abrir archivos en pestañas", () => {
  it("abre la página del lienzo con lo GUARDADO, en un editor de verdad", async () => {
    const { el } = await pintar();
    expect(pestanas(el)).toEqual(["index.html"]);
    expect(texto(el)).toBe("<h1>Portada</h1>");
    expect(el.querySelector(".cm-lineNumbers")).not.toBeNull();
  });

  it("un clic en el árbol abre otra pestaña; la petición del Chat también, con su carpeta desplegada", async () => {
    const { el, render } = await pintar();
    act(() => botonDelArbol(el, "reservas.json").click());
    await esperar(() => texto(el).includes("Ana"));
    expect(pestanas(el)).toEqual(["index.html", "reservas.json"]);
    await render({ ruta: "/menu/index.html", n: 2 });
    await esperar(() => texto(el).includes("Menú"));
    expect(activa(el)).toBe("index.html");
    expect(pestanas(el)).toEqual(["index.html", "reservas.json", "index.html"]);
    expect(el.querySelector("header")?.textContent).toContain("menu/index.html");
  });

  it("lo que se calcula al abrirlo se pide y es de sólo lectura (sin Guardar)", async () => {
    const { el } = await pintar({ peticion: { ruta: "/.openlen/resultados/visitas.json", n: 1 } });
    await esperar(() => el.querySelector(".cm-editor") && texto(el).includes("hoy"));
    expect(texto(el)).toBe('{"hoy":12}');
    expect(editor(el).state.readOnly).toBe(true);
    expect([...el.querySelectorAll("header button")].some((b) => b.textContent === "Guardar")).toBe(false);
    expect(el.textContent).toContain("Sólo lectura");
  });

  it("si el archivo ya no está, lo dice", async () => {
    const { el } = await pintar({ peticion: { ruta: "/borrada/index.html", n: 1 } });
    await esperar(() => el.textContent?.includes("ya no está."));
    expect(el.textContent).toContain("borrada/index.html · ya no está.");
  });
});

describe("CodeView — editar y guardar", () => {
  it("🔴 escribir marca la pestaña sin guardar; Ctrl+S guarda con su BASE y la deja limpia", async () => {
    respuesta = (m, _u, c) => {
      if (m !== "PUT") return null;
      const { ruta, contenido } = c as { ruta: string; contenido: string };
      LISTA.ficheros = LISTA.ficheros.map((f) => (f.ruta === ruta ? { ruta, contenido } : f));
      return new Response(JSON.stringify({ contenido }));
    };
    const { el } = await pintar();
    escribir(el, "<h1>Portada nueva</h1>");
    expect(el.querySelector('[role="tablist"]')!.textContent).toContain("●");
    tecla(el.querySelector(".cm-content")!, "s", { ctrlKey: true });
    await esperar(() => llamadas.some((l) => l.metodo === "PUT"));
    await esperar(() => !el.querySelector('[role="tablist"]')!.textContent!.includes("●"));
    expect(llamadas.find((l) => l.metodo === "PUT")!.cuerpo).toEqual({
      ruta: "/index.html",
      contenido: "<h1>Portada nueva</h1>",
      base: "<h1>Portada</h1>",
    });
    expect(texto(el)).toBe("<h1>Portada nueva</h1>");
  });

  it("si cambió mientras lo editabas, no se pisa: avisa, y «Cargar lo de ahora» lo trae", async () => {
    respuesta = (m) => (m === "PUT" ? new Response(JSON.stringify({ error: "cambio", actual: "<h1>De Len</h1>" }), { status: 409 }) : null);
    const { el } = await pintar();
    escribir(el, "<h1>Mío</h1>");
    act(() => [...el.querySelectorAll<HTMLButtonElement>("header button")].find((b) => b.textContent === "Guardar")!.click());
    await esperar(() => el.textContent?.includes("cambió mientras lo editabas"));
    act(() => [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Cargar lo de ahora")!.click());
    await esperar(() => texto(el) === "<h1>De Len</h1>");
    expect(texto(el)).toBe("<h1>De Len</h1>");
    expect(el.querySelector('[role="tablist"]')!.textContent).not.toContain("●");
  });

  it("lo que una guarda rechaza dice por qué", async () => {
    respuesta = (m) => (m === "PUT" ? new Response(JSON.stringify({ error: "rechazado", detalle: "data-slot-path no" }), { status: 422 }) : null);
    const { el } = await pintar();
    escribir(el, "<h1 data-slot-path=x>x</h1>");
    tecla(el.querySelector(".cm-content")!, "s", { ctrlKey: true });
    await esperar(() => el.textContent?.includes("data-slot-path no"));
    expect(el.textContent).toContain("No se guardó:");
  });

  it("cerrar una pestaña con cambios pregunta; si no, se queda", async () => {
    const { el } = await pintar();
    escribir(el, "<h1>sin guardar</h1>");
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    act(() => porEtiqueta(el, "Cerrar: index.html (Sin guardar)").click());
    expect(pestanas(el)).toEqual(["index.html"]);
    act(() => porEtiqueta(el, "Cerrar: index.html (Sin guardar)").click());
    expect(pestanas(el)).toEqual([]);
    expect(el.textContent).toContain("Abre un archivo.");
  });

  it("🔴 lo no guardado sobrevive a cerrar la lente y volver (mirar la app y volver)", async () => {
    const primera = await pintar();
    escribir(primera.el, "<h1>a medias</h1>");
    act(() => primera.root.unmount());
    roots.splice(roots.indexOf(primera.root), 1);
    const { el } = await pintar();
    expect(texto(el)).toBe("<h1>a medias</h1>");
    expect(el.querySelector('[role="tablist"]')!.textContent).toContain("●");
  });
});

describe("CodeView — el explorador: crear, renombrar, borrar", () => {
  it("«Nuevo archivo» en la carpeta elegida: el nombre se escribe en el árbol, se crea y se abre", async () => {
    respuesta = (m, _u, c) => {
      if (m !== "POST") return null;
      LISTA.ficheros.push({ ruta: (c as { ruta: string }).ruta, contenido: "" });
      return new Response(JSON.stringify({ rutas: [(c as { ruta: string }).ruta] }));
    };
    const { el } = await pintar();
    act(() => botonDelArbol(el, "datos").click()); // elegir la carpeta (y plegarla)
    act(() => porEtiqueta(el, "Nuevo archivo").click());
    await escribirNombre(el, "horarios.json");
    await esperar(() => activa(el) === "horarios.json");
    expect(llamadas.find((l) => l.metodo === "POST")!.cuerpo).toEqual({ ruta: "/datos/horarios.json" });
    expect(activa(el)).toBe("horarios.json");
  });

  it("un nombre que no vale se dice y no se crea nada", async () => {
    const { el } = await pintar();
    act(() => porEtiqueta(el, "Nuevo archivo").click());
    const caja = el.querySelector<HTMLInputElement>('nav input[aria-label="Nombre"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(caja, "con espacio.js");
      caja.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(el.textContent).toContain("Nombre no válido");
    tecla(caja, "Enter");
    expect(llamadas.some((l) => l.metodo === "POST")).toBe(false);
  });

  it("«Nueva carpeta» aparece vacía en el árbol, y un archivo nuevo dentro nace en ella", async () => {
    const { el } = await pintar();
    act(() => porEtiqueta(el, "Nueva carpeta").click());
    await escribirNombre(el, "js");
    expect(botonDelArbol(el, "js")).toBeTruthy();
    expect(llamadas.some((l) => l.metodo === "POST")).toBe(false);
    act(() => porEtiqueta(el, "Nuevo archivo").click());
    await escribirNombre(el, "app.js");
    await esperar(() => llamadas.some((l) => l.metodo === "POST"));
    expect(llamadas.find((l) => l.metodo === "POST")!.cuerpo).toEqual({ ruta: "/js/app.js" });
  });

  it("F2 renombra (y la pestaña abierta sigue al archivo); una página no tiene «Renombrar»", async () => {
    respuesta = (m) => (m === "PATCH" ? new Response(JSON.stringify({ rutas: ["/datos/citas.json"] })) : null);
    const { el } = await pintar();
    act(() => botonDelArbol(el, "reservas.json").click());
    await esperar(() => activa(el) === "reservas.json");
    tecla(botonDelArbol(el, "reservas.json"), "F2");
    await escribirNombre(el, "citas.json");
    await esperar(() => llamadas.some((l) => l.metodo === "PATCH"));
    expect(llamadas.find((l) => l.metodo === "PATCH")!.cuerpo).toEqual({ de: "/datos/reservas.json", a: "/datos/citas.json" });
    expect(pestanas(el)).toContain("citas.json");
    // El menú de una página: sin «Renombrar».
    act(() => {
      porEtiqueta(el, "Más acciones: index.html").click();
    });
    const menu = el.querySelector('[role="menu"]')!;
    expect([...menu.querySelectorAll("button")].map((b) => b.textContent?.replace(/F2|Supr/, ""))).toEqual(["Borrar", "Copiar ruta"]);
  });

  it("Supr borra lo elegido tras preguntar; una carpeta con una página la borra por su propia ruta", async () => {
    respuesta = (m, url) => {
      if (m === "DELETE" && url.includes("/ficheros?ruta=%2Fmenu")) {
        return new Response(JSON.stringify({ error: "pagina", rutas: ["/menu/index.html"] }), { status: 409 });
      }
      return null;
    };
    const { el } = await pintar();
    act(() => botonDelArbol(el, "menu").click());
    tecla(botonDelArbol(el, "menu"), "Delete");
    await esperar(() => llamadas.some((l) => l.url.includes("/pages/menu")));
    expect(window.confirm).toHaveBeenCalledWith("¿Borrar la carpeta /menu?");
    expect(llamadas.filter((l) => l.metodo === "DELETE").map((l) => decodeURIComponent(l.url))).toEqual([
      `/api/projects/${proyecto}/ficheros?ruta=/menu`,
      `/api/projects/${proyecto}/pages/menu`,
    ]);
  });

  it("la portada no se borra, y se dice", async () => {
    const { el } = await pintar();
    const portada = [...el.querySelectorAll<HTMLButtonElement>("nav > ul > li button")].find((b) => b.querySelector(".truncate")?.textContent === "index.html")!;
    act(() => portada.click());
    tecla(portada, "Delete");
    expect(el.querySelector('[role="alert"]')!.textContent).toContain("La portada no se puede borrar.");
    expect(llamadas.some((l) => l.metodo === "DELETE")).toBe(false);
  });

  it("lo que el servidor no hace se explica en el aviso", async () => {
    respuesta = (m) => (m === "POST" ? new Response(JSON.stringify({ error: "rechazado", detalle: "/api/ is reserved" }), { status: 422 }) : null);
    const { el } = await pintar();
    act(() => porEtiqueta(el, "Nuevo archivo").click());
    await escribirNombre(el, "api/x.js");
    await esperar(() => el.querySelector('[role="alert"]'));
    expect(el.querySelector('[role="alert"]')!.textContent).toContain("No se hizo: /api/ is reserved");
  });
});

describe("CodeView — buscar en los archivos (la #11)", () => {
  const buscar = (el: HTMLElement, q: string) => {
    const caja = el.querySelector<HTMLInputElement>('input[aria-label="Buscar en los archivos"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(caja, q);
      caja.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return caja;
  };

  it("por nombre y por dentro; Enter abre el resultado en su línea; Escape borra y no cierra la lente", async () => {
    const onClose = vi.fn();
    const { el } = await pintar({ onClose });
    const caja = buscar(el, "Ana");
    expect(el.textContent).toContain("Dentro de los archivos");
    tecla(caja, "Enter");
    await esperar(() => activa(el) === "reservas.json");
    expect(activa(el)).toBe("reservas.json");
    expect(tecla(caja, "Escape").defaultPrevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(caja.value).toBe("");
  });

  it("Ctrl+P y Ctrl+Mayús+F llevan al buscador", async () => {
    const { el } = await pintar();
    const caja = el.querySelector<HTMLInputElement>('input[aria-label="Buscar en los archivos"]')!;
    tecla(document.body, "p", { ctrlKey: true });
    expect(document.activeElement).toBe(caja);
    act(() => caja.blur());
    tecla(document.body, "F", { ctrlKey: true, shiftKey: true });
    expect(document.activeElement).toBe(caja);
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
    const { el } = await pintar({ id: "p-marcas" });
    const marcadas = [...el.querySelectorAll("nav li button > span[title]")].map((m) => [
      m.closest("button")!.querySelector(".truncate")!.textContent,
      m.getAttribute("title"),
    ]);
    expect(marcadas).toEqual([
      ["reservas.json", "Nuevo en esta sesión"],
      ["index.html", "Cambió en esta sesión"],
    ]);
    expect(el.querySelectorAll("nav button[aria-expanded] .opacity-40")).toHaveLength(2);
  });
});

describe("CodeView — comentar una línea para el siguiente mensaje (la #8)", () => {
  it("pulsar el NÚMERO de una línea abre la caja; lo añadido espera el mensaje con el código de esa línea", async () => {
    comentariosDelChat.vaciar(proyecto);
    const { el } = await pintar();
    const numero = el.querySelector(".cm-lineNumbers .cm-gutterElement:not(.cm-gutterElement[style*='hidden'])");
    // El primero del margen puede ser el que mide; se busca el de la línea 1.
    const uno = [...el.querySelectorAll(".cm-lineNumbers .cm-gutterElement")].find((g) => g.textContent === "1") ?? numero!;
    act(() => {
      uno.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    const area = el.querySelector<HTMLTextAreaElement>("[data-caja-de-comentario] textarea")!;
    expect(area).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      setter.call(area, "un título más corto");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    tecla(area, "Enter");
    expect(comentariosDelChat.lista(proyecto)).toMatchObject([
      { ruta: "/index.html", linea: 1, codigo: "<h1>Portada</h1>", texto: "un título más corto" },
    ]);
    expect(el.querySelector("[data-comentario-pendiente]")!.textContent).toContain("un título más corto");
    await esperar(() => el.querySelector(".ol-marca-comentario"));
    expect(el.querySelector(".ol-marca-comentario")).not.toBeNull();
  });
});

describe("CodeView sin proyecto (la vista previa de una plantilla)", () => {
  it("sólo el documento, de sólo lectura y con colores", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    roots.push(root);
    await act(async () => {
      root.render(<CodeView html="<h1>Plantilla</h1>" projectId={null} onClose={() => {}} labels={labels} />);
    });
    expect(el.querySelector("nav")).toBeNull();
    expect([...el.querySelectorAll(".sx-etq")].map((s) => s.textContent)).toEqual(["h1", "h1"]);
  });
});

describe("CodeView — dos editores lado a lado", () => {
  const editorDe = (el: HTMLElement, g: number) => EditorView.findFromDOM(el.querySelector<HTMLElement>(`[data-grupo="${g}"] .cm-editor`)!)!;
  const pestanasDe = (el: HTMLElement, g: number) => [...el.querySelectorAll(`[data-grupo="${g}"] [role="tab"]`)].map((t) => t.textContent);

  it("«Dividir» abre el archivo también a la derecha; lo escrito en uno se ve en el otro", async () => {
    const { el } = await pintar();
    act(() => porEtiqueta(el, "Dividir a la derecha (Ctrl+\\)").click());
    await esperar(() => el.querySelector('[data-grupo="1"] .cm-editor'));
    expect(pestanasDe(el, 0)).toEqual(["index.html"]);
    expect(pestanasDe(el, 1)).toEqual(["index.html"]);
    // Con dos, se sigue pudiendo dividir: caben hasta cuatro.
    expect(porEtiqueta(el, "Dividir a la derecha (Ctrl+\\)")).toBeDefined();
    act(() => {
      const v = editorDe(el, 0);
      v.dispatch({ changes: { from: v.state.doc.length, insert: "<p>uno</p>" } });
    });
    await esperar(() => editorDe(el, 1).state.doc.toString().includes("uno"));
    expect(editorDe(el, 1).state.doc.toString()).toBe("<h1>Portada</h1><p>uno</p>");
    act(() => {
      const v = editorDe(el, 1);
      v.dispatch({ changes: { from: v.state.doc.length, insert: "<p>dos</p>" } });
    });
    await esperar(() => editorDe(el, 0).state.doc.toString().includes("dos"));
    expect(editorDe(el, 0).state.doc.toString()).toBe("<h1>Portada</h1><p>uno</p><p>dos</p>");
    // Cerrarlo en un lado no pregunta: lo escrito sigue en el otro.
    act(() => el.querySelectorAll<HTMLButtonElement>('[data-grupo="1"] [aria-label^="Cerrar: index.html"]')[0]!.click());
    expect(window.confirm).not.toHaveBeenCalled();
    expect(el.querySelector('[data-grupo="1"]')).toBeNull();
    expect(texto(el)).toContain("dos");
  });

  it("Ctrl+\\ divide; lo que se abre del árbol va al editor activo", async () => {
    const { el } = await pintar();
    tecla(document.body, "\\", { ctrlKey: true });
    await esperar(() => el.querySelector('[data-grupo="1"] .cm-editor'));
    act(() => botonDelArbol(el, "reservas.json").click());
    await esperar(() => pestanasDe(el, 1).includes("reservas.json"));
    expect(pestanasDe(el, 1)).toEqual(["index.html", "reservas.json"]);
    expect(pestanasDe(el, 0)).toEqual(["index.html"]);
  });

  it("arrastrar una pestaña al otro editor la muda allí; un archivo del árbol, la abre", async () => {
    const { el } = await pintar();
    act(() => botonDelArbol(el, "reservas.json").click());
    await esperar(() => activa(el) === "reservas.json");
    act(() => porEtiqueta(el, "Dividir a la derecha (Ctrl+\\)").click());
    await esperar(() => el.querySelector('[data-grupo="1"] .cm-editor'));
    // La pestaña index.html del primero, al segundo.
    const tab = [...el.querySelectorAll<HTMLElement>('[data-grupo="0"] [role="tab"]')].find((t) => t.textContent === "index.html")!.parentElement!;
    act(() => {
      tab.dispatchEvent(new Event("dragstart", { bubbles: true }));
    });
    act(() => {
      el.querySelector('[data-grupo="1"]')!.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    });
    expect(pestanasDe(el, 0)).toEqual(["reservas.json"]);
    expect(pestanasDe(el, 1)).toEqual(["reservas.json", "index.html"]);
    // Y un archivo del árbol soltado en el primero se abre en el primero.
    act(() => {
      botonDelArbol(el, "index.html").parentElement!.dispatchEvent(new Event("dragstart", { bubbles: true }));
    });
    act(() => {
      el.querySelector('[data-grupo="0"]')!.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    });
    await esperar(() => pestanasDe(el, 0).length === 2);
    expect(pestanasDe(el, 0)).toEqual(["reservas.json", "index.html"]);
  });

  it("🔴 hasta cuatro lados: Ctrl+\\ divide hasta cuatro, y no más", async () => {
    const { el } = await pintar();
    for (let i = 0; i < 4; i++) tecla(document.body, "\\", { ctrlKey: true });
    await esperar(() => el.querySelector('[data-grupo="3"] .cm-editor'));
    expect(el.querySelectorAll("[data-grupo]")).toHaveLength(4);
    expect(porEtiqueta(el, "Dividir a la derecha (Ctrl+\\)")).toBeUndefined();
  });

  it("🔴 una pestaña soltada sobre otra de su mismo lado se coloca delante de ella", async () => {
    const { el } = await pintar();
    act(() => botonDelArbol(el, "reservas.json").click());
    await esperar(() => pestanasDe(el, 0).length === 2);
    expect(pestanasDe(el, 0)).toEqual(["index.html", "reservas.json"]);
    const tabDe = (nombre: string) => [...el.querySelectorAll<HTMLElement>('[data-grupo="0"] [role="tab"]')].find((t) => t.textContent === nombre)!.parentElement!;
    act(() => {
      tabDe("reservas.json").dispatchEvent(new Event("dragstart", { bubbles: true }));
    });
    act(() => {
      tabDe("index.html").dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
    });
    act(() => {
      tabDe("index.html").dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    });
    expect(pestanasDe(el, 0)).toEqual(["reservas.json", "index.html"]);
    expect(el.querySelectorAll("[data-grupo]")).toHaveLength(1);
  });

  it("mientras se arrastra aparece la franja «Abrir al lado»; soltar ahí abre un editor nuevo", async () => {
    const { el } = await pintar();
    expect(el.querySelector("[data-abrir-al-lado]")).toBeNull();
    act(() => {
      botonDelArbol(el, "reservas.json").parentElement!.dispatchEvent(new Event("dragstart", { bubbles: true }));
    });
    const franja = el.querySelector("[data-abrir-al-lado]")!;
    expect(franja.textContent).toBe("Abrir al lado");
    act(() => {
      franja.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    });
    await esperar(() => pestanasDe(el, 1).length === 1);
    expect(pestanasDe(el, 0)).toEqual(["index.html"]);
    expect(pestanasDe(el, 1)).toEqual(["reservas.json"]);
    expect(el.querySelector("[data-abrir-al-lado]")).toBeNull();
  });
});

describe("CodeView — subir archivos soltándolos desde tu ordenador", () => {
  // El `File` de jsdom no tiene `text()`.
  const archivo = (contenido: string, nombre: string) => Object.assign(new File([contenido], nombre), { text: async () => contenido });
  const dice = (el: HTMLElement) => el.textContent ?? "";
  const soltarDelOrdenador = (hasta: Element, archivos: File[]) => {
    const dt = { types: ["Files"], items: [], files: archivos, dropEffect: "none" };
    for (const tipo of ["dragover", "drop"]) {
      const ev = new Event(tipo, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "dataTransfer", { value: dt });
      act(() => {
        hasta.dispatchEvent(ev);
      });
    }
  };

  it("🔴 lo nuevo se crea en la carpeta donde se suelta; lo que existe se reemplaza tras preguntar; una foto, no", async () => {
    const { el } = await pintar();
    soltarDelOrdenador(botonDelArbol(el, "datos").parentElement!, [
      archivo("body{}", "base.css"),
      archivo('[{"nombre":"Luis"}]', "reservas.json"),
      archivo("x", "foto.jpg"),
    ]);
    await esperar(() => dice(el).includes("subidos"));
    expect(window.confirm).toHaveBeenCalledWith("¿Reemplazar /datos/reservas.json?");
    expect(llamadas.find((l) => l.metodo === "POST")!.cuerpo).toEqual({ ruta: "/datos/base.css", contenido: "body{}" });
    expect(llamadas.find((l) => l.metodo === "PUT")!.cuerpo).toEqual({
      ruta: "/datos/reservas.json",
      contenido: '[{"nombre":"Luis"}]',
      base: '[{"nombre":"Ana"}]',
    });
    expect(dice(el)).toContain("2 subidos.");
    expect(dice(el)).toContain("foto.jpg — tipo");
  });

  it("si no quieres reemplazar, sólo se sube lo nuevo", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const { el } = await pintar();
    soltarDelOrdenador(el.querySelector("nav")!, [archivo("a", "app.js"), archivo("<h1>x</h1>", "index.html")]);
    await esperar(() => dice(el).includes("subidos"));
    expect(llamadas.filter((l) => l.metodo === "PUT")).toEqual([]);
    expect(llamadas.filter((l) => l.metodo === "POST").map((l) => (l.cuerpo as { ruta: string }).ruta)).toEqual(["/app.js"]);
    expect(dice(el)).toContain("1 subidos.");
  });
});

describe("CodeView — arrastrar y soltar en el árbol", () => {
  const arrastrar = (desde: Element, hasta: Element) => {
    act(() => {
      desde.dispatchEvent(new Event("dragstart", { bubbles: true }));
    });
    act(() => {
      hasta.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
    });
    act(() => {
      hasta.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    });
  };

  it("🔴 un archivo soltado en una carpeta se mueve a ella (y su pestaña lo sigue)", async () => {
    respuesta = (m) => (m === "PATCH" ? new Response(JSON.stringify({ rutas: ["/menu/reservas.json"] })) : null);
    const { el } = await pintar();
    act(() => botonDelArbol(el, "reservas.json").click());
    await esperar(() => activa(el) === "reservas.json");
    arrastrar(botonDelArbol(el, "reservas.json").parentElement!, botonDelArbol(el, "menu").parentElement!);
    await esperar(() => llamadas.some((l) => l.metodo === "PATCH"));
    expect(llamadas.find((l) => l.metodo === "PATCH")!.cuerpo).toEqual({ de: "/datos/reservas.json", a: "/menu/reservas.json" });
    await esperar(() => el.querySelector('[title="/menu/reservas.json"]'));
    expect(el.querySelector('[role="tab"][aria-selected="true"]')!.closest("[title]")!.getAttribute("title")).toBe("/menu/reservas.json");
  });

  it("soltado en el hueco del árbol va a la raíz; soltado donde ya está, no hace nada", async () => {
    respuesta = (m) => (m === "PATCH" ? new Response(JSON.stringify({ rutas: ["/reservas.json"] })) : null);
    const { el } = await pintar();
    const fila = botonDelArbol(el, "reservas.json").parentElement!;
    // En un archivo de su misma carpeta: ya está ahí.
    arrastrar(fila, fila);
    expect(llamadas.some((l) => l.metodo === "PATCH")).toBe(false);
    arrastrar(fila, el.querySelector("nav")!);
    await esperar(() => llamadas.some((l) => l.metodo === "PATCH"));
    expect(llamadas.find((l) => l.metodo === "PATCH")!.cuerpo).toEqual({ de: "/datos/reservas.json", a: "/reservas.json" });
  });

  it("una página no se arrastra, y lo de sólo lectura tampoco", async () => {
    const { el } = await pintar();
    expect(botonDelArbol(el, "menu").parentElement!.getAttribute("draggable")).toBe("true");
    const pagina = [...el.querySelectorAll<HTMLButtonElement>("nav li button")].find(
      (b) => b.querySelector(".truncate")?.textContent === "index.html" && b.closest("ul ul"),
    )!;
    expect(pagina.parentElement!.getAttribute("draggable")).toBe("false");
    expect(botonDelArbol(el, ".openlen").parentElement!.getAttribute("draggable")).toBe("false");
  });
});

describe("CodeView — hilos en una línea con @Len y @persona", () => {
  const HILOS = {
    placeholder: "Qué cambiar… @ para mencionar",
    comentar: "Comentar",
    responder: "Responder",
    placeholderRespuesta: "Responde…",
    resolver: "Resolver",
    reabrir: "Reabrir",
    resuelto: "Resuelto",
    len: "Len",
    trabajando: "Len está en ello…",
    soloEditoresLen: "Solo editores",
    error: "No se pudo",
  };
  const conHilos = { ...labels, ide: { ...labels.ide, hilos: HILOS, mencionado: "Te mencionaron aquí" } };
  let hilos: unknown[];

  const abrirCaja = async (el: HTMLElement) => {
    const uno = [...el.querySelectorAll(".cm-lineNumbers .cm-gutterElement")].find((g) => g.textContent === "1")!;
    act(() => {
      uno.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    return el.querySelector<HTMLTextAreaElement>("[data-caja-de-comentario] textarea")!;
  };
  const escribir = (area: HTMLTextAreaElement, valor: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      setter.call(area, valor);
      area.setSelectionRange(valor.length, valor.length);
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  beforeEach(() => {
    comentariosDelChat.vaciar(proyecto);
    hilos = [];
    respuesta = (m, url) => {
      if (url.includes("/hilos/vistas")) return new Response(JSON.stringify({ ok: true }));
      if (url.includes("/hilos?solo=sinVer")) return new Response(JSON.stringify({ sinVer: { total: 1, rutas: ["/datos/reservas.json"] } }));
      if (m === "GET" && url.includes("/hilos?ruta=")) {
        return new Response(
          JSON.stringify({
            hilos,
            personas: [
              { userId: "yo", nombre: "Yo", rol: "dueno" },
              { userId: "u-ana", nombre: "Ana", rol: "editor" },
            ],
            puedeLen: true,
            yo: "yo",
            sinVer: { total: 0, rutas: [] },
          }),
        );
      }
      if (m === "POST" && url.endsWith("/hilos")) return new Response(JSON.stringify({ hiloId: "h1", mensajeId: "m1", mencionados: ["u-ana"] }));
      return null;
    };
  });

  it("🔴 con @Ana, lo comentado se guarda como hilo (no espera al chat) y sale bajo su línea", async () => {
    const { el } = await pintar({ labels: conHilos });
    await esperar(() => llamadas.some((l) => l.url.includes("/hilos?ruta=")));
    const area = await abrirCaja(el);
    escribir(area, "@An");
    // El @ autocompleta.
    await esperar(() => el.querySelector("[data-arroba]"));
    expect([...el.querySelectorAll("[data-arroba] [role=option]")].map((o) => o.textContent)).toEqual(["@Ana"]);
    escribir(area, "@Ana ¿esto va así?");
    hilos = [
      {
        id: "h1", ruta: "/index.html", linea: 1, codigo: "<h1>Portada</h1>", estado: "abierto", creadoPor: "yo", sinVer: 0,
        mensajes: [{ id: "m1", autorId: "yo", autor: "Yo", texto: "@Ana ¿esto va así?", filaId: null, createdAt: "2026-10-07T10:00:00Z" }],
      },
    ];
    tecla(area, "Enter");
    await esperar(() => el.querySelector("[data-hilo]"));
    const post = llamadas.find((l) => l.metodo === "POST" && l.url.endsWith("/hilos"))!;
    expect(post.cuerpo).toMatchObject({ ruta: "/index.html", linea: 1, codigo: "<h1>Portada</h1>", texto: "@Ana ¿esto va así?", menciones: ["u-ana"], len: false });
    expect(comentariosDelChat.lista(proyecto)).toEqual([]);
    expect(el.querySelector("[data-hilo]")!.textContent).toContain("¿esto va así?");
    expect(turnosDelHilo.primero(proyecto)).toBeNull();
  });

  it("🔴 con @Len, el servidor empieza el turno: se anuncia al chat con lo escrito y de dónde, y el hilo dice que Len está en ello", async () => {
    const { el } = await pintar({ labels: conHilos });
    await esperar(() => llamadas.some((l) => l.url.includes("/hilos?ruta=")));
    respuesta = ((anterior) => (m: string, url: string, cuerpo: unknown) =>
      m === "POST" && url.endsWith("/hilos")
        ? new Response(JSON.stringify({ hiloId: "h1", mensajeId: "m1", mencionados: [], filaId: "fila-1" }))
        : anterior(m, url, cuerpo))(respuesta);
    const area = await abrirCaja(el);
    escribir(area, "@Len pon el título en azul");
    hilos = [
      {
        id: "h1", ruta: "/index.html", linea: 1, codigo: "<h1>Portada</h1>", estado: "abierto", creadoPor: "yo", sinVer: 0,
        mensajes: [{ id: "m1", autorId: "yo", autor: "Yo", texto: "@Len pon el título en azul", filaId: "fila-1", createdAt: "2026-10-07T10:00:00Z" }],
      },
    ];
    tecla(area, "Enter");
    await esperar(() => turnosDelHilo.primero(proyecto));
    const turno = turnosDelHilo.primero(proyecto)!;
    // Lo que enseña el chat es lo escrito, tal cual: el contexto lo pone el servidor, sólo para Len.
    expect(turno).toEqual({ filaId: "fila-1", texto: "@Len pon el título en azul", origen: { hiloId: "h1", ruta: "/index.html", linea: 1 } });
    expect(llamadas.find((l) => l.metodo === "POST" && l.url.endsWith("/hilos"))!.cuerpo).toMatchObject({ len: true });
    await esperar(() => el.querySelector("[data-len-trabajando]"));
    expect(el.querySelector("[data-len-trabajando]")!.textContent).toContain("Len está en ello…");
    turnosDelHilo.recogido(proyecto, turno);
  });

  it("sin @, comentar sigue esperando al próximo mensaje del chat, como siempre", async () => {
    const { el } = await pintar({ labels: conHilos });
    await esperar(() => llamadas.some((l) => l.url.includes("/hilos?ruta=")));
    const area = await abrirCaja(el);
    escribir(area, "más grande");
    tecla(area, "Enter");
    expect(comentariosDelChat.lista(proyecto)).toMatchObject([{ ruta: "/index.html", linea: 1, texto: "más grande" }]);
    expect(llamadas.some((l) => l.metodo === "POST" && l.url.endsWith("/hilos"))).toBe(false);
  });

  it("el explorador marca con @ los ficheros donde te mencionaron", async () => {
    const { el } = await pintar({ labels: conHilos });
    await esperar(() => el.querySelector("[data-mencionado]"));
    expect(botonDelArbol(el, "reservas.json").querySelector("[data-mencionado]")).not.toBeNull();
  });
});

describe("¿espera el hilo a Len?", () => {
  const msj = (autorId: string | null, filaId: string | null, texto = "x") => ({ id: Math.random().toString(), autorId, autor: autorId, texto, filaId, createdAt: new Date() });
  const hilo = (mensajes: ReturnType<typeof msj>[]) => ({ id: "h", ruta: "/a", linea: 1, codigo: "", estado: "abierto" as const, creadoPor: "yo", createdAt: new Date(), sinVer: 0, mensajes });
  it("🔴 mientras un pedido no tenga la respuesta de Len con su fila, aunque después hablen otros", () => {
    expect(esperaALen(hilo([msj("yo", "f1", "@Len hazlo"), msj("ana", null, "¿y esto?")]))).toBe(true);
    expect(esperaALen(hilo([msj("yo", "f1", "@Len hazlo"), msj(null, "f1", "Hecho.")]))).toBe(false);
  });
  it("nombrar a Len sin pedírselo (sin fila) no lo pone «en ello»", () => {
    expect(esperaALen(hilo([msj("yo", null, "esto lo hizo @Len ayer")]))).toBe(false);
  });
});
