// El JavaScript del modelo, publicado de verdad y abierto en Chromium.
//
// Todo lo anterior se puede comprobar leyendo cadenas. Esto no: que el script
// entre en el release, que la CSP lo autorice POR HASH y que el navegador
// además le siga negando la salida a la red sólo se ve ejecutándolo.
//
// Run: npx tsx --test lib/publish/model-runtime-publish.test.ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import puppeteer from "puppeteer";

process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
process.env.OPENLEN_LOCALIZE = "0";

const root = mkdtempSync(path.join(tmpdir(), "olrt-"));
process.env.PUBLISH_ROOT = root;

import { publishToDir } from "./filesystem";

/** Cuenta clics y, de paso, intenta llamar a casa. Las dos mitades importan. */
const CODIGO = `
document.getElementById("b").addEventListener("click", function () {
  var n = document.getElementById("n");
  n.textContent = String(Number(n.textContent) + 1);
});
window.__fuga = "sin intentar";
fetch("https://ladron.test/x").then(function () { window.__fuga = "PASÓ"; })
  .catch(function () { window.__fuga = "bloqueado"; });
`.trim();

const DOC = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>contador</title></head>
<body><h1>Contador</h1><button id="b">sumar</button><span id="n">0</span></body></html>`;

describe("una página publicada CON runtime del modelo", () => {
  let sha = "";
  let servidor: Server;
  let puerto = 0;

  before(async () => {
    const r = await publishToDir({ subdomain: "conjs", html: DOC, modelRuntime: CODIGO });
    sha = r.sha;
    assert.deepEqual(r.unsealed, [], "tuvo que sellarse: sin CSP esto no se publica");
    const file = path.join(root, "conjs", "releases", sha, "index.html");
    const html = readFileSync(file, "utf8");
    servidor = createServer((_q, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    });
    await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
    puerto = (servidor.address() as { port: number }).port;
  });

  after(() => {
    servidor.close();
    rmSync(root, { recursive: true, force: true });
  });

  const doc = () => readFileSync(path.join(root, "conjs", "releases", sha, "index.html"), "utf8");

  it("el código entra en el release", () => {
    assert.ok(doc().includes(`document.getElementById("b")`));
  });

  // El marcador no viaja: en el documento servido no autoriza nada —la autoridad
  // la dio la cápsula y la CSP la fija por hash— y dejarlo sólo serviría para
  // que alguien lo copiara creyendo que significa algo.
  it("pero el marcador NO viaja", () => {
    assert.ok(!doc().includes("data-openlen-model-runtime"));
  });

  it("la CSP lo autoriza por hash, no aflojando script-src", () => {
    // SÓLO la directiva script-src, hasta su ";". El regex anterior capturaba la
    // política ENTERA, así que empezó a fallar cuando style-src ganó su
    // 'unsafe-inline' —que ahí es legítimo, porque el estilo en línea sostiene
    // todas las páginas—. La aserción era correcta; la extracción, no.
    const csp = /content="([^"]*)"/.exec(doc())?.[1] ?? "";
    const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1] ?? "";
    assert.match(scriptSrc, /'sha256-/);
    assert.ok(!scriptSrc.includes("'unsafe-inline'"), "unsafe-inline en script-src sería rendirse");
    assert.ok(csp.includes("img-src"), "la política tiene que cerrar también las imágenes");
  });

  it("CORRE en el navegador y el contador cuenta", async () => {
    const nav = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      const page = await nav.newPage();
      await page.goto(`http://127.0.0.1:${puerto}/`, { waitUntil: "networkidle0", timeout: 30_000 });
      await page.click("#b");
      await page.click("#b");
      assert.equal(await page.evaluate(`document.getElementById("n").textContent`), "2");
    } finally {
      await nav.close();
    }
  });

  // ── LA RED, y qué cambió el 2026-08-24 ──────────────────────────────────
  //
  // Esta prueba EXIGÍA que el script del modelo no pudiera salir a la red, y
  // pasaba: la CSP lo bloqueaba de verdad, comprobado con un evento de
  // violación en Chrome. Jesús decidió abrirlo a sabiendas, dos veces avisado,
  // y el razonamiento está en `pageNetworkExtra`: lo hace cualquier hosting que
  // sirva páginas de usuario, y aquí además el script va fijado por hash y el
  // creador puede leerlo desde el visor `</>`.
  //
  // Así que ahora se comprueban LOS DOS ESTADOS en el navegador, no uno:
  // que abierto sale, y que el kill-switch vuelve a bloquear de verdad. Sin la
  // segunda mitad, `OPENLEN_PAGE_NETWORK=0` sería una promesa sin prueba — y
  // ese interruptor existe para un incidente, que es cuando menos margen hay
  // para descubrir que no funcionaba.
  const violacionesAlCargar = async (url: string): Promise<string[]> => {
    const nav = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      const page = await nav.newPage();
      await page.evaluateOnNewDocument(`
        window.__v = [];
        document.addEventListener("securitypolicyviolation", function (e) {
          window.__v.push(e.effectiveDirective);
        });
      `);
      await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });
      await new Promise((ok) => setTimeout(ok, 600));
      return (await page.evaluate(`window.__v`)) as string[];
    } finally {
      await nav.close();
    }
  };

  it("sale a la red: la CSP ya no la bloquea", async () => {
    const v = await violacionesAlCargar(`http://127.0.0.1:${puerto}/`);
    assert.ok(!v.includes("connect-src"), `no debería haber bloqueo de red: ${v}`);
  });

  it("pero sus formularios siguen yendo SÓLO a OpenLen", async () => {
    // Lo que NO se abrió, y es la promesa que le queda al visitante.
    const csp = /content="([^"]*)"/.exec(doc())?.[1] ?? "";
    const formAction = /form-action ([^;"]*)/.exec(csp)?.[1] ?? "";
    assert.ok(formAction.length > 0, csp);
    // OJO: `https://openlen.com` CONTIENE la cadena "https:". Lo que no puede
    // aparecer es el ESQUEMA suelto —`https:` sin `//`—, que es el comodín.
    assert.ok(
      !/(^|\s)https:(?!\/\/)/.test(formAction),
      `form-action se abrió sin querer: ${formAction}`,
    );
  });

  it("y con OPENLEN_PAGE_NETWORK=0 el navegador vuelve a bloquearla", async () => {
    const previo = process.env.OPENLEN_PAGE_NETWORK;
    process.env.OPENLEN_PAGE_NETWORK = "0";
    let cerrado: Server | null = null;
    try {
      const r = await publishToDir({ subdomain: "sinred", html: DOC, modelRuntime: CODIGO });
      const html = readFileSync(path.join(root, "sinred", "releases", r.sha, "index.html"), "utf8");
      const srv = createServer((_q, res) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      });
      cerrado = srv;
      await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
      const p = (srv.address() as { port: number }).port;
      const v = await violacionesAlCargar(`http://127.0.0.1:${p}/`);
      assert.ok(v.includes("connect-src"), `el kill-switch no bloqueó: ${v}`);
    } finally {
      cerrado?.close();
      if (previo === undefined) delete process.env.OPENLEN_PAGE_NETWORK;
      else process.env.OPENLEN_PAGE_NETWORK = previo;
    }
  });

});

