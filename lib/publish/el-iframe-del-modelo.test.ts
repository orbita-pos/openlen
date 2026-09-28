// ¿SOBREVIVE UN `<iframe>` FUERA DE LA LISTA QUE ESCRIBE EL MODELO? Superficie
// por superficie, medido.
//
// El contrato le decía al modelo: «Los `<iframe>` sobreviven SÓLO desde esta
// lista corta: Google Maps, YouTube y Vimeo. Cualquier otro se borra al
// guardar» (`lib/publish-contract-min.ts`; en inglés, la cláusula
// `contrato-completo` de `lib/ai/js-clause.ts`). La lista existe —
// `IFRAMES_PERMITIDOS` en `crates/html-engine/src/sanitize/elements.rs`— pero la
// aplica `sanitizeForPublish`, y lo que escribe el MODELO no pasa por ahí:
// Crear, el Chat y Len guardan por `gateReservedMarker`, y `publishToDir` usa la
// misma puerta. Un iframe de Spotify llega al release.
//
// Lo que SÍ lo borra, como a los `on*` (ver `el-on-del-modelo.test.ts`), es el
// editor del dueño: «Deshacer» manda el documento de antes ENTERO por
// `PATCH /html`, que lo sanea, y `conservarScripts` sólo le devuelve los
// `<script>`. Los tres de la lista sobreviven también a eso.
//
// Y la pregunta de seguridad —¿filtrar iframes en la puerta del modelo?— tiene
// aquí su respuesta medida: el script del modelo sobrevive y corre en la
// publicada, y un script puede crear el mismo iframe en tiempo de ejecución. Un
// filtro de etiquetas no sería una frontera; lo que acota el daño es el origen
// aparte (`openlen.app`, cabecera de `crates/html-engine/src/publish/seal.rs`).
//
// Run: npx tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/publish/el-iframe-del-modelo.test.ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer";

process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
process.env.OPENLEN_LOCALIZE = "0";

const root = mkdtempSync(path.join(tmpdir(), "ol-iframe-"));
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

const SPOTIFY = "https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC";
const YOUTUBE = "https://www.youtube.com/embed/dQw4w9WgXcQ";
const IFRAME_SPOTIFY = `<iframe src="${SPOTIFY}" width="300" height="80" loading="lazy"></iframe>`;
const IFRAME_YOUTUBE = `<iframe src="${YOUTUBE}" width="560" height="315" loading="lazy"></iframe>`;

