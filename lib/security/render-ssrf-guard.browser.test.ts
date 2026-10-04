// @vitest-environment node
//
// LAS VENTANAS NUEVAS NO SALEN (2026-10-04).
//
// La guarda intercepta las peticiones de LA página guardada; una ventana que
// esa página abre es otro target, sin interceptación, con la red del servidor
// entera: SSRF al loopback (el Next de :3000) o a los metadatos de la nube. El
// transformador de ingestión lo cerraba en su propio navegador; al retirarlo,
// el JavaScript pegado pasó a correr en la miniatura y en las comprobaciones
// de publicar, que sólo tenían esta guarda. Lo encontró el revisor de
// publicación.
//
// Montaje: un servidor en 127.0.0.1 apunta cada visita. La página intenta
// llegar a él por todas las puertas que un script tiene al cargar.
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installSubresourceSsrfGuard, SIN_VENTANAS_NUEVAS } from "./render-ssrf-guard";

let server: Server;
let puerto = 0;
const visitas: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url !== "/favicon.ico") visitas.push(req.url ?? "");
    res.end("secreto");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  puerto = (server.address() as { port: number }).port;
});
afterAll(() => server.close());

function pagina(): string {
  const u = `http://127.0.0.1:${puerto}`;
  return `<!doctype html><html><body>
<a id="a" href="${u}/por-enlace" target="_blank">x</a>
<a id="d" href="${u}/por-dispatch" target="_blank">y</a>
<form id="f" action="${u}/por-submit" target="_blank" method="post"><input name="q" value="1"><button id="b">ir</button></form>
<form id="r" action="${u}/por-requestsubmit" target="_blank"></form>
<script>
  window.open("${u}/por-window-open");
  document.getElementById("a").click();
  document.getElementById("d").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  document.getElementById("f").submit();
  document.getElementById("r").requestSubmit();
  var fr = document.createElement("iframe"); document.body.appendChild(fr);
  try { fr.contentWindow.open("${u}/por-iframe"); } catch (e) {}
  setTimeout(function () { window.open("${u}/por-diferido"); document.getElementById("b").click(); }, 300);
</script>
</body></html>`;
}

async function abrir(conGuarda: boolean): Promise<string[]> {
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    ...(conGuarda ? SIN_VENTANAS_NUEVAS : {}),
  });
  visitas.length = 0;
  try {
    const page = await browser.newPage();
    if (conGuarda) await installSubresourceSsrfGuard(page);
    await page.setContent(pagina(), { waitUntil: "load", timeout: 15_000 });
    await new Promise((r) => setTimeout(r, 1800));
    return [...new Set(visitas)].sort();
  } finally {
    await browser.close();
  }
}

describe("installSubresourceSsrfGuard — las ventanas que abre la página", () => {
  it("BRAZO DE CONTROL: sin la guarda, llegan al loopback", async () => {
    const v = await abrir(false);
    expect(v).toContain("/por-window-open");
    expect(v).toContain("/por-enlace");
    expect(v).toContain("/por-submit");
  }, 60_000);

  it("🔴 con la guarda (y el launch como en producción), ninguna llega", async () => {
    expect(await abrir(true)).toEqual([]);
  }, 60_000);
});