// 🔴 El OTRO marcador de modo-editor. `data-slot-path` se rechaza desde
// siempre; `data-op-id` no lo miraba nadie en esta puerta, y el 2026-08-23 un
// proyecto real acabó con 60 dentro de `data.html` — de aquí habrían salido
// tal cual al subdominio del usuario.
describe("los marcadores de modo-editor no llegan al disco", () => {
  it("un documento con data-op-id se publica SIN ellos", async () => {
    const sucio = DOC.replace("<h1>", '<h1 data-op-id="7">').replace(
      '<button id="b">',
      '<button id="b" data-op-id="8">',
    );
    const r = await publishToDir({ subdomain: "conids", html: sucio });
    const html = readFileSync(path.join(root, "conids", "releases", r.sha, "index.html"), "utf8");
    assert.ok(!html.includes("data-op-id"), "los op-id llegaron al disco");
    // Se quita el atributo y NADA más del elemento.
    assert.ok(html.includes('id="b"'));
    assert.ok(html.includes("Contador"));
  });
});

describe("sin runtime, la publicación es exactamente la de siempre", () => {
  after(() => rmSync(root, { recursive: true, force: true }));

  // Mismo SUBDOMINIO en los dos: el documento lleva su canónica y su sitemap
  // dentro, así que dos subdominios distintos dan shas distintos por diseño.
  // Comparar entre subdominios habría medido eso y no lo que interesa.
  it("un runtime nulo no cambia absolutamente nada", async () => {
    const a = await publishToDir({ subdomain: "sinjs", html: DOC });
    const b = await publishToDir({ subdomain: "sinjs", html: DOC, modelRuntime: null });
    assert.equal(a.sha, b.sha);
    const html = readFileSync(path.join(root, "sinjs", "releases", a.sha, "index.html"), "utf8");
    assert.ok(!html.includes("getElementById"));
  });
});
