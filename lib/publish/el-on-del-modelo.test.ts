// ¿SOBREVIVE EL `onclick` QUE ESCRIBE EL MODELO? Superficie por superficie,
// medido — no leído en un comentario.
//
// El prompt (`lib/ai/js-clause.ts`, `CABLEADO_*`) les decía a las tres
// superficies que los `on*` «se borran al guardar, así que un botón cableado así
// queda mudo». Para lo que escribe el MODELO eso es falso: Crear, el Chat y Len
// guardan por `gateReservedMarker` —sólo mira `data-slot-path`—, `publishToDir`
// usa la misma puerta, y la CSP que los bloqueaba en el navegador se retiró el
// 2026-08-26 (cabecera de `crates/html-engine/src/publish/seal.rs`).
//
// Lo que SÍ los borraba, hasta el 2026-09-29, era la MANO DEL USUARIO: el
// editor mandaba desde el navegador el elemento que tocó, entero, y eso se
// saneaba; y Deshacer mandaba la página entera y se saneaba entera. Un botón con
// `onclick` funcionaba el día que se publicaba y se quedaba mudo la primera vez
// que el usuario le cambiaba el texto. Por eso el prompt le prohibía al modelo
// los `onclick`: una regla para esquivar un defecto NUESTRO.
//
// Ahora el editor manda lo que cambió —el texto de antes y el de después, unos
// atributos—, como el `Edit` de Claude Code, y Deshacer restaura la copia que
// guarda el servidor. Las pruebas de abajo exigen que el `onclick` sobreviva.
//
// Run: npx tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/publish/el-on-del-modelo.test.ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer";

process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
process.env.OPENLEN_LOCALIZE = "0";

const root = mkdtempSync(path.join(tmpdir(), "ol-on-"));
process.env.PUBLISH_ROOT = root;

import { publishToDir } from "./filesystem";
import { generateHtmlStream, type PageStreamProvider } from "@/lib/ai-stream/generate";
import type { StreamEvent } from "@/lib/ai-gateway";
import { applyOps, tagWithOpIds } from "@/lib/html-engine";
import { preparePage } from "@/lib/page-engine/prepare";
import { aplicarEdiciones } from "@/lib/page-engine/aplicar-ediciones";
import { runAgentTool, type AgentDeps, type AgentSession } from "@/lib/agent/tools";
import type { ProjectData } from "@/lib/projects/types";

const ONCLICK = `onclick="document.getElementById('n').textContent='pulsado'"`;
const BOTON_CON_ONCLICK = `<button id="b" ${ONCLICK}>Pulsa</button>`;

/** La página ANTES del cambio: el botón existe y nadie lo ha cableado. El
 *  gemelo `#c` va cableado como recomienda el prompt, desde el script. */
const PREVIA = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>Contador</title><meta name="description" content="Un contador"></head>
<body>
<h1>Contador</h1>
<button id="b">Pulsa</button>
<span id="n">sin pulsar</span>
<button id="c">Pulsa también</button>
<span id="m">sin pulsar</span>
<script>document.getElementById("c").addEventListener("click",function(){document.getElementById("m").textContent="pulsado"});</script>
</body>
</html>`;

/** Y DESPUÉS: el modelo cableó `#b` con un atributo. */
const CON_ONCLICK = PREVIA.replace(`<button id="b">Pulsa</button>`, BOTON_CON_ONCLICK);

