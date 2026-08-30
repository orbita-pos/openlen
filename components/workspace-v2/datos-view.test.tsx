// Arnés manual de react-dom + act(), como el resto de los componentes del
// repo (ver ./scan-overlay.test.tsx). NO hay @testing-library aquí, y esta
// prueba no es motivo para añadirla.
//
// Esta línea citaba también ./panels/collections-panel.test.tsx, borrado el
// 2026-08-29 con el módulo. Un comentario que apunta a un fichero que ya no
// existe manda a quien lo lea a buscar diez minutos algo que no está.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { DatosView } from "./datos-view";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const labels = {
  title: "Datos",
  close: "Cerrar",
  vacio: "Esta página todavía no guarda datos.",
  modoLectura: "lo mantienes tú",
  modoVisitante: "lo escriben los visitantes",
  error: "No se pudieron leer los datos.",
  filas: (n: number) => `${n} filas`,
  vacia: "NULL",
};

const roots: Root[] = [];

afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Renderiza y espera al `fetch` de montaje. */
async function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    const root = createRoot(container);
    roots.push(root);
    root.render(<DatosView projectId="p1" onClose={() => {}} labels={labels} />);
  });
  return container;
}

function conRespuesta(cuerpo: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(cuerpo) } as Response)),
  );
}

describe("DatosView", () => {
  it("pinta una columna por campo declarado y una fila por documento", async () => {
    conRespuesta({
      ok: true,
      almacenes: {
        menu: {
          modo: "lectura",
          campos: { plato: "texto", precio: "numero" },
          filas: [{ id: "1", doc: { plato: "Tacos", precio: 45 } }],
        },
      },
    });

    const c = await render();
    expect(c.textContent).toContain("plato");
    expect(c.textContent).toContain("precio");
    expect(c.textContent).toContain("Tacos");
    expect(c.textContent).toContain("45");
  });

  // Lo que hace que esto sea una VENTANA y no un panel que hay que atender: sin
  // almacenes no le pide nada al usuario, sólo explica de dónde salen.
  it("sin almacenes explica que los declara la página", async () => {
    conRespuesta({ ok: true, almacenes: {} });
    const c = await render();
    expect(c.textContent).toContain(labels.vacio);
  });

  it("dice quién mantiene cada almacén", async () => {
    conRespuesta({
      ok: true,
      almacenes: { carrito: { modo: "propio", campos: { total: "numero" }, filas: [] } },
    });
    const c = await render();
    expect(c.textContent).toContain(labels.modoVisitante);
  });

  // Un fallo de red NO puede dejar el panel en blanco para siempre: un blanco
  // se lee como «no tengo datos», que es una cosa distinta y falsa.
  it("un fallo de red se dice, no se calla", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("sin red"))));
    const c = await render();
    expect(c.textContent).toContain(labels.error);
  });

  // 1) EL TIPO BAJO EL NOMBRE. Es lo que convierte una tabla en una vista de
  //    base de datos: la columna dice qué acepta, no sólo cómo se llama.
  it("cada columna enseña su tipo declarado", async () => {
    conRespuesta({
      ok: true,
      almacenes: {
        menu: {
          modo: "lectura",
          campos: { plato: "texto", precio: "numero" },
          filas: [{ id: "1", doc: { plato: "Tacos", precio: 45 } }],
        },
      },
    });
    const c = await render();
    expect(c.textContent).toContain("texto");
    expect(c.textContent).toContain("numero");
  });

  // 2) UNA CELDA QUE NO EXISTE NO ES UNA CELDA VACÍA. Un blanco se lee como
  //    «está vacío»; NULL dice «este documento no trae ese campo», que es lo
  //    que de verdad pasa cuando el modelo guarda filas desiguales.
  it("una celda ausente se marca, no se deja en blanco", async () => {
    conRespuesta({
      ok: true,
      almacenes: {
        menu: {
          modo: "lectura",
          campos: { plato: "texto", precio: "numero" },
          filas: [{ id: "1", doc: { plato: "Agua" } }],
        },
      },
    });
    const c = await render();
    expect(c.textContent).toContain(labels.vacia);
  });

  // 3) EL CONTADOR. Saber si son 4 filas o 4.000 sin contarlas a ojo.
  it("dice cuántas filas tiene cada almacén", async () => {
    conRespuesta({
      ok: true,
      almacenes: {
        menu: {
          modo: "lectura",
          campos: { plato: "texto" },
          filas: [
            { id: "1", doc: { plato: "a" } },
            { id: "2", doc: { plato: "b" } },
          ],
        },
      },
    });
    const c = await render();
    expect(c.textContent).toContain("2 filas");
  });

  // 4) UN BOOLEANO NO ES LA PALABRA «true». Se pinta como valor, no como texto
  //    del usuario, para que se distinga de un campo de texto que diga "true".
  it("los booleanos se distinguen del texto", async () => {
    conRespuesta({
      ok: true,
      almacenes: {
        menu: {
          modo: "lectura",
          campos: { disponible: "booleano" },
          filas: [{ id: "1", doc: { disponible: false } }],
        },
      },
    });
    const c = await render();
    expect(c.querySelector("[data-valor='booleano']")).toBeTruthy();
    expect(c.textContent).toContain("false");
  });

  it("un campo vacío no rompe la fila", async () => {
    conRespuesta({
      ok: true,
      almacenes: {
        menu: {
          modo: "lectura",
          campos: { plato: "texto", precio: "numero" },
          filas: [{ id: "1", doc: { plato: "Flan" } }],
        },
      },
    });
    const c = await render();
    expect(c.textContent).toContain("Flan");
  });
});
