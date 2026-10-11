// @vitest-environment node
// LA CAPA DE ERROR DEL LIENZO, COMO LA DE VITE (Jesús, 10/10).
//
// Paraste a Len entre dos ediciones —abrió `<Paralaje>` en una y lo iba a
// cerrar en la siguiente— y la app dejó de compilar: el lienzo servía un módulo
// que lanzaba el error en la consola y tú veías la pantalla en blanco, sin una
// palabra. Vite, en el mismo caso, pinta encima su capa con el mensaje, el
// fichero y la línea, y el trozo de código. Aquí, igual: la app rota pasa por el
// compilador y el empaquetador DE VERDAD y se abre en un Chromium.
import { createServer } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { stopBundlerWorker, bundleApp } from "./bundler/bundle-app";
import { compilarCarpeta } from "./compilador";
import { esqueletoDeApp } from "./esqueleto";
import { entradaServida } from "./servir";

afterAll(() => stopBundlerWorker());

const ESQ = esqueletoDeApp({ titulo: "Caja" });
const APP = ESQ.app;
const SANA = ESQ.ficheros;
// La línea 5 cierra el return sin cerrar el <main>: el compilador no lo acepta.
const ROTA = { ...SANA, "/src/screens/Inicio.tsx": "export default function Inicio() {\n  return (\n    <main>\n      <h1>Hola</h1>\n  );\n}\n" };
const CASCARON = '<!doctype html><html><head><title>app</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';

async function abrir(carpeta: Record<string, string>) {
  const entrada = entradaServida(APP.entrada, await bundleApp({ carpeta, app: APP, modo: "desarrollo" }), carpeta);
  const srv = createServer((req, res) => {
    const js = req.url === APP.entrada;
    res.writeHead(200, { "content-type": js ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8" });
    res.end(js ? entrada : CASCARON);
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const dir = srv.address();
  if (dir === null || typeof dir === "string") throw new Error("sin puerto");
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  await page.goto(`http://127.0.0.1:${dir.port}/#/`, { waitUntil: "load", timeout: 20_000 });
  await new Promise((r) => setTimeout(r, 300));
  const capa = () =>
    page.evaluate(() => {
      const host = document.querySelector("openlen-error-overlay");
      if (!host || !host.shadowRoot) return null;
      const caja = host.getBoundingClientRect();
      return { texto: host.shadowRoot.textContent ?? "", visible: caja.width > 0 && caja.height > 0 };
    });
  return {
    page,
    errores,
    capa,
    cerrar: async () => {
      await browser.close();
      srv.close();
    },
  };
}

describe("una app que no compila, en el lienzo", () => {
  it("🔴 pinta encima la capa de error: el mensaje, fichero:línea:columna y el trozo de código; y el error sigue en la consola", async () => {
    const v = await abrir(ROTA);
    try {
      const capa = await v.capa();
      expect(capa, "no hay capa: el lienzo se queda en blanco").not.toBeNull();
      expect(capa!.visible).toBe(true);
      // El sitio, el que da el compilador de verdad.
      const [d] = compilarCarpeta({ carpeta: ROTA, catalogo: APP.catalogo }).errores;
      expect(capa!.texto).toContain(d!.mensaje);
      expect(capa!.texto).toContain(`${d!.ruta}:${d!.linea}:${d!.columna}`);
      expect(capa!.texto, "falta el trozo de código con la línea marcada").toMatch(new RegExp(`> ${d!.linea} \\|`));
      expect(v.errores.join("\n"), "el error dejó de lanzarse: los ojos de Len no lo verían").toContain("OpenLen could not compile");
    } finally {
      await v.cerrar();
    }
  }, 90_000);

  it("se cierra con Esc, como la de Vite", async () => {
    const v = await abrir(ROTA);
    try {
      expect(await v.capa()).not.toBeNull();
      await v.page.keyboard.press("Escape");
      expect(await v.capa()).toBeNull();
    } finally {
      await v.cerrar();
    }
  }, 90_000);

  it("BRAZO DE CONTROL: una app que compila no tiene capa", async () => {
    const v = await abrir({ ...SANA });
    try {
      expect(await v.capa()).toBeNull();
      expect(v.errores).toEqual([]);
    } finally {
      await v.cerrar();
    }
  }, 90_000);
});