describe("lo que escribe el MODELO conserva su onclick", () => {
  it("Crear: el stream con las opciones de la ruta y la puerta de crear", async () => {
    const eventos: StreamEvent[] = [
      { type: "start", id: "m1" },
      { type: "text_delta", text: CON_ONCLICK },
      { type: "done", stopReason: { kind: "end_turn" } },
    ];
    const provider = {
      async *stream() {
        for (const e of eventos) yield e;
      },
    } as unknown as PageStreamProvider;
    const { stream, done } = generateHtmlStream(
      {
        messages: [{ role: "user" as const, content: "un contador" }],
        userId: "u1",
        // Las de `app/api/generate/route.ts`, no los defectos del crate: con
        // `sanitize: true` se mediría otro producto.
        htmlOpts: { injectOpIds: false, sanitize: false, normalizeOnEnd: false },
      },
      { provider, wroteWith: "reasoner", debit: (async () => {}) as never },
    );
    const reader = stream.getReader();
    while (!(await reader.read()).done) {
      /* vaciar */
    }
    const s = await done;
    assert.ok(s.finalHtml?.includes(ONCLICK), "el stream se lo quitó");
    const listo = await preparePage(s.finalHtml!, { mode: "create", renderChecks: false });
    assert.ok(listo.ok);
    assert.ok(listo.html.includes(ONCLICK), "la puerta de crear se lo quitó");
  });

  it("Chat, por operaciones: un replace que trae el onclick", async () => {
    const etiquetado = tagWithOpIds(PREVIA).taggedHtml;
    const target = /<button id="b" data-op-id="([^"]+)"/.exec(etiquetado)?.[1];
    assert.ok(target, "no encontré el id del botón");
    const r = applyOps(etiquetado, [{ type: "replace", target, newHtml: BOTON_CON_ONCLICK }]);
    assert.ok(r.html?.includes(ONCLICK), "applyOps se lo quitó");
    const listo = await preparePage(r.html!, { mode: "edit", renderChecks: false, priorHtml: PREVIA });
    assert.ok(listo.ok);
    assert.ok(listo.html.includes(ONCLICK), "la puerta de editar se lo quitó");
  });

  it("Chat, reescribiendo la página entera (y Len con Write): la puerta de editar", async () => {
    const listo = await preparePage(CON_ONCLICK, { mode: "edit", renderChecks: false, priorHtml: PREVIA });
    assert.ok(listo.ok);
    assert.ok(listo.html.includes(ONCLICK));
  });

  it("Len: Read → Edit que cablea el botón, guardado por el camino de siempre", async () => {
    const store = { data: { html: PREVIA } as ProjectData };
    const deps = {
      async loadProject() {
        return { data: store.data, title: "Contador", subdomain: null, publishedAt: null, userBrief: null };
      },
      async saveProjectData(_p: string, _u: string, aplicar: (d: ProjectData) => ProjectData) {
        store.data = aplicar(store.data);
      },
      async snapshotVersion() {
        return "v1";
      },
    } as unknown as AgentDeps;
    const session: AgentSession = {
      projectId: "p1",
      userId: "u1",
      page: null,
      ownerEmail: null,
      imageEditsThisTurn: 0,
      photoSearchesThisTurn: 0,
      busquedasVaciasSeguidas: 0,
    };
    await runAgentTool(session, deps, "Read", { file_path: "/index.html" });
    const out = await runAgentTool(session, deps, "Edit", {
      file_path: "/index.html",
      old_string: `<button id="b">Pulsa</button>`,
      new_string: BOTON_CON_ONCLICK,
    });
    assert.equal(out.response.ok, true, String(out.response.tool_result));
    assert.ok(store.data.html!.includes(ONCLICK), "el guardado de Len se lo quitó");
  });
});

