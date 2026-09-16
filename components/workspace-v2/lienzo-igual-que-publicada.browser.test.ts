// @vitest-environment node
//
// LA MISMA PÁGINA EN TRES CONTENEDORES, Y QUÉ PUEDE HACER EN CADA UNO.
//
// Es la sonda del 2026-09-15 (INFORME-un-solo-camino-de-renderizado.md)
// convertida en guarda. Regla de esa sesión: el montaje ejecuta el código REAL.
//   · publicada → top-level, con las cabeceras del bloque *.openlen.app del Caddyfile
//   · remoto    → iframe con SANDBOX_REMOTO/ALLOW_REMOTO, src servido por el GET real
//                 en lienzo-<id>.localhost, y el padre en localhost (OTRO sitio)
//   · local     → iframe srcdoc con SANDBOX_LOCAL, la reserva
//
// QUÉ CUBRE ESTA MATRIZ, Y QUÉ NO. Se enumera, no se afirma que todo va bien —
// es como lo dice Claude Code en su informe de `preview`: «they cover overflow,
// clipping, theme-only color variables, blocked and local-only loads, diagram
// and console errors — NOT whether the page looks right», y su propia
// descripción declara sus límites por delante («the page's requests are refused
// except Google Fonts; pop-ups and WebRTC disabled»). Nunca dice «igual que
// publicada» a secas. Aquí igual:
//
//   CUBRE  diez capacidades iguales (origen real, localStorage, sessionStorage,
//          indexedDB, serviceWorker, prompt, confirm, window.open, ancla y
//          envío de formulario), y la cookie como DIFERENCIA fijada.
//   NO CUBRE  portapapeles ni pantalla completa (headless no los distingue: M7,
//          a mano), ni si la página se VE bien, ni el viaje por Cloudflare.
//
// Y el BRAZO DE CONTROL: local tiene que SEGUIR distinta en almacenamiento y
// formularios. Si no, la sonda no discrimina y todo lo demás pasaría en verde
// sin medir nada.
//
// ⚰️ M6 SE MIDIÓ Y NO DISCRIMINA — por eso aquí no hay prueba de M6.
// La pregunta era si `allow-popups-to-escape-sandbox` cambia algo en la ventana
// que abre el lienzo. Medido el 2026-09-15 con DOS sondas independientes, con y
// sin la bandera: (1) la consola de la ventana nueva no protesta por el sandbox
// al ir a `mailto:` en NINGUNO de los dos casos; (2) la ventana nueva sale con
// el MISMO origen real y `isSecureContext: true` en los dos. Con
// `allow-same-origin` puesto, el `about:blank` que abre hereda ya un origen de
// verdad, así que la bandera no añade nada observable. Se mantiene igualmente
// —la publicada abre ventanas normales y la bandera no afloja nada—, pero no se
// deja una prueba que pasaría con y sin ella.
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/lienzo/[docId]/route";
import { guardarDocumento, vaciarAlmacenParaPruebas } from "@/lib/lienzo/almacen";
import { etiquetaDeLienzo } from "@/lib/lienzo/host";
import { ALLOW_REMOTO, SANDBOX_LOCAL, SANDBOX_REMOTO } from "./sandbox-del-lienzo";

const ID = "4f9c10cb-8781-48f1-b291-c5d146579f09";
const RAIZ = join(import.meta.dirname, "..", "..");

const caddy = readFileSync(join(RAIZ, "infra", "caddy", "Caddyfile"), "utf8");
const bloqueApp = caddy.slice(caddy.indexOf("\n*.openlen.app {"));
const CABECERAS_PUBLICADA: Record<string, string> = {};
for (const m of /header \{([\s\S]*?)\n\t\}/.exec(bloqueApp)![1]!.matchAll(/^\s*([A-Za-z-]+) "([^"]*)"/gm)) {
  CABECERAS_PUBLICADA[m[1]!] = m[2]!;
}

