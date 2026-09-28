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
// Lo que SÍ los borra es la MANO DEL DUEÑO: el editor manda desde el navegador
// lo que tocó, eso es entrada no fiable y se sanea (`aplicarEdiciones` sanea el
// fragmento; el `PATCH /html` del documento entero —deshacer— lo sanea entero y
// sólo le devuelve los `<script>`). Así que un botón con `onclick` funciona el
// día que se publica y se queda mudo la primera vez que el dueño le cambia el
// texto; uno cableado con `addEventListener` desde el script no. Ésa es la
// razón viva para recomendar `addEventListener`, y la que dice el prompt ahora.
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
import { applyOps, sanitizeForPublish, tagWithOpIds } from "@/lib/html-engine";
import { preparePage } from "@/lib/page-engine/prepare";
import { aplicarEdiciones } from "@/lib/page-engine/aplicar-ediciones";
import { conservarScripts } from "@/lib/page-engine/conservar-scripts";
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

describe("lo que SÍ lo borra: la mano del dueño en el editor", () => {
  // El dueño le cambia el texto al botón en el lienzo. El iframe manda el
  // outerHTML de lo que tocó —con su atributo— y el servidor lo sanea.
  const editarTexto = (documento: string, id: "b" | "c", texto: string) => {
    const boton = new RegExp(`<button id="${id}"[^>]*>[^<]*</button>`).exec(documento)![0];
    const nth = id === "b" ? 1 : 2;
    return aplicarEdiciones(documento, [
      {
        op: "replace",
        path: `button:nth-of-type(${nth})`,
        tag: "button",
        hijos: [],
        html: boton.replace(/>[^<]*</, `>${texto}<`),
      },
    ]);
  };

  it("editar el texto del botón le quita el onclick; al cableado desde el script no le pasa nada", () => {
    const b = editarTexto(CON_ONCLICK, "b", "Pulsa ya");
    assert.ok(b.ok, b.ok ? "" : b.detalle);
    assert.ok(b.html.includes(">Pulsa ya</button>"), "la edición no llegó");
    assert.ok(!b.html.includes("onclick"), "el onclick sobrevivió a la edición del dueño");

    const c = editarTexto(CON_ONCLICK, "c", "Pulsa también ya");
    assert.ok(c.ok, c.ok ? "" : c.detalle);
    assert.ok(c.html.includes(`addEventListener("click"`), "el script es del documento guardado");
    assert.ok(c.html.includes(`<button id="c">Pulsa también ya</button>`));
  });

  it("guardar el documento entero (deshacer) también: se le devuelven los <script>, no los on*", () => {
    const saneado = sanitizeForPublish(CON_ONCLICK).html!;
    const guardado = conservarScripts(CON_ONCLICK, saneado);
    assert.ok(!guardado.includes("onclick"));
    assert.ok(guardado.includes(`addEventListener("click"`));
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

  it("tras una edición del dueño, el del onclick se queda MUDO y el del script no", async () => {
    const editado = aplicarEdiciones(CON_ONCLICK, [
      { op: "replace", path: "button:nth-of-type(1)", tag: "button", hijos: [], html: `<button id="b" ${ONCLICK}>Pulsa ya</button>` },
      { op: "replace", path: "button:nth-of-type(2)", tag: "button", hijos: [], html: `<button id="c">Pulsa también ya</button>` },
    ]);
    assert.ok(editado.ok);
    const r = await pulsar("ondueno", editado.html);
    assert.equal(r.b, "sin pulsar", "el botón del onclick debería haberse quedado mudo");
    assert.equal(r.c, "pulsado");
  });
});
