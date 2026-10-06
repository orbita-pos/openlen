// @vitest-environment node
//
// EL LIENZO SIRVE EL SITIO ENTERO (pieza 9 de Len 2.5), en un Chromium de
// verdad: la página de `/menu/` carga su JavaScript por las tres formas que
// usa la publicada —desde la raíz, `../` y relativo a su carpeta— y pide un
// JSON con `fetch`. Todo lo contesta la ruta del sitio del lienzo en su host
// `lienzo-<etiqueta>.localhost`, con la URL que da `urlDelDocumento`.
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.AUTH_SECRET ||= "prueba-del-lienzo";
});
const carpeta = vi.hoisted(() => ({ files: {} as Record<string, string> }));
vi.mock("@/lib/backend/files", () => ({
  listProjectFiles: async (_projectId: string, prefix = "/") =>
    Object.fromEntries(Object.entries(carpeta.files).filter(([p]) => p.startsWith(prefix))),
}));

import { GET } from "@/app/api/lienzo/site/[[...path]]/route";
import { guardarDocumento, vaciarAlmacenParaPruebas } from "@/lib/lienzo/almacen";
import { urlDelDocumento } from "@/lib/lienzo/host";
import { resolveRewrites } from "@/lib/lienzo/resolve-rewrites";
import { LIENZO_REWRITES } from "@/lib/lienzo/site-rewrite";

const ID = "4f9c10cb-8781-48f1-b291-c5d146579f09";
const MENU = `<!doctype html><html><head><meta charset="utf-8"><title>antes</title></head><body>
<p id="raiz">-</p><p id="arriba">-</p><p id="aqui">-</p><p id="datos">-</p>
<script src="/js/raiz.js"></script>
<script src="../js/arriba.js"></script>
<script src="aqui.js"></script>
<script>fetch("/data/menu.json").then(function (r) { return r.json(); }).then(function (d) { document.getElementById("datos").textContent = d.length + " platos"; });</script>
</body></html>`;

let server: Server;
let puerto = 0;

beforeAll(async () => {
  // El servidor hace lo que harían Caddy (`@lienzo`) y las `rewrites` de
  // next.config, con el código del router de Next: en un host lienzo, toda
  // ruta va a la del sitio.
  server = createServer(async (req, res) => {
    const host = req.headers.host ?? "";
    const url = new URL(req.url ?? "/", `http://${host}`);
    const destino = resolveRewrites(LIENZO_REWRITES, host, url.pathname).pathname;
    if (!destino.startsWith("/api/lienzo/site")) {
      res.writeHead(404).end();
      return;
    }
    const path = destino.replace(/^\/api\/lienzo\/site/, "").split("/").filter(Boolean);
    const r = await GET(new Request(url, { headers: { host } }), { params: Promise.resolve({ path }) });
    res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
    res.end(await r.text());
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  puerto = (server.address() as { port: number }).port;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

async function abrirElMenu(files: Record<string, string>) {
  vaciarAlmacenParaPruebas();
  carpeta.files = files;
  const docId = guardarDocumento({ html: MENU, projectId: ID, userId: "u1", pagina: "menu" });
  const url = urlDelDocumento(
    { projectId: ID, docId, pagina: "menu", hostDeLaPeticion: `localhost:${puerto}` },
    { ...process.env, NODE_ENV: "development" },
  )!;
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "load", timeout: 20_000 });
    await page.waitForFunction(() => document.getElementById("datos")?.textContent !== "-", { timeout: 3000 }).catch(() => undefined);
    return await page.evaluate(() => ({
      ruta: location.pathname,
      raiz: document.getElementById("raiz")!.textContent,
      arriba: document.getElementById("arriba")!.textContent,
      aqui: document.getElementById("aqui")!.textContent,
      datos: document.getElementById("datos")!.textContent,
    }));
  } finally {
    await browser.close();
  }
}

describe("🔴 el lienzo sirve la página en su ruta y los ficheros de la carpeta", () => {
  it("las tres formas de enlazar un script y el fetch llegan, como en la publicada", async () => {
    const r = await abrirElMenu({
      "/js/raiz.js": 'document.getElementById("raiz").textContent = "raíz";',
      "/js/arriba.js": 'document.getElementById("arriba").textContent = "arriba";',
      "/menu/aqui.js": 'document.getElementById("aqui").textContent = "aquí";',
      "/data/menu.json": "[1,2,3]",
    });
    expect(r).toEqual({ ruta: "/menu/index.html", raiz: "raíz", arriba: "arriba", aqui: "aquí", datos: "3 platos" });
  }, 60_000);

  it("BRAZO DE CONTROL: sin la carpeta, la misma página se queda como estaba", async () => {
    const r = await abrirElMenu({});
    expect(r).toEqual({ ruta: "/menu/index.html", raiz: "-", arriba: "-", aqui: "-", datos: "-" });
  }, 60_000);
});