const SONDA = `<!doctype html><html><head><meta charset="utf-8"><title>sonda</title></head>
<body style="margin:0;font:16px system-ui">
<button id="go" type="button">con gesto</button>
<a id="ancla" href="#destino">ancla</a>
<form id="f" method="get"><input name="x" value="1"></form>
<div id="destino" style="margin-top:3000px">destino</div>
<script>
(function(){
  var R = window.__caps = {};
  function t(k, fn){ try { var v = fn(); if (v && typeof v.then === 'function') v.then(function(x){ R[k] = 'ok:' + x; }, function(e){ R[k] = 'falla:' + (e && e.name || e); }); else R[k] = 'ok:' + v; } catch (e) { R[k] = 'lanza:' + (e && e.name || e); } }
  t('origen_real', function(){ return window.origin !== 'null'; });
  t('localStorage', function(){ localStorage.setItem('k','v'); return localStorage.getItem('k'); });
  t('sessionStorage', function(){ sessionStorage.setItem('k','v'); return sessionStorage.getItem('k'); });
  t('cookie', function(){ document.cookie = 'k=v'; return /k=v/.test(document.cookie); });
  t('indexedDB', function(){ return new Promise(function(res, rej){ var r = indexedDB.open('sonda'); r.onsuccess = function(){ res('abre'); }; r.onerror = function(){ rej(r.error); }; }); });
  t('serviceWorker', function(){ return navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(function(){ return 'api'; }) : Promise.reject({ name: 'sin_api' }); });
  document.getElementById('go').addEventListener('click', function(){
    t('prompt', function(){ return JSON.stringify(prompt('nombre?')); });
    t('confirm', function(){ return confirm('seguro?'); });
    t('window_open', function(){ var w = window.open('about:blank', '_blank'); var r = w ? 'ventana' : 'null'; try { w && w.close(); } catch (e) {} return r; });
  });
})();
</script></body></html>`;

const HEX_HOST = `${etiquetaDeLienzo(ID)}.localhost`;
let server: Server;
let puerto = 0;
let docId = "";

