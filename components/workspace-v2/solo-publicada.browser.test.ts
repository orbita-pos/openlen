// @vitest-environment node
//
// LO QUE SÓLO FUNCIONA PUBLICADO, DICHO. Spec 2026-09-15, tabla B.
//
// De navegador por fuerza: envolver fetch, parar un envío y la Navigation API
// sólo existen en Chromium de verdad. Montaje: el padre en `localhost`, la
// página en `127.0.0.1` (OTRO sitio, como openlen.com frente a lienzo-<id>),
// con el sandbox REMOTO real.
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SANDBOX_REMOTO } from "./sandbox-del-lienzo";
import { injectSoloPublicada } from "./solo-publicada";

const PAGINA = injectSoloPublicada(`<!doctype html><html><head><title>p</title></head><body>
<button id="datos" onclick="fetch('/api/d/mitienda/carrito').catch(function(){})">datos</button>
<button id="otra" onclick="fetch('/otra.json').catch(function(){})">otra</button>
<form id="nativo"><input name="x" value="1"><button id="enviar" type="submit">enviar</button></form>
<form id="conjs"><button id="enviarjs" type="submit">enviar js</button></form>
<button id="menu" onclick="location.href='/menu'">menu</button>
<button id="fuera" onclick="location.href='https://example.com/x'">fuera</button>
<script>
document.getElementById('conjs').addEventListener('submit', function (e) { e.preventDefault(); window.__enviadoJs = true; });
</script>
</body></html>`);

let server: Server;
let puerto = 0;
beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if ((req.url ?? "").startsWith("/doc")) return res.end(PAGINA);
    res.end(
      `<!doctype html><body><script>window.__msgs=[];addEventListener('message',function(e){__msgs.push(e.data)});</script>` +
        `<iframe id="lienzo" sandbox="${SANDBOX_REMOTO}" style="width:800px;height:600px" src="http://127.0.0.1:${(server.address() as { port: number }).port}/doc/"></iframe></body>`,
    );
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  puerto = (server.address() as { port: number }).port;
});
afterAll(() => server.close());

async function conLienzo(fn: (h: { pulsar: (sel: string) => Promise<void>; msgs: () => Promise<unknown[]>; url: () => Promise<string>; evalua: (js: string) => Promise<unknown> }) => Promise<void>) {
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${puerto}/`, { waitUntil: "load", timeout: 20_000 });
    const marco = async () => (await (await page.$("#lienzo"))!.contentFrame())!;
    await (await marco()).waitForSelector("#datos");
    // ⚠️ CALENTAR EL ENRUTADO DE ENTRADA, Y NO ES CEREMONIA.
    //
    // El PRIMER clic después de cargar SE PIERDE mientras Chromium termina de
    // montar el proceso aparte de este iframe — es de otro sitio a propósito
    // (127.0.0.1 frente a localhost), que es justo lo que la prueba quiere
    // medir. Medido el 2026-09-15: de seis clics seguidos, el primero era el
    // ÚNICO que no llegaba nunca al documento, y los cinco siguientes sí.
    //
    // No es del producto: con el clic perdido, una llamada a `fetch` hecha a
    // mano en ese mismo marco SÍ avisa. Es del montaje. Por eso no se espera
    // un tiempo a ojo: se pulsa un punto vacío hasta que un clic de verdad
    // llega al documento, y sólo entonces empieza la prueba.
    await (await marco()).evaluate(
      "window.__olEntrada = 0; document.addEventListener('click', function () { window.__olEntrada = 1; }, true);",
    );
    for (let i = 0; i < 50; i++) {
      if (await (await marco()).evaluate("window.__olEntrada === 1")) break;
      await page.mouse.click(408, 408); // (400,400) dentro del marco: cuerpo vacío
      await new Promise((r) => setTimeout(r, 100));
    }
    await fn({
      pulsar: async (sel) => { await (await marco()).click(sel); await new Promise((r) => setTimeout(r, 400)); },
      msgs: async () => (await page.evaluate("window.__msgs")) as unknown[],
      url: async () => (await marco()).url(),
      evalua: async (js) => (await marco()).evaluate(js),
    });
  } finally {
    await browser.close();
  }
}

const deTipo = (msgs: unknown[], type: string) => msgs.filter((m) => (m as { type?: string })?.type === type);

describe("lo que sólo funciona publicado se dice", () => {
  it("🔴 una llamada a /api/d avisa con su ruta; otra ruta no", async () => {
    await conLienzo(async (h) => {
      await h.pulsar("#datos");
      await h.pulsar("#otra");
      const avisos = deTipo(await h.msgs(), "openlen:solo-publicada");
      expect(avisos).toEqual([{ type: "openlen:solo-publicada", tipo: "llamada", ruta: "/api/d/mitienda/carrito" }]);
    });
  }, 60_000);

  it("🔴 un envío nativo se PARA y avisa; el documento no se va", async () => {
    await conLienzo(async (h) => {
      const antes = await h.url();
      await h.pulsar("#enviar");
      expect(deTipo(await h.msgs(), "openlen:solo-publicada")).toEqual([{ type: "openlen:solo-publicada", tipo: "formulario" }]);
      expect(await h.url()).toBe(antes);
    });
  }, 60_000);

  it("CONTRA-PRUEBA: un formulario con su propio JavaScript NO se toca", async () => {
    await conLienzo(async (h) => {
      await h.pulsar("#enviarjs");
      expect(await h.evalua("window.__enviadoJs === true")).toBe(true);
      expect(deTipo(await h.msgs(), "openlen:solo-publicada")).toEqual([]);
    });
  }, 60_000);

  it("🔴 M5: location.href a una ruta de un tramo cambia de página por el padre, y no navega", async () => {
    await conLienzo(async (h) => {
      const antes = await h.url();
      await h.pulsar("#menu");
      const ir = deTipo(await h.msgs(), "openlen:ir-a-pagina");
      expect(ir).toHaveLength(1);
      expect(ir[0]).toMatchObject({ slug: "menu", ancla: "" });
      expect(await h.url()).toBe(antes);
    });
  }, 60_000);

  it("🔴 M5: location.href fuera avisa con el destino, y no navega", async () => {
    await conLienzo(async (h) => {
      const antes = await h.url();
      await h.pulsar("#fuera");
      const avisos = deTipo(await h.msgs(), "openlen:solo-publicada");
      expect(avisos).toEqual([{ type: "openlen:solo-publicada", tipo: "navegacion", destino: "https://example.com/x" }]);
      expect(await h.url()).toBe(antes);
    });
  }, 60_000);
});