/** La página ANTES: una sección de música vacía y el vídeo, que está en la lista. */
const PREVIA = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>La banda</title><meta name="description" content="La banda"></head>
<body>
<h1>La banda</h1>
<section id="musica"><h2>Escúchanos</h2></section>
<section id="video"><h2>En vivo</h2>${IFRAME_YOUTUBE}</section>
</body>
</html>`;

const SECCION_CON_SPOTIFY = `<section id="musica"><h2>Escúchanos</h2>${IFRAME_SPOTIFY}</section>`;
/** Y DESPUÉS: el modelo embebió el tema de Spotify. */
const CON_SPOTIFY = PREVIA.replace(`<section id="musica"><h2>Escúchanos</h2></section>`, SECCION_CON_SPOTIFY);

const tiene = (html: string, src: string) => new RegExp(`<iframe[^>]*src="${src.replace(/[.?]/g, "\\$&")}"`).test(html);

describe("lo que escribe el MODELO conserva su iframe de fuera de la lista", () => {
  it("Crear: el stream con las opciones de la ruta y la puerta de crear", async () => {
    const eventos: StreamEvent[] = [
      { type: "start", id: "m1" },
      { type: "text_delta", text: CON_SPOTIFY },
      { type: "done", stopReason: { kind: "end_turn" } },
    ];
    const provider = {
      async *stream() {
        for (const e of eventos) yield e;
      },
    } as unknown as PageStreamProvider;
    const { stream, done } = generateHtmlStream(
      {
        messages: [{ role: "user" as const, content: "la página de la banda" }],
        userId: "u1",
        // Las de `app/api/generate/route.ts`, no los defectos del crate.
        htmlOpts: { injectOpIds: false, sanitize: false, normalizeOnEnd: false },
      },
      { provider, wroteWith: "reasoner", debit: (async () => {}) as never },
    );
    const reader = stream.getReader();
    while (!(await reader.read()).done) {
      /* vaciar */
    }
    const s = await done;
    assert.ok(tiene(s.finalHtml ?? "", SPOTIFY), "el stream se lo quitó");
    const listo = await preparePage(s.finalHtml!, { mode: "create", renderChecks: false });
    assert.ok(listo.ok);
    assert.ok(tiene(listo.html, SPOTIFY), "la puerta de crear se lo quitó");
  });

  it("Chat, por operaciones: un replace de la sección que lo trae", async () => {
    const etiquetado = tagWithOpIds(PREVIA).taggedHtml;
    const target = /<section id="musica" data-op-id="([^"]+)"/.exec(etiquetado)?.[1];
    assert.ok(target, "no encontré el id de la sección");
    const r = applyOps(etiquetado, [{ type: "replace", target, newHtml: SECCION_CON_SPOTIFY }]);
    assert.ok(tiene(r.html ?? "", SPOTIFY), "applyOps se lo quitó");
    const listo = await preparePage(r.html!, { mode: "edit", renderChecks: false, priorHtml: PREVIA });
    assert.ok(listo.ok);
    assert.ok(tiene(listo.html, SPOTIFY), "la puerta de editar se lo quitó");
  });

  it("Chat, reescribiendo la página entera (y Len con Write): la puerta de editar", async () => {
    const listo = await preparePage(CON_SPOTIFY, { mode: "edit", renderChecks: false, priorHtml: PREVIA });
    assert.ok(listo.ok);
    assert.ok(tiene(listo.html, SPOTIFY));
  });

  it("Len: Read → Edit que lo embebe, guardado por el camino de siempre", async () => {
    const store = { data: { html: PREVIA } as ProjectData };
    const deps = {
      async loadProject() {
        return { data: store.data, title: "La banda", subdomain: null, publishedAt: null, userBrief: null };
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
      old_string: `<h2>Escúchanos</h2></section>`,
      new_string: `<h2>Escúchanos</h2>${IFRAME_SPOTIFY}</section>`,
    });
    assert.equal(out.response.ok, true, String(out.response.tool_result));
    assert.ok(tiene(store.data.html!, SPOTIFY), "el guardado de Len se lo quitó");
  });

  it("publishToDir lo deja en el release que sirve Caddy", async () => {
    const r = await publishToDir({ subdomain: "iframemodelo", html: CON_SPOTIFY });
    const servido = readFileSync(path.join(root, "iframemodelo", "releases", r.sha, "index.html"), "utf8");
    assert.ok(tiene(servido, SPOTIFY), "publishToDir se lo quitó");
    assert.ok(tiene(servido, YOUTUBE));
  });
});

describe("lo que SÍ lo borra: el editor del dueño", () => {
  it("«Deshacer» guarda el documento entero: se va el de Spotify, se queda el de YouTube", () => {
    // `doUndo` (app/[locale]/new/page.tsx) → `PATCH /html` con `html` → saneado
    // entero → `conservarScripts`. Lo mismo que hace la ruta, en el mismo orden.
    const saneado = sanitizeForPublish(CON_SPOTIFY).html!;
    const guardado = conservarScripts(CON_SPOTIFY, saneado);
    assert.ok(!tiene(guardado, SPOTIFY), "el de Spotify sobrevivió al saneado del editor");
    assert.ok(tiene(guardado, YOUTUBE), "el de la lista no debería perderse");
  });

  it("y un fragmento del editor que lo traiga, igual", () => {
    const r = aplicarEdiciones(CON_SPOTIFY, [
      {
        op: "replace",
        path: "section:nth-of-type(1)",
        tag: "section",
        hijos: ["h2", "iframe"],
        html: SECCION_CON_SPOTIFY.replace("Escúchanos", "Escúchanos ya"),
      },
    ]);
    assert.ok(r.ok, r.ok ? "" : r.detalle);
    assert.ok(r.html.includes("Escúchanos ya"), "la edición no llegó");
    assert.ok(!tiene(r.html, SPOTIFY));
  });
});

describe("¿y si la puerta del modelo filtrara iframes?", () => {
  let browser: Browser;
  before(async () => {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  });
  after(async () => {
    await browser?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("no sería una frontera: el script del modelo lo crea en la publicada igual", async () => {
    // El mismo documento SIN la etiqueta —lo que dejaría pasar un filtro— y
    // un script que lo pone al cargar. El script del modelo sobrevive (ver
    // model-runtime-publish.test.ts), así que llega.
    const sinEtiqueta = PREVIA.replace(
      "</body>",
      `<script>var f=document.createElement("iframe");f.src=${JSON.stringify(SPOTIFY)};document.getElementById("musica").appendChild(f);</script></body>`,
    );
    const r = await publishToDir({ subdomain: "iframescript", html: sinEtiqueta });
    const servido = readFileSync(path.join(root, "iframescript", "releases", r.sha, "index.html"), "utf8");
    assert.ok(!tiene(servido, SPOTIFY), "el documento publicado no lleva la etiqueta");
    const page = await browser.newPage();
    try {
      // Sin red: sólo se mira que el iframe se cree, no que Spotify responda.
      await page.setRequestInterception(true);
      page.on("request", (q) => void (q.url().startsWith("data:") ? q.continue() : q.abort()));
      await page.setContent(servido, { waitUntil: "domcontentloaded" });
      const src = await page.$eval("#musica iframe", (e) => (e as HTMLIFrameElement).src);
      assert.equal(src, SPOTIFY);
    } finally {
      await page.close();
    }
  });
});
