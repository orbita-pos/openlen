// @vitest-environment node
//
// LOS OJOS DE LEN EN UNA APP (F3 de la spec local
// docs/superpowers/specs/2026-10-07-apps-design.md), en un Chromium de verdad:
//
//   · abren la PANTALLA que se pide (`#/ajustes`): las de una app van por hash;
//   · un error de la app sale con SU fichero y su línea de /src —los conserva
//     el compilador— y no anclado en el cascarón, que es justo donde no está;
//   · y esperan a que la red se calme tras cargar (H12): se comprueba que la
//     espera se pide, con su tope, sólo en una app.
import { describe, expect, it } from "vitest";
import { CATALOGO_ACTUAL } from "@/lib/apps/dependencias";
import { esqueletoDeApp } from "@/lib/apps/esqueleto";
import { carpetaDeLaVista, documentoMedible, pantallaDe, type ContextoDeVista } from "@/lib/lienzo/documento";
import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { cargarEnOrigenReal, ESPERA_A_LA_RED_MS, RED_CALMADA_MS } from "@/lib/ai/origen-de-medida";
import { diagnosticosMedidos } from "@/lib/agent/aviso-medido";

const APP = { catalogo: CATALOGO_ACTUAL, entrada: "/src/main.jsx" };
const CASCARON =
  '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Caja</title></head>' +
  '<body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>';

const FICHEROS: Record<string, string> = {
  "/src/main.jsx": [
    'import { createRoot } from "react-dom/client";',
    'import { HashRouter, Routes, Route } from "react-router-dom";',
    'import Ajustes from "./Ajustes";',
    'import Roto from "./Roto";',
    "createRoot(document.getElementById(\"root\")).render(",
    "  <HashRouter><Routes>",
    '    <Route path="/" element={<p data-prueba="pantalla">Inicio</p>} />',
    '    <Route path="/ajustes" element={<Ajustes />} />',
    '    <Route path="/roto" element={<Roto />} />',
    "  </Routes></HashRouter>,",
    ");",
  ].join("\n"),
  "/src/Ajustes.jsx": 'export default function Ajustes() {\n  return <p data-prueba="pantalla">Ajustes</p>;\n}',
  "/src/Roto.jsx": [
    "export default function Roto({ venta }) {", // 1
    "  const total = 0;", // 2
    "  return <p>{venta.lineas.length + total}</p>;", // 3 ← `venta` es undefined
    "}",
  ].join("\n"),
};

function vista(pantalla?: string): ContextoDeVista {
  return {
    projectId: "4f9c10cb-8781-48f1-b291-c5d146579f09",
    title: "Caja",
    sub: null,
    pagina: null,
    settings: undefined,
    logoUrl: null,
    files: FICHEROS,
    app: APP,
    entorno: {},
    pantalla: pantallaDe(pantalla),
  };
}

const LEER = `(async () => {
  for (let i = 0; i < 100; i++) { if (document.querySelector('[data-prueba="pantalla"]')) break; await new Promise((r) => setTimeout(r, 20)); }
  return { hash: location.hash, texto: document.querySelector('[data-prueba="pantalla"]')?.textContent ?? null };
})()`;

async function medir(pantalla?: string) {
  const v = vista(pantalla);
  const medida = await renderVisualQualityViewports(documentoMedible(CASCARON, v), {}, { behaviorProgram: LEER, carpeta: carpetaDeLaVista(v)! });
  expect(medida, "el render no devolvió nada").not.toBeNull();
  return medida!;
}

describe("los ojos de Len en una app", () => {
  it("abren el principio de la app si no se pide pantalla", async () => {
    const m = await medir();
    expect(m.runtimeErrors ?? []).toEqual([]);
    expect(m.behaviorResult).toEqual({ hash: "", texto: "Inicio" });
  }, 90_000);

  it("🔴 abren la PANTALLA que se pide, por su ruta de hash", async () => {
    const m = await medir("/ajustes");
    expect(m.runtimeErrors ?? []).toEqual([]);
    expect(m.behaviorResult).toEqual({ hash: "#/ajustes", texto: "Ajustes" });
  }, 90_000);

  it("🔴 un error de la app sale con SU fichero y su línea, y así se le dice a Len", async () => {
    const m = await medir("#/roto");
    const errores = (m.runtimeErrors ?? []).join("\n");
    expect(errores).toMatch(/\(at \/src\/Roto\.jsx:3:\d+\)/);
    const diags = diagnosticosMedidos(m, "/index.html", CASCARON);
    const js = diags.filter((d) => d.codigo === "js");
    expect(js.length).toBeGreaterThan(0);
    expect(js[0]).toMatchObject({ ruta: "/src/Roto.jsx", linea: 3 });
    expect(js.some((d) => d.ruta === "/index.html")).toBe(false);
  }, 90_000);
});

describe("el esqueleto con el que nace una app (H10)", () => {
  it("🔴 arranca en los ojos de Len sin un error: se ve su título", async () => {
    const e = esqueletoDeApp({ titulo: "Caja del Café", idioma: "es" });
    const v: ContextoDeVista = { ...vista(), files: e.ficheros, app: e.app, pantalla: null };
    const leer = `(async () => {
      for (let i = 0; i < 100; i++) { if (document.querySelector("h1")) break; await new Promise((r) => setTimeout(r, 20)); }
      return document.querySelector("h1")?.textContent ?? null;
    })()`;
    const m = await renderVisualQualityViewports(documentoMedible(e.html, v), {}, { behaviorProgram: leer, carpeta: carpetaDeLaVista(v)! });
    expect(m).not.toBeNull();
    expect(m!.runtimeErrors ?? []).toEqual([]);
    expect(m!.behaviorResult).toBe("Caja del Café");
  }, 90_000);
});

describe("esperar a la red (H12)", () => {
  /** Un doble con `goto` y `waitForNetworkIdle` que apunta lo que se le pide. */
  function pagina() {
    const pedidos: { goto: string[]; espera: { idleTime?: number; timeout?: number }[] } = { goto: [], espera: [] };
    return {
      pedidos,
      page: {
        setContent: async () => undefined,
        goto: async (url: string) => {
          pedidos.goto.push(url);
        },
        waitForNetworkIdle: async (o?: { idleTime?: number; timeout?: number }) => {
          pedidos.espera.push(o ?? {});
        },
      },
    };
  }

  it("una app espera a que la red se calme, con su tope, y abre su pantalla", async () => {
    const { page, pedidos } = pagina();
    await cargarEnOrigenReal(page, CASCARON, carpetaDeLaVista(vista("/ajustes"))!);
    expect(pedidos.goto[0]).toMatch(/\/#\/ajustes$/);
    expect(pedidos.espera).toEqual([{ idleTime: RED_CALMADA_MS, timeout: ESPERA_A_LA_RED_MS }]);
  });

  it("CONTRA-PRUEBA: una página no espera (se mide como siempre)", async () => {
    const { page, pedidos } = pagina();
    await cargarEnOrigenReal(page, "<p>hola</p>", carpetaDeLaVista({ ...vista(), app: null, files: { "/js/a.js": "1" } })!);
    expect(pedidos.goto[0]).toMatch(/\/$/);
    expect(pedidos.espera).toEqual([]);
  });

  it("si la red no se calma, se mide igual: la espera no lanza", async () => {
    const { page } = pagina();
    page.waitForNetworkIdle = async () => {
      throw new Error("Timed out after waiting 5000ms");
    };
    await expect(cargarEnOrigenReal(page, CASCARON, carpetaDeLaVista(vista())!)).resolves.toBeUndefined();
  });
});
