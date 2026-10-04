// @vitest-environment node
//
// EL CHROMIUM DEL SERVIDOR SALE A LA RED POR UN PROXY QUE FILTRA (2026-10-04).
//
// La guarda de `render-ssrf-guard.ts` intercepta las peticiones de UNA página.
// Tres puertas se le escapaban, y las dejó apuntadas el revisor de publicación:
// un WebSocket (la interceptación de Puppeteer no lo ve), el rebinding de DNS
// (Chromium resuelve por su cuenta, después de la guarda) y una ventana abierta
// con un clic DE VERDAD (otro target, sin interceptación). El proxy está por
// debajo de todas las pestañas: lo que no sale por él no sale.
//
// Montaje: un servidor «secreto» en 127.0.0.1 apunta cada visita (y cada
// intento de WebSocket). La página, servida desde un origen local REGISTRADO,
// intenta llegar a él sin la guarda instalada: así se mide sólo el proxy. El
// rebinding se prueba en `egress-proxy.test.ts`, con el DNS inyectado.
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { allowEgressOrigin, isolatedNetworkArgs } from "./egress-proxy";

let secreto: Server;
let paginas: Server;
let puertoSecreto = 0;
let origenPagina = "";
const visitas: string[] = [];
let soltarOrigen: () => void = () => {};

beforeAll(async () => {
  secreto = createServer((req, res) => {
    if (req.url !== "/favicon.ico") visitas.push(req.url ?? "");
    res.end("secreto");
  });
  secreto.on("upgrade", (req, socket) => {
    visitas.push(`ws ${req.url}`);
    socket.destroy();
  });
  await new Promise<void>((r) => secreto.listen(0, "127.0.0.1", () => r()));
  puertoSecreto = (secreto.address() as { port: number }).port;

  paginas = createServer((_req, res) => {
    const u = `http://127.0.0.1:${puertoSecreto}`;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><head><title>la página</title></head><body>
<a id="a" href="${u}/por-clic-real" target="_blank">abrir</a>
<script>
  try { new WebSocket("ws://127.0.0.1:${puertoSecreto}/por-websocket"); } catch (e) {}
  fetch("${u}/por-fetch", { mode: "no-cors" }).catch(function () {});
</script>
</body></html>`);
  });
  await new Promise<void>((r) => paginas.listen(0, "127.0.0.1", () => r()));
  origenPagina = `127.0.0.1:${(paginas.address() as { port: number }).port}`;
  soltarOrigen = allowEgressOrigin(origenPagina);
});

afterAll(() => {
  soltarOrigen();
  secreto.close();
  paginas.close();
});

async function visitar(conProxy: boolean): Promise<{ visitas: string[]; titulo: string }> {
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", ...(conProxy ? await isolatedNetworkArgs() : [])],
  });
  visitas.length = 0;
  try {
    const page = await browser.newPage();
    await page.goto(`http://${origenPagina}/`, { waitUntil: "load", timeout: 15_000 });
    const titulo = await page.title();
    // Un clic DE VERDAD (CDP Input): con gesto, el bloqueador de ventanas lo deja.
    await page.click("#a");
    await new Promise((r) => setTimeout(r, 1500));
    return { visitas: [...new Set(visitas)].sort(), titulo };
  } finally {
    await browser.close();
  }
}

describe("el proxy de salida del Chromium del servidor", () => {
  it("BRAZO DE CONTROL: sin el proxy, el WebSocket, el fetch y el clic real llegan al loopback", async () => {
    const r = await visitar(false);
    expect(r.visitas).toContain("ws /por-websocket");
    expect(r.visitas).toContain("/por-clic-real");
    expect(r.visitas).toContain("/por-fetch");
  }, 60_000);

  it("🔴 con el proxy no llega ninguna, y la página (de un origen registrado) sí carga", async () => {
    const r = await visitar(true);
    expect(r.titulo).toBe("la página");
    expect(r.visitas).toEqual([]);
  }, 60_000);
});
