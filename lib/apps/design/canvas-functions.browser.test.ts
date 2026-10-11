// @vitest-environment node
// LA CADENA DE UN ELEMENTO, con el compilador, el empaquetador y React de
// verdad en Chromium: de lo pulsado a la línea que lo pinta.
import { createServer } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { bundleApp, stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";
import { FICHEROS } from "@/lib/apps/shadcn-fixture";
import { entradaServida } from "@/lib/apps/servir";
import { decl } from "@/components/workspace-v2/serializar-al-iframe";
import { ownTextOf, primaryOf, sourceChainOf, targetsOf } from "./canvas-functions";

afterAll(() => stopBundlerWorker());

const APP = { catalogo: "2026-11", entrada: "/src/main.jsx" } as const;
const SHELL = '<!doctype html><html><head><title>app</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>';
const FUNCIONES = [decl("sourceChainOf", sourceChainOf), decl("primaryOf", primaryOf), decl("ownTextOf", ownTextOf), decl("targetsOf", targetsOf)].join("\n");

async function abrir(carpeta: Record<string, string>) {
  const entrada = entradaServida(APP.entrada, await bundleApp({ carpeta, app: APP, modo: "desarrollo" }), carpeta);
  const srv = createServer((req, res) => {
    const js = req.url === APP.entrada;
    res.writeHead(js || req.url === "/" ? 200 : 404, { "content-type": js ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8" });
    res.end(js ? entrada : req.url === "/" ? SHELL : "");
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const dir = srv.address();
  if (dir === null || typeof dir === "string") throw new Error("sin puerto");
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${dir.port}/`, { waitUntil: "load", timeout: 20_000 });
  await page.waitForSelector("#root *", { timeout: 20_000 });
  await page.addScriptTag({ content: FUNCIONES });
  return {
    page,
    cerrar: async () => {
      await browser.close();
      srv.close();
    },
  };
}

describe("la cadena de un elemento en el lienzo", () => {
  it("🔴 un <Button> de shadcn: escrito en ui/button.tsx:9, usado en App.tsx:16 —el uso es el principal—", async () => {
    const v = await abrir(FICHEROS);
    try {
      const r = await v.page.evaluate(() => {
        const w = window as unknown as {
          sourceChainOf: (n: Element, m: number) => { path: string; line: number }[];
          primaryOf: (c: { path: string }[]) => number;
        };
        const chain = w.sourceChainOf(document.querySelector('[data-prueba="boton"]')!, 6);
        return { chain: chain.map((c) => `${c.path}:${c.line}`), primary: w.primaryOf(chain) };
      });
      expect(r.chain.slice(0, 2)).toEqual(["/src/components/ui/button.tsx:9", "/src/App.tsx:16"]);
      expect(r.primary).toBe(1);
    } finally {
      await v.cerrar();
    }
  }, 90_000);

  it("un elemento de una lista: sus copias salen de la misma línea", async () => {
    const carpeta = {
      ...FICHEROS,
      "/src/App.tsx": 'export default function App() {\n  return (\n    <ul>\n      {["a", "b", "c"].map((x) => <li key={x}>{x}</li>)}\n    </ul>\n  );\n}\n',
    };
    const v = await abrir(carpeta);
    try {
      const n = await v.page.evaluate(
        () => (window as unknown as { targetsOf: (p: string, l: number, t: string, m: number) => Element[] }).targetsOf("/src/App.tsx", 4, "li", 6).length,
      );
      expect(n).toBe(3);
    } finally {
      await v.cerrar();
    }
  }, 90_000);
});