describe("y la mano del usuario en el editor tampoco lo borra (2026-09-29)", () => {
  // Hasta hoy el editor mandaba el elemento tocado ENTERO y el servidor lo
  // saneaba: cambiarle el texto al botón le quitaba el onclick. Ahora manda lo
  // que cambió —como el `Edit` de Claude Code— y el resto sale del guardado.
  const editarTexto = (documento: string, id: "b" | "c", antes: string, despues: string) =>
    aplicarEdiciones(documento, [
      {
        op: "texto",
        modo: "elemento",
        path: `button:nth-of-type(${id === "b" ? 1 : 2})`,
        tag: "button",
        hijos: [],
        antes,
        despues,
      },
    ]);

  it("editar el texto del botón le deja el onclick, y al cableado desde el script tampoco le pasa nada", () => {
    const b = editarTexto(CON_ONCLICK, "b", "Pulsa", "Pulsa ya");
    assert.ok(b.ok, b.ok ? "" : b.detalle);
    assert.ok(b.html.includes(`<button id="b" ${ONCLICK}>Pulsa ya</button>`), "el onclick no sobrevivió a la edición");

    const c = editarTexto(CON_ONCLICK, "c", "Pulsa también", "Pulsa también ya");
    assert.ok(c.ok, c.ok ? "" : c.detalle);
    assert.ok(c.html.includes(`addEventListener("click"`), "el script es del documento guardado");
    assert.ok(c.html.includes(`<button id="c">Pulsa también ya</button>`));
  });

  it("cambiarle el estilo tampoco: viajan los atributos, no el elemento", () => {
    const r = aplicarEdiciones(CON_ONCLICK, [
      { op: "atributos", path: "button:nth-of-type(1)", tag: "button", hijos: [], attrs: { style: "color: red" } },
    ]);
    assert.ok(r.ok, r.ok ? "" : r.detalle);
    assert.ok(r.html.includes(ONCLICK));
    assert.ok(r.html.includes(`style="color: red"`));
  });

  it("lo que SÍ se sigue saneando es el marcado NUEVO del navegador: un onclick que traiga no entra", () => {
    const r = aplicarEdiciones(PREVIA, [
      {
        op: "replace",
        path: "button:nth-of-type(1)",
        tag: "button",
        hijos: [],
        html: BOTON_CON_ONCLICK,
      },
    ]);
    assert.ok(r.ok, r.ok ? "" : r.detalle);
    assert.ok(!r.html.includes("onclick"), "un onclick nuevo del navegador entró");
  });
});


describe("publicado y abierto en Chromium", () => {
  let browser: Browser;
  before(async () => {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  });
  after(async () => {
    await browser?.close();
    rmSync(root, { recursive: true, force: true });
  });

  /** Publica, abre el release que Caddy serviría y pulsa los dos botones. */
  async function pulsar(sub: string, html: string) {
    const r = await publishToDir({ subdomain: sub, html });
    const servido = readFileSync(path.join(root, sub, "releases", r.sha, "index.html"), "utf8");
    const page = await browser.newPage();
    try {
      await page.setContent(servido, { waitUntil: "domcontentloaded" });
      await page.click("#b");
      await page.click("#c");
      return {
        servido,
        b: await page.$eval("#n", (e) => e.textContent),
        c: await page.$eval("#m", (e) => e.textContent),
      };
    } finally {
      await page.close();
    }
  }

  it("el onclick del modelo llega al release y el botón FUNCIONA", async () => {
    const r = await pulsar("onmodelo", CON_ONCLICK);
    assert.ok(r.servido.includes(ONCLICK), "publishToDir se lo quitó");
    assert.equal(r.b, "pulsado");
    assert.equal(r.c, "pulsado");
  });

  it("tras editar el texto de los DOS botones, los dos siguen funcionando en la publicada", async () => {
    const editado = aplicarEdiciones(CON_ONCLICK, [
      { op: "texto", modo: "elemento", path: "button:nth-of-type(1)", tag: "button", hijos: [], antes: "Pulsa", despues: "Pulsa ya" },
      { op: "texto", modo: "elemento", path: "button:nth-of-type(2)", tag: "button", hijos: [], antes: "Pulsa también", despues: "Pulsa también ya" },
    ]);
    assert.ok(editado.ok, editado.ok ? "" : editado.detalle);
    const r = await pulsar("onusuario", editado.html);
    assert.equal(r.b, "pulsado", "el botón del onclick se quedó mudo tras la edición");
    assert.equal(r.c, "pulsado");
  });
});