async function alGet(req: IncomingMessage): Promise<Response> {
  const host = req.headers.host ?? "";
  const id = decodeURIComponent((req.url ?? "").split("?")[0]!.replace(/^\/api\/lienzo\//, ""));
  return GET(new Request(`http://${host}${req.url}`, { headers: { host } }), { params: Promise.resolve({ docId: id }) });
}

beforeAll(async () => {
  vaciarAlmacenParaPruebas();
  docId = guardarDocumento({ html: SONDA, projectId: ID, userId: "u1", pagina: null });
  server = createServer(async (req, res) => {
    const ruta = (req.url ?? "").split("?")[0]!;
    if (ruta.startsWith("/api/lienzo/")) {
      const r = await alGet(req);
      res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
      return res.end(await r.text());
    }
    if (ruta === "/pub/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...CABECERAS_PUBLICADA });
      return res.end(SONDA);
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (ruta === "/taller-remoto/") {
      return res.end(
        `<!doctype html><body style="margin:0"><iframe id="lienzo" sandbox="${SANDBOX_REMOTO}" allow="${ALLOW_REMOTO}" style="width:1280px;height:800px;border:0" src="http://${HEX_HOST}:${puerto}/api/lienzo/${encodeURIComponent(docId)}"></iframe></body>`,
      );
    }
    if (ruta === "/taller-local/") {
      const srcdoc = SONDA.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      return res.end(
        `<!doctype html><body style="margin:0"><iframe id="lienzo" sandbox="${SANDBOX_LOCAL}" style="width:1280px;height:800px;border:0" srcdoc="${srcdoc}"></iframe></body>`,
      );
    }
    res.end("");
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  puerto = (server.address() as { port: number }).port;
});
afterAll(() => server.close());

type Fila = Record<string, string>;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function medir(url: string, marco: "principal" | "hijo"): Promise<Fila> {
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage();
    page.on("dialog", (d) => void d.accept(d.type() === "prompt" ? "Ana" : undefined));
    await page.setViewport({ width: 1280, height: 800 });
    const frame = async () => (marco === "principal" ? page.mainFrame() : (await (await page.$("#lienzo"))!.contentFrame())!);
    await page.goto(url, { waitUntil: "load", timeout: 20_000 });
    await (await frame()).waitForSelector("#go", { timeout: 20_000 });
    await esperar(1_000);
    await (await frame()).click("#go");
    await esperar(1_500);
    const fila = { ...((await (await frame()).evaluate("window.__caps")) as Fila) };

    await (await frame()).click("#ancla");
    await esperar(600);
    fila.ancla_desplaza = String(((await (await frame()).evaluate("scrollY")) as number) > 0);

    const antes = (await frame()).url();
    await (await frame()).evaluate("document.getElementById('f').requestSubmit()").catch(() => {});
    await esperar(1_200);
    fila.formulario_envia = String((await frame()).url() !== antes);
    return fila;
  } finally {
    await browser.close();
  }
}

// LO QUE ESTA MATRIZ CUBRE, dicho como lo dice Claude Code en su informe de
// `preview` («they cover … — not whether the page looks right»): se enumera el
// alcance en vez de afirmar que todo va bien. Aquí son estas diez capacidades,
// y la cookie va aparte porque NO es igual y se fija abajo tal cual sale.
const IGUALES = [
  "origen_real", "localStorage", "sessionStorage", "indexedDB", "serviceWorker",
  "prompt", "confirm", "window_open", "ancla_desplaza", "formulario_envia",
] as const;

describe("el lienzo remoto da lo mismo que la publicada", () => {
  let publicada: Fila;
  let remoto: Fila;
  let local: Fila;

  beforeAll(async () => {
    publicada = await medir(`http://127.0.0.1:${puerto}/pub/`, "principal");
    remoto = await medir(`http://localhost:${puerto}/taller-remoto/`, "hijo");
    local = await medir(`http://localhost:${puerto}/taller-local/`, "hijo");
  }, 180_000);

  it("🔴 cada capacidad medida: remoto = publicada", () => {
    const distintas = IGUALES.filter((k) => remoto[k] !== publicada[k]).map(
      (k) => `${k}: publicada=${publicada[k]} remoto=${remoto[k]}`,
    );
    expect(distintas, "el lienzo remoto no replica la publicada").toEqual([]);
  });

  it("🔴 LA COOKIE NO ES IGUAL, y se fija aquí en vez de esconderse", () => {
    // MEDIDO el 2026-09-15, y no es del montaje ni del sandbox: un iframe del
    // MISMO sitio con este mismo SANDBOX_REMOTO sí pone la cookie. Lo que la
    // impide es ser de OTRO sitio, que es justo lo que este diseño busca. Una
    // cookie sin atributos nace `SameSite=Lax`, y eso un marco de otro sitio no
    // lo puede poner; `SameSite=None` exigiría `Secure`. Desactivar el fin de
    // las cookies de terceros de Chrome NO lo cambia (probado).
    //
    // En producción pasa igual: el taller es openlen.com y el lienzo
    // lienzo-<id>.openlen.app — sitios distintos.
    //
    // NO es una regresión: la reserva `srcdoc` tampoco puede (origen opaco), así
    // que el lienzo remoto sigue siendo estrictamente mejor que lo que había.
    // Se deja MEDIDA y clavada: si algún día cambia, esta prueba se entera.
    // Y las tres son DISTINTAS entre sí, que es lo que hace útil la fila:
    //   publicada  la pone.
    //   remoto     deja intentarlo y NO la guarda (otro sitio).
    //   local      ni siquiera deja intentarlo: LANZA, porque el origen es opaco.
    expect(publicada.cookie).toBe("ok:true");
    expect(remoto.cookie).toBe("ok:false");
    expect(local.cookie).toMatch(/^lanza:SecurityError/);
  });

  it("BRAZO DE CONTROL: la reserva local SIGUE distinta en almacenamiento y formularios", () => {
    expect(local.localStorage).toMatch(/^lanza:SecurityError/);
    expect(publicada.localStorage).toBe("ok:v");
    expect(local.formulario_envia).toBe("false");
    expect(publicada.formulario_envia).toBe("true");
  });
});
