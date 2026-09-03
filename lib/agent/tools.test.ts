// Run: npx tsx --test lib/agent/tools.test.ts
//
// node:test, not vitest — this exercises the native @/lib/html-engine (Rust)
// binding via tagWithOpIds/applyOps, which vite's jsdom environment can't
// load. See vitest.config.ts's NB comment on lib/agent for the split.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripOpIds, tagWithOpIds } from "@/lib/html-ops";
import { lookFromAccent } from "@/lib/palette-gen";
import { applyTematicaToHtml } from "@/lib/tematicas/apply-server";
import { TEMATICA_PRESETS } from "@/lib/tematicas/presets";
import { runAgentTool, sanitizeAviso, summarizeProjectState, urlIsPageImage, type AgentDeps, type AgentSession } from "./tools";
import { realDeps } from "./tools";
import type { RedesignInput } from "./redesign";
import { BEHAVIOR_NAMES } from "@/lib/conductas-heredadas/doc";
import type { ProjectData } from "@/lib/projects/types";
const HTML = `<!doctype html><html><head><title>Tacos El Güero</title><meta name="description" content="Tacos"></head><body><h1 data-x="k">Tacos El Güero</h1><p>Los mejores del barrio.</p></body></html>`;

// Una pagina que SI consume los tokens --ol-*, como las que nacen de
// /api/generate. `HTML` no los lee (igual que 171 de las 178 plantillas
// curadas), y sobre esa `cambiar_tema` ahora se niega en vez de reportar un
// cambio que no ocurre: ver "no miente sobre una pagina que no lee tokens".
const THEMED_HTML = `<!doctype html><html><head><title>Tacos El Güero</title><meta name="description" content="Tacos"><style>body{background:var(--ol-bg);color:var(--ol-fg);font-family:var(--ol-font-display)}a{color:var(--ol-accent);border-radius:calc(8px * var(--ol-r-scale))}</style></head><body><h1 data-x="k">Tacos El Güero</h1><p>Los mejores del barrio.</p><a href="#x">Pide</a></body></html>`;

// Fixture with an image already on the page — editar_imagen only edits images
// whose URL appears verbatim in the current document.
const IMG_URL = "https://images.openlen.com/orig-photo.webp";
const IMG_HTML = `<!doctype html><html><head><title>Estudio</title><meta name="description" content="x"></head><body><img src="${IMG_URL}" alt="foto"><h1 data-x="k">Estudio</h1></body></html>`;

const DEFAULT_IMAGE_MANIFEST = {
  version: 1,
  generated: "2026-05-29T22:45:20.097Z",
  count: 2,
  images: [
    {
      id: "01-warm-glassy",
      promptNum: 1,
      style: "3d-abstract",
      family: ["saas", "portfolio"],
      alt: "Three floating frosted glass forms in warm peach gradient",
      src: {
        hero: "https://images.openlen.com/01-warm-glassy-1920.webp",
        tablet: "https://images.openlen.com/01-warm-glassy-800.webp",
        thumb: "https://images.openlen.com/01-warm-glassy-400.webp",
      },
    },
    {
      id: "04-clay-primitives",
      promptNum: 4,
      style: "claymorph",
      family: ["agency"],
      alt: "Soft clay primitive shapes in pastel studio light",
      src: {
        hero: "https://images.openlen.com/04-clay-primitives-1920.webp",
        tablet: "https://images.openlen.com/04-clay-primitives-800.webp",
        thumb: "https://images.openlen.com/04-clay-primitives-400.webp",
      },
    },
  ],
};

type FetchImageResult =
  | { ok: true; base64: string; mimeType: string }
  | { ok: false; error: string };
type EditImageResult =
  | { imageBase64: string; mimeType: string; cost: number }
  | { error: string; status: number; body: Record<string, unknown> };

function makeDeps(
  overrides?: Partial<{
    data: ProjectData;
    subdomain: string | null;
    publishedAt: Date | null;
    audioAssets: { url: string; name: string }[];
    imageManifest: unknown;
    fetchImageResult: FetchImageResult;
    editImageResult: EditImageResult;
    uploadUrl: string;
    userBrief: string | null;
    redesignResult: import("@/lib/agent/redesign").RedesignOutcome;
    generatedRuntime: unknown;
    pageRuntimes: unknown;
  }>,
) {
  const store = {
    data: (overrides?.data ?? { html: HTML }) as ProjectData,
    saved: [] as ProjectData[],
    /** Preferencias guardadas a nivel de PERSONA (no de proyecto). */
    memoriaUsuario: [] as { userId: string; preferencia: string }[],
    versions: [] as string[],
    /** Los snapshots CON contenido, del más nuevo al más viejo — lo que la
     *  tabla real guarda y lo que `revertir_ultimo_cambio` necesita para tener
     *  a dónde volver. `versions` (sólo etiquetas) se conserva porque muchas
     *  pruebas cuentan sobre él. */
    snapshots: [] as { id: string; label: string; page: string | null; html: string }[],
    // F4 Task 2 pin: which page each snapshot carried (parallel to
    // `versions`, one entry per snapshotVersion call, same order).
    versionPages: [] as (string | null)[],
    provisioned: 0,
    provisionedOpts: null as { email: string | null; displayName: string } | null,
    audioAssets: overrides?.audioAssets ?? [],
    imageManifest: overrides?.imageManifest ?? DEFAULT_IMAGE_MANIFEST,
    manifestFetches: 0,
    fetches: [] as string[],
    uploads: [] as { projectId: string; mime: string; name: string; size: number }[],
    imageEdits: [] as { userId: string; prompt: string }[],
    redesigns: [] as import("@/lib/agent/redesign").RedesignInput[],
    userBrief: (overrides?.userBrief ?? null) as string | null,
    briefWrites: 0,
    /** La cápsula que el proyecto ya tenía, y lo que el guardado hizo con ella.
     *  `runtimeGuardado` empieza como el centinela `"(sin llamar)"` para poder
     *  distinguir `undefined` (no toques la columna) de `null` (vacíala): esa
     *  diferencia ES el hallazgo 3. */
    generatedRuntime: (overrides?.generatedRuntime ?? null) as unknown,
    /** Y las de las subpáginas, por slug — la columna que el publicador se
     *  había dejado fuera de su `select`. */
    pageRuntimes: (overrides?.pageRuntimes ?? null) as unknown,
    runtimeGuardado: "(sin llamar)" as unknown,
    paginaGuardada: "(sin llamar)" as unknown,
  };
  const fetchImageResult: FetchImageResult =
    overrides?.fetchImageResult ?? { ok: true, base64: "b64orig", mimeType: "image/webp" };
  const editImageResult: EditImageResult =
    overrides?.editImageResult ?? { imageBase64: "b64edited", mimeType: "image/webp", cost: 4 };
  const uploadUrl = overrides?.uploadUrl ?? "https://images.openlen.com/edited-123.webp";
  const deps: AgentDeps = {
    async loadProject() {
      return {
        data: store.data,
        pageRuntimes: store.pageRuntimes,
        title: "Tacos",
        subdomain: overrides?.subdomain ?? null,
        publishedAt: overrides?.publishedAt ?? null,
        userBrief: store.userBrief,
        generatedRuntime: store.generatedRuntime,
      };
    },
    async saveProjectData(_p, _u, data) {
      store.data = data;
      store.saved.push(data);
      // A QUÉ PÁGINA dijo el motor que pertenecía. Sin esto no se distingue
    },
    async redesignDocument(_u, input) {
      store.redesigns.push(input);
      return overrides?.redesignResult ?? {
        ok: true,
        html: `<!doctype html><html lang="es"><head><title>Rediseñada</title></head><body><h1>Nuevo diseño</h1></body></html>`,
        usage: { inputTokens: 10_000, outputTokens: 8_000, cachedTokens: 0 },
        modelRuntime: null,
      };
    },
    async snapshotVersion(a) {
      store.versions.push(a.label);
      store.versionPages.push(a.page);
      // Y el CONTENIDO, para que `revertir_ultimo_cambio` tenga a dónde volver.
      // El doble guarda lo mismo que la tabla real: id, etiqueta, ámbito y html.
      store.snapshots.unshift({
        id: `v${store.snapshots.length + 1}`,
        label: a.label,
        page: a.page,
        html: a.html,
      });
    },
    // El historial, con la MISMA semántica que el real: `listVersions` da del
    // más nuevo al más viejo, y `restoreVersion` escribe el proyecto y deja un
    // snapshot nuevo con lo restaurado (por eso el real es undoable).
    async listVersions(_p, _u, page) {
      return store.snapshots
        .filter((s) => s.page === page)
        .map((s) => ({ id: s.id, label: s.label }));
    },
    async restoreVersion(_p, _u, versionId) {
      const v = store.snapshots.find((s) => s.id === versionId);
      if (!v) return null;
      store.data = v.page
        ? { ...store.data, pages: { ...store.data.pages, [v.page]: { ...store.data.pages?.[v.page], html: v.html } } }
        : { ...store.data, html: v.html };
      store.snapshots.unshift({
        id: `v${store.snapshots.length + 1}`,
        label: `Restored "${v.label}"`,
        page: v.page,
        html: v.html,
      });
      return { html: v.html };
    },
    async provisionOwnerChat(_p, _u, opts) { store.provisioned += 1; store.provisionedOpts = opts; },
    async listAudioAssets() { return store.audioAssets; },
    async fetchImageManifest() { store.manifestFetches += 1; return store.imageManifest; },
    async fetchImage(url) { store.fetches.push(url); return fetchImageResult; },
    async uploadAsset(projectId, bytes, mime, name) {
      store.uploads.push({ projectId, mime, name, size: bytes.length });
      return { url: uploadUrl };
    },
    async editImage(userId, input) {
      store.imageEdits.push({ userId, prompt: input.prompt });
      return editImageResult;
    },
    async setUserBrief(_p, _u, value) {
      store.userBrief = value;
      store.briefWrites += 1;
      return true;
    },
    // Task 17 (conectar_datos_vivos) — unused by this file's tests (see
    // live-data-tool.test.ts), stubbed only so the AgentDeps shape is
    // satisfied; a call here means a test is missing coverage, not that
    // these are meant to do anything real.
    async fetchSheetRows() {
      throw new Error("fetchSheetRows not stubbed in this test");
    },
    // Memoria de la PERSONA. El doble la registra en vez de lanzar porque
    // `recordar_preferencia` la usa por DEFECTO desde el 2026-08-22: un stub
    // que lanzara convertiría el camino normal de la herramienta en un fallo.
    async rememberAboutUser(userId: string, preferencia: string) {
      store.memoriaUsuario.push({ userId, preferencia });
      return { ok: true as const, yaExistia: false };
    },
    // El doble usa el NÚCLEO REAL. Escrito a mano aceptaba `color_favorito`
    // —el real lo rechaza— y la prueba de la lista cerrada pasaba en verde
    // contra un contrato que no existe. Lo único que finge es la base.
  };
  return { deps, store };
}

// Legacy call shape `makeSession(html?)` stays page: null (home) — every
// pre-F4 test keeps working unchanged. F4 Task 2 pins use the object shape
// `makeSession({ page, html })` to put a session on an active subpage.
function makeSession(arg?: string | { page?: string | null; html?: string }): AgentSession {
  const opts = typeof arg === "object" && arg !== null ? arg : { html: arg };
  const html = opts.html ?? HTML;
  return {
    projectId: "p1",
    userId: "u1",
    taggedHtml: tagWithOpIds(html).taggedHtml,
    page: opts.page ?? null,
    // Desde el 2026-08-25 la página NO entra en la capacidad: cada una guarda su
    // propio JavaScript, así que una sesión sobre /menu puede lo mismo que sobre
    // la portada.
    ownerEmail: "owner@example.com",
    imageEditsThisTurn: 0,
    photoSearchesThisTurn: 0,
    busquedasVaciasSeguidas: 0,
  };
}

/** First `data-op-id` in document order — head/script/style are never
 *  tagged (see html-ops.test.ts), so for these body-first fixtures this is
 *  always the opening <h1>. */
function firstOpId(taggedHtml: string): string {
  const m = /data-op-id="([^"]+)"/.exec(taggedHtml);
  if (!m) throw new Error("no data-op-id found in taggedHtml");
  return m[1];
}

/** El op-id de un elemento de CONTENIDO, nunca el de la raiz.
 *
 *  `firstOpId` devuelve el PRIMER id del documento, que es el del <html> o el
 *  <body> — y desde el 2026-08-22 una op contra la raiz se rechaza, porque
 *  reemplazarla borra la pagina entera del usuario (medido: 8 de 40 turnos del
 *  brazo de control acabaron con el <body> sustituido por un <link>). Los pines
 *  de abajo prueban a QUE PAGINA se escribe, no que se pueda editar la raiz, y
 *  con `firstOpId` dependian sin querer de lo que ahora esta prohibido. */
function contentOpId(taggedHtml: string): string {
  const m = /<h1[^>]*data-op-id="([^"]+)"|<p[^>]*data-op-id="([^"]+)"/.exec(taggedHtml);
  const id = m?.[1] ?? m?.[2];
  if (!id) throw new Error("no content data-op-id found in taggedHtml");
  return id;
}

describe("summarizeProjectState", () => {
  it("reports modules off by default and unpublished", () => {
    const s = summarizeProjectState({ data: { html: HTML }, title: "Tacos", subdomain: null, publishedAt: null });
    assert.equal(s.publicado, false);
    // Esto vigila que el estado NAZCA con todo apagado, y da igual con qué
    // módulo se compruebe. El ejemplo ha ido cambiando con cada retirada:
    // `members` (2026-08-21) → `collections` (2026-08-29) → `chat`, que es el
    // único de `AGENT_MODULES` hoy. Cuando el stand-in muere, la prueba se cae
    // sola y hay que re-apuntarla — es justo lo que la tuvo días en rojo.
    assert.equal((s.modulos as Record<string, boolean>).chat, false);
  });

  // LA HOME CUENTA. `data.pages` son las páginas EXTRA, así que esta lista
  // enseñaba un sitio con una página menos de las que tiene. Medido el
  // 2026-08-26: en un sitio de dos páginas, a «¿cuántas ves?» el Agente
  // contestó que una — y contestó bien, porque eso fue lo que le dimos.
  it("la lista de páginas incluye la Home, no sólo las extra", () => {
    const s = summarizeProjectState({
      data: { html: HTML, pages: { nosotros: { html: HTML } } },
      title: "Tacos",
      subdomain: null,
      publishedAt: null,
    });
    assert.deepEqual(s.paginas, ["principal", "nosotros"]);
  });

  // Y en un sitio de UNA sola página sigue habiendo una página, no cero: un
  // sitio sin páginas es una frase que no significa nada.
  it("y un proyecto de una sola página no sale con la lista vacía", () => {
    const s = summarizeProjectState({ data: { html: HTML }, title: "Tacos", subdomain: null, publishedAt: null });
    assert.deepEqual(s.paginas, ["principal"]);
  });
});

describe("activar_modulo", () => {
  it("provisions owner chat on chat enable, threading the session email", async () => {
    const { deps, store } = makeDeps();
    await runAgentTool(makeSession(), deps, "activar_modulo", { modulo: "chat" });
    assert.equal(store.provisioned, 1);
    // The email must reach the dep — getOrCreateOwnerChatUser short-circuits on
    // an existing row, so a dropped email would strand the owner forever.
    assert.equal(store.provisionedOpts?.email, "owner@example.com");
    assert.equal(store.provisionedOpts?.displayName, "Tacos");
  });
  // Antes esto comprobaba el error de «comments requiere members». Comentarios
  // se retiró (2026-08-21), así que ahora vigila algo MÁS general y más útil: un
  // módulo que no existe se rechaza limpio, sin lanzar y sin fingir que se
  // activó. Es la red para cualquier nombre que el modelo se invente.
  it("un módulo que no existe se rechaza al modelo, no lanza", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "activar_modulo", { modulo: "comments" });
    assert.equal(out.response.ok, false);
    assert.ok(String(out.response.error).includes("desconocido"));
    // Y no toca nada: un rechazo que además escribiera sería peor que un throw.
    assert.equal(store.data.settings, undefined);
  });

});

// P4 — rediseño total: el tool delega el modelo a deps.redesignDocument y el
// resultado pasa por el MISMO embudo de persistencia que editar_pagina.
describe("redisenar_pagina", () => {
  const CALL = { direccion: "más moderna y oscura", resumen: "rediseño moderno" };

  it("rediseña, persiste por el embudo y deja el Undo (Before AI edit)", async () => {
    const { deps, store } = makeDeps();
    const session = makeSession();
    const out = await runAgentTool(session, deps, "redisenar_pagina", CALL);
    assert.equal(out.response.ok, true);
    assert.ok(out.updatedHtml?.includes("Nuevo diseño"));
    assert.equal(out.action?.tool, "redisenar_pagina");
    // el embudo corrió: se guardó data y hay snapshot previo + etiquetado
    assert.equal(store.saved.length, 1);
    assert.ok(store.versions.some((v) => v === "Before AI edit"));
    assert.ok(store.versions.some((v) => v.startsWith("Rediseño:")));
    // el motor recibió el documento ACTUAL (no el etiquetado con op-ids)
    assert.equal(store.redesigns.length, 1);
    assert.ok(store.redesigns[0].html.includes("Tacos El Güero") || store.redesigns[0].html.includes("<h1"));
    assert.ok(!store.redesigns[0].html.includes("data-op-id"));
    // session re-etiquetada para retoques posteriores
    assert.ok(session.taggedHtml.includes("Nuevo diseño"));
  });

  it("UNA por turno — la segunda se rechaza con guía", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    await runAgentTool(session, deps, "redisenar_pagina", CALL);
    const out = await runAgentTool(session, deps, "redisenar_pagina", CALL);
    assert.equal(out.response.ok, false);
    assert.match(String(out.response.error), /ya rediseñaste/);
  });

  it("si el modelo falla, no se guarda NADA", async () => {
    const { deps, store } = makeDeps({ redesignResult: { ok: false, error: "Gemini 503" } });
    const out = await runAgentTool(makeSession(), deps, "redisenar_pagina", CALL);
    assert.equal(out.response.ok, false);
    assert.equal(store.saved.length, 0);
    assert.equal(store.versions.length, 0);
  });

  it("un rediseño con data-slot-path se rechaza y no persiste (guard del embudo)", async () => {
    const { deps, store } = makeDeps({
      redesignResult: {
        ok: true,
        html: '<!doctype html><html><body><div data-slot-path="x">hola</div>' + "x".repeat(2000) + "</body></html>",
        usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 },
        modelRuntime: null,
      },
    });
    const out = await runAgentTool(makeSession(), deps, "redisenar_pagina", CALL);
    assert.equal(out.response.ok, false);
    assert.match(String(out.response.error), /marcador reservado/);
    assert.equal(store.saved.length, 0);
  });

  it("sin direccion → error accionable", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "redisenar_pagina", { resumen: "x" });
    assert.equal(out.response.ok, false);
    assert.match(String(out.response.error), /direccion/);
  });

  // ⚰️ Esta prueba fijaba que el motor de rediseño RECIBÍA los hechos del
  // perfil de negocio. Su inversa, desde el 2026-08-31: ya no hay perfil que
  // recibir — y lo que impide que el rediseño pierda el teléfono del dueño
  // no era ese bloque, sino `facts-kept.ts`, que lo COMPRUEBA en el resultado.
  it("el motor de rediseño ya NO recibe un bloque de negocio", async () => {
    const { deps, store } = makeDeps();
    await runAgentTool(makeSession(), deps, "redisenar_pagina", CALL);
    assert.ok(!("negocio" in store.redesigns[0]));
  });
});

describe("editar_pagina", () => {
  const PRUEBA_A = [
    { clic: "#accion-a", entonces: [{ donde: "#resultado-a", que: "cambia" }] },
  ];
  const PRUEBA_B = [
    { clic: "#accion-b", entonces: [{ donde: "#resultado-b", que: "cambia" }] },
  ];

  async function instalaRuntimeConPruebaA(session: AgentSession, deps: AgentDeps) {
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target: "runtime", new_html: "window.estado = 'a';" }],
      prueba: PRUEBA_A,
      resumen: "conducta A",
    });
    assert.equal(out.response.ok, true);
    assert.deepEqual(session.behaviorSpec, [
      { clic: "#accion-a", veces: 1, entonces: [{ donde: "#resultado-a", que: "cambia" }] },
    ]);
  }

  async function instalaCopyA(session: AgentSession, deps: AgentDeps) {
    const target = contentOpId(session.taggedHtml);
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{
        op: "replace",
        target,
        new_html: '<h1>Cupones</h1><code id="cupon-a">A20</code><code id="cupon-b">B30</code><button data-ol-copy="cupon-a" aria-label="Copiar cupón">Copiar A</button>',
      }],
      prueba: PRUEBA_A,
      resumen: "conducta copy A",
    });
    assert.equal(out.response.ok, true);
    assert.deepEqual(session.behaviorSpec, [
      { clic: "#accion-a", veces: 1, entonces: [{ donde: "#resultado-a", que: "cambia" }] },
    ]);
  }

  function copyOpId(taggedHtml: string): string {
    const id = /<button[^>]*data-ol-copy[^>]*data-op-id="([^"]+)"|<button[^>]*data-op-id="([^"]+)"[^>]*data-ol-copy/.exec(taggedHtml);
    const value = id?.[1] ?? id?.[2];
    if (!value) throw new Error("no data-op-id found for copy button");
    return value;
  }

  it("runtime B sin prueba no reutiliza la prueba A: persiste B, deja spec null y avisa", async () => {
    const { deps, store } = makeDeps();
    const session = makeSession();
    await instalaRuntimeConPruebaA(session, deps);

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target: "runtime", new_html: "window.estado = 'b';" }],
      resumen: "conducta B",
    });

    assert.equal(out.response.ok, true);
    assert.ok(
      store.data.html.includes("window.estado = 'b';"),
      "el segundo script no llegó al documento",
    );
    assert.equal(session.behaviorSpec, null);
    assert.match(String(out.response.aviso_critico), /prueba/i);
  });

  it("runtime B con prueba vacía no reutiliza A: deja spec null y avisa que está malformada", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    await instalaRuntimeConPruebaA(session, deps);

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target: "runtime", new_html: "window.estado = 'b';" }],
      prueba: [],
      resumen: "conducta B",
    });

    assert.equal(out.response.ok, true);
    assert.equal(session.behaviorSpec, null);
    assert.match(String(out.response.aviso_critico), /prueba.*vac[ií]a|vac[ií]a.*prueba/i);
  });

  it("una conducta nueva en el markup sin prueba produce aviso_critico", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    const target = contentOpId(session.taggedHtml);

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{
        op: "replace",
        target,
        new_html: '<div><code id="cupon">TACOS20</code><button data-ol-copy="cupon" aria-label="Copiar cupón">Copiar</button></div>',
      }],
      resumen: "copiar cupón",
    });

    assert.equal(out.response.ok, true);
    assert.equal(session.behaviorSpec, null);
    assert.match(String(out.response.aviso_critico), /prueba/i);
  });

  it("una edición fallida con prueba B conserva la prueba A", async () => {
    const { deps, store } = makeDeps();
    const session = makeSession();
    await instalaRuntimeConPruebaA(session, deps);
    const guardadosAntes = store.saved.length;

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target: "no-existe", new_html: "<p>nunca persiste</p>" }],
      prueba: PRUEBA_B,
      resumen: "edición fallida",
    });

    assert.equal(out.response.ok, false);
    assert.equal(store.saved.length, guardadosAntes);
    assert.deepEqual(session.behaviorSpec, [
      { clic: "#accion-a", veces: 1, entonces: [{ donde: "#resultado-a", que: "cambia" }] },
    ]);
  });

  it("un cambio puramente textual no borra ni reemplaza A aunque reciba prueba B", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    await instalaRuntimeConPruebaA(session, deps);
    const target = contentOpId(session.taggedHtml);

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target, new_html: "<h1>Nuevo titular</h1>" }],
      prueba: PRUEBA_B,
      resumen: "sólo texto",
    });

    assert.equal(out.response.ok, true);
    assert.deepEqual(session.behaviorSpec, [
      { clic: "#accion-a", veces: 1, entonces: [{ donde: "#resultado-a", que: "cambia" }] },
    ]);
  });

  it("borrar runtime tras A limpia la spec y no exige prueba de lo retirado", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    await instalaRuntimeConPruebaA(session, deps);

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "delete", target: "runtime" }],
      resumen: "retirar conducta",
    });

    assert.equal(out.response.ok, true);
    assert.equal(session.behaviorSpec, null);
    assert.doesNotMatch(String(out.response.aviso_critico ?? ""), /prueba/i);
  });

  it("cambiar el valor de data-ol-copy con el mismo conteo limpia A y avisa si falta prueba", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    await instalaCopyA(session, deps);

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{
        op: "replace",
        target: copyOpId(session.taggedHtml),
        new_html: '<button data-ol-copy="cupon-b" aria-label="Copiar cupón">Copiar B</button>',
      }],
      resumen: "cambiar cupón",
    });

    assert.equal(out.response.ok, true);
    assert.equal(session.behaviorSpec, null);
    assert.match(String(out.response.aviso_critico), /prueba/i);
  });

  it("cambiar el valor de data-ol-copy con prueba B reemplaza A sin aviso falso", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    await instalaCopyA(session, deps);

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{
        op: "replace",
        target: copyOpId(session.taggedHtml),
        new_html: '<button data-ol-copy="cupon-b" aria-label="Copiar cupón">Copiar B</button>',
      }],
      prueba: PRUEBA_B,
      resumen: "cambiar cupón",
    });

    assert.equal(out.response.ok, true);
    assert.deepEqual(session.behaviorSpec, [
      { clic: "#accion-b", veces: 1, entonces: [{ donde: "#resultado-b", que: "cambia" }] },
    ]);
    assert.doesNotMatch(String(out.response.aviso_critico ?? ""), /prueba/i);
  });

  it("retirar una conducta de markup limpia A y avisa que la mutación llegó sin prueba", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    await instalaCopyA(session, deps);

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{
        op: "replace",
        target: copyOpId(session.taggedHtml),
        new_html: '<button aria-label="Copiar cupón">Copiar manualmente</button>',
      }],
      resumen: "retirar copy",
    });

    assert.equal(out.response.ok, true);
    assert.equal(session.behaviorSpec, null);
    assert.match(String(out.response.aviso_critico), /prueba/i);
  });

  // ── 🔴 UNA PRUEBA MANDADA SE HONRA, TOCARA EL TURNO JAVASCRIPT O NO ────────
  //
  // La puerta era `cambioConducta` = «escribió runtime» O «cambió la huella de
  // las CONDUCTAS» — un catálogo RETIRADO el 2026-08-23 que el modelo ya no
  // emite. O sea, en la práctica: «¿tocaste JavaScript?».
  //
  // Y el contrato le dice lo contrario: «cuando el CSS puro ya resuelve
  // —<details>/<summary>, un checkbox con peer-checked:, :target— prefiérelo».
  // Así que al modelo que OBEDECE le tirábamos la prueba EN SILENCIO. Misma
  // forma que los 7 casos de CONDUCTAS que suspendían al Agente por acertar.
  it("un acordeón de CSS puro, sin una línea de JS, SÍ deja su prueba puesta", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    const target = contentOpId(session.taggedHtml);

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{
        op: "replace",
        target,
        new_html: '<details id="faq"><summary id="abrir">¿Abren los domingos?</summary><p id="respuesta">Sí, de 10 a 14.</p></details>',
      }],
      prueba: [{ clic: "#abrir", entonces: [{ donde: "#respuesta", que: "visible" }] }],
      resumen: "faq con details",
    });

    assert.equal(out.response.ok, true);
    // NI runtime NI data-ol-*: el turno no toca JavaScript por ningún lado.
    assert.deepEqual(session.behaviorSpec, [
      { clic: "#abrir", veces: 1, entonces: [{ donde: "#respuesta", que: "visible" }] },
    ]);
  });

  it("y si esa prueba viene mal formada, se OYE — antes se callaba sin JS de por medio", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    const target = contentOpId(session.taggedHtml);

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target, new_html: '<details id="faq"><summary>x</summary></details>' }],
      // `estilo` sin el nombre de la propiedad: rechazo `falta_valor`.
      prueba: [{ clic: "#abrir", entonces: [{ donde: "#faq", que: "estilo" }] }],
      resumen: "faq",
    });

    assert.equal(out.response.ok, true);
    assert.match(String(out.response.aviso_critico ?? ""), /prueba|comprobar el comportamiento/i);
  });

  it("una prueba con que:\"estilo\" bien formada llega entera a la sesión", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target: "runtime", new_html: "document.body.classList.add('x');" }],
      prueba: [{ clic: "#tema", entonces: [{ donde: "body", que: "estilo", valor: "background-color" }] }],
      resumen: "tema oscuro",
    });

    assert.equal(out.response.ok, true);
    assert.deepEqual(session.behaviorSpec, [
      {
        clic: "#tema",
        veces: 1,
        entonces: [{ donde: "body", que: "estilo", valor: "background-color" }],
      },
    ]);
  });

  it("cambiar sólo el texto de un control conserva A y no exige otra prueba", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    await instalaCopyA(session, deps);

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{
        op: "replace",
        target: copyOpId(session.taggedHtml),
        new_html: '<button data-ol-copy="cupon-a" aria-label="Copiar cupón">Copia tu descuento</button>',
      }],
      resumen: "texto del botón",
    });

    assert.equal(out.response.ok, true);
    assert.deepEqual(session.behaviorSpec, [
      { clic: "#accion-a", veces: 1, entonces: [{ donde: "#resultado-a", que: "cambia" }] },
    ]);
    assert.doesNotMatch(String(out.response.aviso_critico ?? ""), /prueba/i);
  });

  it("cambiar una fórmula calc precio*2→precio*3 limpia la spec A y exige prueba", async () => {
    const calcHtml = '<!doctype html><html><head><title>Cotizador</title><meta name="description" content="x"></head><body><div data-ol-calc><input data-ol-val="precio" type="number" value="10"><output data-ol-out="precio * 2" aria-live="polite">20</output></div></body></html>';
    const { deps } = makeDeps({ data: { html: calcHtml } });
    const session = makeSession(calcHtml);
    session.behaviorSpec = [{ clic: "#accion-a", veces: 1, entonces: [{ donde: "#resultado-a", que: "cambia" }] }];
    const target = /<output[^>]*data-op-id="([^"]+)"/.exec(session.taggedHtml)?.[1];
    assert.ok(target, "output calc sin data-op-id");

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target, new_html: '<output data-ol-out="precio * 3" aria-live="polite">30</output>' }],
      resumen: "cambiar fórmula",
    });

    assert.equal(out.response.ok, true);
    assert.equal(session.behaviorSpec, null);
    assert.match(String(out.response.aviso_critico), /prueba/i);
  });

  it("intercambiar a↔b entre #ba/#bb no conserva la spec A", async () => {
    const html = '<!doctype html><html><head><title>Cupones</title><meta name="description" content="x"></head><body><code id="a">A</code><code id="b">B</code><button id="ba" data-ol-copy="a">Copiar A</button><button id="bb" data-ol-copy="b">Copiar B</button></body></html>';
    const { deps } = makeDeps({ data: { html } });
    const session = makeSession(html);
    session.behaviorSpec = [{ clic: "#ba", veces: 1, entonces: [{ donde: "#ba", que: "cambia" }] }];
    const ba = /<button[^>]*id="ba"[^>]*data-op-id="([^"]+)"/.exec(session.taggedHtml)?.[1];
    const bb = /<button[^>]*id="bb"[^>]*data-op-id="([^"]+)"/.exec(session.taggedHtml)?.[1];
    assert.ok(ba && bb, "controles copy sin data-op-id");

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [
        { op: "replace", target: ba, new_html: '<button id="ba" data-ol-copy="b">Copiar A</button>' },
        { op: "replace", target: bb, new_html: '<button id="bb" data-ol-copy="a">Copiar B</button>' },
      ],
      resumen: "intercambiar cupones",
    });

    assert.equal(out.response.ok, true);
    assert.equal(session.behaviorSpec, null);
    assert.match(String(out.response.aviso_critico), /prueba/i);
  });

  it("applies a replace op, persists, snapshots pre+post, re-tags", async () => {
    const { deps, store } = makeDeps();
    const session = makeSession();
    // Rust's tagWithOpIds appends data-op-id AFTER any pre-existing
    // attributes (verified against lib/html-ops.test.ts's fixtures), so
    // locate it order-agnostically rather than assuming it comes first.
    const target = /<h1[^>]*\bdata-op-id="([^"]+)"/.exec(session.taggedHtml)![1];
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target, new_html: `<h1 data-x="k">Tacos y Más</h1>` }],
      resumen: "titular nuevo",
    });
    assert.equal(out.response.ok, true);
    assert.ok(out.updatedHtml?.includes("Tacos y Más"));
    assert.ok(!out.updatedHtml?.includes("data-op-id"));
    assert.ok(store.data.html.includes("Tacos y Más"));
    assert.equal(store.versions.length, 2);
    assert.ok(session.taggedHtml.includes("Tacos y Más"));
    assert.ok(session.taggedHtml.includes("data-op-id"));
  });
  // 🔴 REGRESIÓN medida en un proyecto REAL el 2026-08-23 (Pomodoro, 60 ids
  // dentro de `data.html`). Un turno de SÓLO comportamiento no llama a
  // `applyOps` —que es quien quitaba los ids, por accidente y no por contrato—
  // y guardaba `session.taggedHtml` entero. El daño no era cosmético: es
  // PERMANENTE, porque `tag_with_op_ids` salta el elemento que ya lleva id sin
  // contarlo, y al turno siguiente la ruta responde 400 «no taggable elements»
  // del que ya no se sale. El proyecto quedaba imposible de editar.
  it("un edit de SOLO runtime no deja data-op-id en el documento guardado", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "editar_pagina", {
      edits: [
        { op: "replace", target: "runtime", new_html: "document.querySelector('h1');" },
      ],
      resumen: "solo comportamiento",
    });
    assert.equal(out.response.ok, true);
    assert.equal((out.response as { edits_aplicados?: number }).edits_aplicados, 0);
    assert.ok(!store.data.html.includes("data-op-id"), "data.html se guardo etiquetado");
    // Lo que de verdad importa: el documento guardado sigue siendo editable.
    assert.ok(tagWithOpIds(store.data.html).taggedCount > 0, "el proyecto quedo inservible");
  });

  // La otra mitad del arreglo, y el motivo por el que hace falta desetiquetar
  // en la puerta: sin esto no hay forma de recuperar un proyecto ya dañado.
  it("un documento YA etiquetado solo vuelve a ser editable si se desetiqueta", () => {
    const etiquetado = tagWithOpIds(HTML).taggedHtml;
    assert.equal(tagWithOpIds(etiquetado).taggedCount, 0);
    assert.ok(tagWithOpIds(stripOpIds(etiquetado)).taggedCount > 0);
  });

  // 🔴 LOS AVISOS SE PISABAN. Eran CUATRO claves `aviso_critico` sueltas en el
  // mismo objeto literal, así que la última ganaba en silencio: un turno que a
  // la vez descartaba ops contra la raíz y cambiaba el comportamiento sin
  // `prueba` sólo contaba UNA de las dos cosas. El comentario de
  // `persistHtmlChange` ya pedía lo contrario — «el modelo sigue viendo TODAS
  // las razones» — y el código decía otra cosa.
  it("dos problemas a la vez llegan LOS DOS al modelo", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    const raiz = /<body[^>]*\bdata-op-id="([^"]+)"/.exec(session.taggedHtml)?.[1] ?? "0";
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [
        { op: "replace", target: "runtime", new_html: "document.title = document.title;" },
        { op: "replace", target: raiz, new_html: "<body><p>toda la pagina</p></body>" },
      ],
      resumen: "dos problemas",
    });
    assert.equal(out.response.ok, true);
    const aviso = (out.response as { aviso_critico?: string }).aviso_critico ?? "";
    // (a) la op contra la raíz se descartó
    assert.match(aviso, /raiz|<body>|ENTERA/i);
    // (b) y cambió el comportamiento sin mandar `prueba`
    assert.match(aviso, /prueba/i);
  });

  it("rejects >8 edits without touching the doc", async () => {
    const { deps, store } = makeDeps();
    const edits = Array.from({ length: 9 }, () => ({ op: "delete", target: "zz" }));
    const out = await runAgentTool(makeSession(), deps, "editar_pagina", { edits, resumen: "x" });
    assert.equal(out.response.ok, false);
    assert.equal(store.saved.length, 0);
  });
  it("returns ok:false on a missing target (model can retry)", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "editar_pagina", {
      edits: [{ op: "replace", target: "nope", new_html: "<p>x</p>" }],
      resumen: "x",
    });
    assert.equal(out.response.ok, false);
  });
  it("blocks new_html carrying data-slot-path", async () => {
    const { deps, store } = makeDeps();
    const session = makeSession();
    const target = /<h1[^>]*\bdata-op-id="([^"]+)"/.exec(session.taggedHtml)![1];
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target, new_html: `<h1 data-slot-path="x">hack</h1>` }],
      resumen: "x",
    });
    assert.equal(out.response.ok, false);
    assert.equal(store.saved.length, 0);
  });

  // INVERTIDA el 2026-08-26. Fijaba que el `<iframe>` del modelo se borrara y
  // que se le AVISARA de que su mapa había muerto. El aviso era la disculpa por
  // la amputación: sin amputación no hay nada que disculpar.
  //
  // Es el mismo caso que `bakeMapEmbeds`, que existía para volver a meter el
  // iframe que el saneador acababa de quitar. Ahora el modelo escribe el mapa
  // y el mapa se queda.
  it("el <iframe> que escribe el modelo SE QUEDA, y no hay nada que avisar", async () => {
    const { deps, store } = makeDeps();
    const session = makeSession();
    const target = /<h1[^>]*\bdata-op-id="([^"]+)"/.exec(session.taggedHtml)![1];
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [
        {
          op: "replace",
          target,
          new_html: `<h1>Visítanos</h1><iframe src="https://maps.google.com/x"></iframe>`,
        },
      ],
      resumen: "mapa",
    });
    assert.equal(out.response.ok, true);
    assert.ok(store.data.html.includes("<iframe"), "se le borró el mapa al modelo");
    assert.equal(
      (out.response as { aviso?: string }).aviso,
      undefined,
      "avisó de una pérdida que ya no ocurre",
    );
  });

  // INVERTIDA por lo mismo. Este aviso llegó a ofrecerle al modelo una CONDUCTA
  // o «CSS puro» como alternativa a su propio JavaScript — el catálogo de
  // recetas existía justo porque no le dejábamos escribir un `<script>`. Las
  // conductas se retiraron y el script se queda.
  it("el <script> y el on* que escribe el modelo SE QUEDAN, sin aviso", async () => {
    const { deps, store } = makeDeps();
    const session = makeSession();
    const target = /<h1[^>]*\bdata-op-id="([^"]+)"/.exec(session.taggedHtml)![1];
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [
        {
          op: "replace",
          target,
          new_html: `<h1>Menú</h1><button onclick="open()">Abrir</button><script>wire()</script>`,
        },
      ],
      resumen: "menú",
    });
    assert.equal(out.response.ok, true);
    assert.ok(store.data.html.includes("wire()"), "se le borró el script");
    assert.ok(store.data.html.includes("onclick"), "se le borró el manejador");
    assert.equal(
      (out.response as { aviso?: string }).aviso,
      undefined,
      "avisó de una pérdida que ya no ocurre",
    );
  });

  it("stays quiet on a clean edit (no aviso to cry wolf with)", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    const target = /<h1[^>]*\bdata-op-id="([^"]+)"/.exec(session.taggedHtml)![1];
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target, new_html: `<h1>Tacos</h1>` }],
      resumen: "titular",
    });
    assert.equal(out.response.ok, true);
    assert.equal((out.response as { aviso?: string }).aviso, undefined);
  });

  // Task 16 — validateBehaviors wired into the SAME `aviso` channel a control
  // mal cableado que llega al documento guardado es otra vez un control
  // muerto, y el modelo debe enterarse en ESTE turno, no el visitante en la
  // página publicada.
  // Gate/request-surfaces Task 3 — the Agent is a fail-CLOSED surface: the
  // user's page already exists, so refusing an edit costs them the edit, not
  // the page. Until now a mis-wired conducta saved and only warned, which
  // meant the visitor could meet the dead control before the model ever
  // circled back. Now the document is refused and the stored page is
  // untouched; the same prose still reaches the model, as the error.
  it("refuses the edit when a data-ol-copy points at a missing id (dead at birth)", async () => {
    const { deps, store } = makeDeps();
    const session = makeSession();
    const before = store.data.html;
    const target = /<h1[^>]*\bdata-op-id="([^"]+)"/.exec(session.taggedHtml)![1];
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [
        { op: "replace", target, new_html: `<h1>Menú</h1><button data-ol-copy="cupon">Copiar</button>` },
      ],
      resumen: "boton copiar",
    });
    assert.equal(out.response.ok, false);
    assert.equal(store.saved.length, 0);
    assert.equal(store.data.html, before);
    const error = String((out.response as { error?: string }).error ?? "");
    // The reason must survive the refusal — a model told only "invalid"
    // cannot fix anything.
    assert.match(error, /cupon/);
    assert.match(error, /nacería muerto/i);
  });

  it("refuses the edit when a data-ol-countdown value isn't a valid ISO date", async () => {
    const { deps, store } = makeDeps();
    const session = makeSession();
    const target = /<h1[^>]*\bdata-op-id="([^"]+)"/.exec(session.taggedHtml)![1];
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [
        {
          op: "replace",
          target,
          new_html: `<h1>Oferta</h1><div data-ol-countdown="15 de agosto"><span data-ol-cd="days">00</span></div>`,
        },
      ],
      resumen: "countdown",
    });
    assert.equal(out.response.ok, false);
    assert.equal(store.saved.length, 0);
    assert.match(String((out.response as { error?: string }).error ?? ""), /fecha ISO válida/i);
  });

  it("una conducta bien cableada con su prueba instala esa spec y no llora lobo", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    const target = /<h1[^>]*\bdata-op-id="([^"]+)"/.exec(session.taggedHtml)![1];
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [
        {
          op: "replace",
          target,
          new_html: `<h1>Tacos</h1><code id="cupon-verano">TACOS20</code><button data-ol-copy="cupon-verano" aria-label="Copiar cupón">Copiar</button>`,
        },
      ],
      prueba: PRUEBA_B,
      resumen: "cupon correcto",
    });
    assert.equal(out.response.ok, true);
    assert.equal((out.response as { aviso?: string }).aviso, undefined);
    assert.equal((out.response as { aviso_critico?: string }).aviso_critico, undefined);
    assert.deepEqual(session.behaviorSpec, [
      { clic: "#accion-b", veces: 1, entonces: [{ donde: "#resultado-b", que: "cambia" }] },
    ]);
  });

  // ANTES componía DOS motivos: «te quité el script» + «tu conducta nace
  // muerta». El primero desapareció el 2026-08-26 — ya no se le quita el
  // script—, pero el segundo sigue siendo real y es el que importa: un
  // `data-ol-copy` que apunta a un id que no existe es un botón que nace
  // mudo. Lo que se conserva es que el rechazo DICE cuál es el id fantasma.
  it("un control cableado a un id fantasma se rechaza, y el error nombra el id", async () => {
    const { deps, store } = makeDeps();
    const session = makeSession();
    const target = /<h1[^>]*\bdata-op-id="([^"]+)"/.exec(session.taggedHtml)![1];
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [
        {
          op: "replace",
          target,
          new_html: `<h1>Menú</h1><script>wire()</script><button data-ol-copy="ghost">Copiar</button>`,
        },
      ],
      resumen: "compuesto",
    });
    assert.equal(out.response.ok, false);
    assert.equal(store.saved.length, 0);
    const error = String((out.response as { error?: string }).error ?? "");
    assert.match(error, /ghost/);
    assert.match(error, /nacería muerto/i);
    // Y NO se le reprocha el `<script>`: ya no se le quita, así que
    // mencionarlo sería mandarle a arreglar algo que no está roto.
    assert.ok(!/JavaScript/i.test(error), `el error habla de un JS que ya no se toca: ${error}`);
  });

  // ── op="attrs" y la red que la acompaña (2026-09-02) ──────────────────────
  //
  // EL FALLO, en producción: «centra la sección de entradas y quítale los dos
  // círculos del borde». Len lo entendió bien, pero para quitar una clase sólo
  // tenía `replace`, que sustituye el SUBÁRBOL — y la tarjeta desapareció con
  // sus precios dentro. Aquí se prueban las dos mitades de la cura: la op que
  // lo hace imposible, y la guarda para los `replace` que sigan existiendo.
  const TARJETA = `<!doctype html><html><head><title>Cumbre</title></head><body>
    <div data-x="card" class="ticket-stub rounded-2xl bg-white p-8">
      <p>Early bird</p>
      <p>$99 <span>$149</span></p>
      <p>OCT 15, 2026 · VIRTUAL · 9AM–5PM ET</p>
      <ul><li>Acceso a los 3 tracks</li><li>Grabaciones 12 meses</li><li>Comunidad privada</li></ul>
      <a href="#comprar">Comprar entrada</a>
    </div>
  </body></html>`;

  function tarjetaOpId(taggedHtml: string): string {
    const m = /<div[^>]*data-x="card"[^>]*data-op-id="([^"]+)"|<div[^>]*data-op-id="([^"]+)"[^>]*data-x="card"/.exec(taggedHtml);
    const id = m?.[1] ?? m?.[2];
    if (!id) throw new Error("no se encontró la tarjeta en el documento etiquetado");
    return id;
  }

  it('attrs quita una clase y NO toca el contenido — el fallo de producción, imposible', async () => {
    const { deps } = makeDeps();
    const session = makeSession({ html: TARJETA });
    const target = tarjetaOpId(session.taggedHtml);

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{
        op: "attrs",
        target,
        attrs: [{ name: "class", value: "rounded-2xl bg-white p-8 mx-auto" }],
      }],
      resumen: "centrar la tarjeta y quitarle los círculos",
    });

    assert.equal(out.response.ok, true);
    const html = String(out.updatedHtml);
    // La clase decorativa se fue y la de centrado entró...
    assert.ok(!/ticket-stub/.test(html), "la clase decorativa sigue ahí");
    assert.match(html, /mx-auto/);
    // ...y TODO lo de dentro sigue en su sitio. Esto es lo que `replace` perdía.
    assert.match(html, /\$99/);
    assert.match(html, /OCT 15, 2026/);
    assert.match(html, /Comunidad privada/);
    assert.match(html, /Comprar entrada/);
  });

  it("attrs con value null QUITA el atributo", async () => {
    const { deps } = makeDeps();
    const session = makeSession({ html: TARJETA });
    const target = tarjetaOpId(session.taggedHtml);

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "attrs", target, attrs: [{ name: "class", value: null }] }],
      resumen: "quitar la clase entera",
    });

    assert.equal(out.response.ok, true);
    assert.ok(!/ticket-stub/.test(String(out.updatedHtml)));
    assert.match(String(out.updatedHtml), /\$99/);
  });

  it("attrs sobre un target que no es un elemento se rechaza enseñando el camino", async () => {
    const { deps } = makeDeps();
    const session = makeSession({ html: TARJETA });

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "attrs", target: "styles", attrs: [{ name: "class", value: "x" }] }],
      resumen: "atributos del CSS",
    });

    assert.equal(out.response.ok, false);
    assert.match(String(out.response.error), /styles/);
  });

  it("attrs sin lista de atributos se rechaza diciendo qué falta", async () => {
    const { deps } = makeDeps();
    const session = makeSession({ html: TARJETA });
    const target = tarjetaOpId(session.taggedHtml);

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "attrs", target }],
      resumen: "sin attrs",
    });

    assert.equal(out.response.ok, false);
    assert.match(String(out.response.error), /attrs/);
  });

  // LA RED. `attrs` cierra el camino que causó el fallo, pero los `replace`
  // legítimos siguen existiendo y un modelo puede seguir truncando uno. Cuando
  // pase, el turno NO puede cerrar en silencio.
  it("un replace que vacía el nodo se guarda pero sale con aviso_critico", async () => {
    const { deps } = makeDeps();
    const session = makeSession({ html: TARJETA });
    const target = tarjetaOpId(session.taggedHtml);

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target, new_html: '<div class="rounded-2xl bg-white p-8 mx-auto"></div>' }],
      resumen: "centrar la tarjeta",
    });

    assert.equal(out.response.ok, true);
    const aviso = String(out.response.aviso_critico);
    assert.match(aviso, /VACI/i);
    // El aviso tiene que enseñar la salida buena, no sólo regañar.
    assert.match(aviso, /attrs/);
    assert.equal(out.response.contenido_perdido, 1);
  });

  it("un replace que conserva el contenido no dispara la guarda", async () => {
    const { deps } = makeDeps();
    const session = makeSession({ html: TARJETA });
    const target = tarjetaOpId(session.taggedHtml);

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{
        op: "replace",
        target,
        new_html: `<div class="rounded-2xl bg-white p-8 mx-auto"><p>Early bird</p><p>$99 <span>$149</span></p><p>OCT 15, 2026 · VIRTUAL · 9AM–5PM ET</p><ul><li>Acceso a los 3 tracks</li><li>Grabaciones 12 meses</li><li>Comunidad privada</li></ul><a href="#comprar">Comprar entrada</a></div>`,
      }],
      resumen: "centrar la tarjeta conservándolo todo",
    });

    assert.equal(out.response.ok, true);
    assert.equal(out.response.contenido_perdido, undefined);
  });
});

// Arreglo 1 (revisión final de rama) — la nómina de conductas ("countdown,
// filter, lightbox, copy, autoplay, theme, sticky", y el número "7") vivía
// hardcodeada en CUATRO sitios en prosa que el modelo lee, dos de ellos
// literalmente "siete" — la imagen especular del bug fundacional del
// proyecto. lib/conductas-heredadas/prose-derivation.test.ts (vitest, registro
// mockeado con una 8ª receta falsa) prueba los otros 3 sitios
// (design-guidance.ts, agent/catalog.ts, lib/conductas-heredadas/doc.ts); ESTE archivo
// no puede usar ese mecanismo porque importa el binding nativo de
// html-engine (ver el NB de arriba de todo el archivo), así que aquí se
// prueba la MISMA propiedad — "sanitizeAviso no tiene una copia propia de la
// lista" — con inyección de parámetro en vez de mockear el módulo.
describe("sanitizeAviso deriva su lista de conductas, no la hardcodea (Arreglo 1)", () => {
  it("interpola CUALQUIER lista que se le pase — no tiene una copia propia hardcodeada", () => {
    const aviso = sanitizeAviso(
      { scripts: 1, eventHandlers: 0, iframes: 0 },
      "confetti-fake-8th-behavior",
    );
    assert.match(aviso ?? "", /confetti-fake-8th-behavior/);
    assert.doesNotMatch(aviso ?? "", /countdown, filter/);
  });

  it("la llamada real (sin segundo argumento) usa BEHAVIOR_NAMES — la MISMA constante derivada que design-guidance.ts/agent/catalog.ts/lib/conductas-heredadas/doc.ts", () => {
    const aviso = sanitizeAviso({ scripts: 1, eventHandlers: 0, iframes: 0 });
    assert.ok(
      aviso?.includes(BEHAVIOR_NAMES),
      `aviso no contiene BEHAVIOR_NAMES ("${BEHAVIOR_NAMES}"): ${aviso}`,
    );
  });
});

describe("cambiar_tema", () => {
  it("applies an accent bundle, persists through the sanitize pipeline, re-tags", async () => {
    const { deps, store } = makeDeps({ data: { html: THEMED_HTML } });
    const session = makeSession();
    const out = await runAgentTool(session, deps, "cambiar_tema", { accent: "#e8743a" });
    assert.equal(out.response.ok, true);
    // The button path is the authority: the accent lands WCAG-nudged by
    // lookFromAccent (contrast-walked against the derived bg), not raw.
    const nudged = lookFromAccent("#e8743a").light["--ol-accent"];
    assert.ok(store.data.html!.includes(`--ol-accent: ${nudged}`));
    assert.ok(!store.data.html!.includes("data-op-id"));
    assert.ok(session.taggedHtml.includes("data-op-id"));
    assert.equal(store.versions.length, 2);
    assert.ok(out.updatedHtml);
  });
  it("rejects a non-hex accent as data", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "cambiar_tema", { accent: "rojo" });
    assert.equal(out.response.ok, false);
    assert.equal(store.saved.length, 0);
  });
  it("accent without modo keeps the page's current dark mode (button reads modeRef)", async () => {
    const darkDoc = THEMED_HTML.replace("<html>", `<html data-ol-mode="dark">`);
    const { deps, store } = makeDeps({ data: { html: darkDoc } });
    const out = await runAgentTool(makeSession(), deps, "cambiar_tema", { accent: "#e8743a" });
    assert.equal(out.response.ok, true);
    assert.match(store.data.html!, /<html[^>]*\sdata-ol-mode="dark"/);
    const dark = lookFromAccent("#e8743a").dark;
    assert.ok(store.data.html!.includes(`--ol-accent: ${dark["--ol-accent"]}`));
    assert.ok(store.data.html!.includes(`--ol-bg: ${dark["--ol-bg"]}`));
  });
  it("standalone modo:dark re-derives the bundle from the page's current accent + stamps the attr", async () => {
    const withAccent = THEMED_HTML.replace("<html>", `<html style="--ol-accent: #e8743a">`);
    const { deps, store } = makeDeps({ data: { html: withAccent } });
    const out = await runAgentTool(makeSession(), deps, "cambiar_tema", { modo: "dark" });
    assert.equal(out.response.ok, true);
    assert.match(store.data.html!, /<html[^>]*\sdata-ol-mode="dark"/);
    const dark = lookFromAccent("#e8743a").dark;
    assert.ok(store.data.html!.includes(`--ol-bg: ${dark["--ol-bg"]}`));
    assert.ok(store.data.html!.includes(`--ol-accent: ${dark["--ol-accent"]}`));
  });

  // ── LA PAGINA EN BLANCO ───────────────────────────────────────────────────
  // MEDIDO el 2026-08-22 en el brazo de CONTROL del experimento: 8 de 40 turnos
  // de «cambiame la tipografia» acabaron con el <body> reemplazado por el <link>
  // de la fuente. El documento guardado era `<html><head>…</head><link…></html>`
  // — sin titular, sin telefono, sin boton. El Chat llevaba el guardian desde
  // hacia meses; el Agente, que va ENCENDIDO por defecto, no.
  it("una op contra la RAIZ no se aplica: borraria la pagina entera", async () => {
    const { deps, store } = makeDeps();
    const session = makeSession();
    const raiz = firstOpId(session.taggedHtml); // <html> o <body>
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target: raiz, new_html: `<link rel="stylesheet" href="https://x">` }],
      resumen: "fuente",
    });
    assert.equal(out.response.ok, false);
    assert.equal(out.response.error, "op_contra_la_raiz");
    // Lo que importa: NO se guardo nada. La pagina del usuario sigue entera.
    assert.equal(store.saved.length, 0);
    // Y se le dice al modelo por donde SI se hace.
    assert.match(String(out.response.como_hacerlo), /target="styles"/);
  });

  it("si solo UNA op es contra la raiz, el resto del cambio SI se aplica", async () => {
    const { deps, store } = makeDeps();
    const session = makeSession();
    const raiz = firstOpId(session.taggedHtml);
    const contenido = contentOpId(session.taggedHtml);
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [
        { op: "replace", target: contenido, new_html: "<h1>Tacos El Güero</h1>" },
        { op: "replace", target: raiz, new_html: "<style>a{}</style>" },
      ],
      resumen: "dos cosas",
    });
    assert.equal(out.response.ok, true);
    assert.equal(out.response.edits_descartados, 1);
    // Guardar-y-AVISAR: perder una op en silencio es la degradacion prohibida.
    assert.match(String(out.response.aviso_critico), /pagina ENTERA/);
    assert.ok(store.data.html!.includes("Tacos El Güero"));
  });

  // MEDIDO el 2026-08-22: 171 de las 178 plantillas curadas no dicen var(--ol-*)
  // en ninguna parte. Sobre ellas esto devolvia `ok:true, tokens_aplicados:1` y
  // la pagina se quedaba IDENTICA — un cambio reportado que no ocurrio.
  it("no miente sobre una pagina que no lee tokens: se niega y señala el camino", async () => {
    const { deps, store } = makeDeps({ data: { html: HTML } });
    const out = await runAgentTool(makeSession(), deps, "cambiar_tema", { fuente: "editorial" });
    assert.equal(out.response.ok, false);
    assert.equal(out.response.error, "sin_tokens");
    // No basta con negarse: hay que decir como SI se hace, o el usuario queda
    // encerrado con la respuesta correcta.
    assert.match(String(out.response.como_hacerlo), /target="styles"/);
    // Y nada se guardo: la pagina queda byte-intacta.
    assert.equal(store.saved.length, 0);
  });

  it("si un rasgo vive y otro no, aplica el que vive y AVISA del muerto", async () => {
    // Lee el acento pero no la fuente.
    const medio = HTML.replace("</head>", "<style>a{color:var(--ol-accent)}</style></head>");
    const { deps, store } = makeDeps({ data: { html: medio } });
    const out = await runAgentTool(makeSession(), deps, "cambiar_tema", {
      accent: "#e8743a",
      fuente: "editorial",
    });
    assert.equal(out.response.ok, true);
    assert.deepEqual(out.response.sin_efecto, ["--ol-font-display"]);
    assert.match(String(out.response.aviso_critico), /no cambió/);
    assert.ok(store.data.html!.includes("--ol-accent: "));
  });

  // La fuente tiene que EXISTIR, no solo estar nombrada: sin su hoja el
  // navegador cae al generico y el usuario ve Times New Roman.
  it("carga la hoja de Google de la fuente que acaba de nombrar", async () => {
    const { deps, store } = makeDeps({ data: { html: THEMED_HTML } });
    const out = await runAgentTool(makeSession(), deps, "cambiar_tema", { fuente: "editorial" });
    assert.equal(out.response.ok, true);
    assert.ok(store.data.html!.includes("fonts.googleapis.com/css2?family=Fraunces"));
  });

  it("no duplica la hoja si la fuente ya estaba cargada", async () => {
    const ya = THEMED_HTML.replace(
      "</head>",
      `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:wght@700&display=swap"></head>`,
    );
    const { deps, store } = makeDeps({ data: { html: ya } });
    await runAgentTool(makeSession(), deps, "cambiar_tema", { fuente: "editorial" });
    assert.equal(store.data.html!.split("family=Fraunces").length - 1, 1);
  });
});

describe("aplicar_tematica", () => {
  it("stamps a kit, persists through sanitize, keeps settings intact, re-tags", async () => {
    const kit = TEMATICA_PRESETS[0];
    const { deps, store } = makeDeps({ data: { html: HTML, settings: { languages: ["en"] } } });
    const session = makeSession();
    const out = await runAgentTool(session, deps, "aplicar_tematica", { tematica: kit.id });
    assert.equal(out.response.ok, true);
    assert.ok(store.data.html!.includes(`data-ol-tematica="${kit.id}"`));
    assert.ok(store.data.html!.includes("<style data-ol-tematica"));
    assert.ok(!store.data.html!.includes("data-op-id"));
    // Testigo de que el kit no pisa OTROS ajustes. Era `motion`, que se
    // retiró el 2026-08-26; `languages` sirve igual y sigue existiendo.
    assert.deepEqual(store.data.settings?.languages, ["en"]);
    assert.equal(store.versions.length, 2);
    assert.ok(session.taggedHtml.includes("data-op-id"));
    assert.ok(out.updatedHtml?.includes(`data-ol-tematica="${kit.id}"`));
  });
  it('tematica:"quitar" strips a previously applied kit, leaves tokens alone', async () => {
    const kit = TEMATICA_PRESETS[0];
    const dressed = applyTematicaToHtml(HTML, kit.id) as { html: string };
    const { deps, store } = makeDeps({ data: { html: dressed.html } });
    const out = await runAgentTool(makeSession(), deps, "aplicar_tematica", { tematica: "quitar" });
    assert.equal(out.response.ok, true);
    assert.ok(!store.data.html!.includes("data-ol-tematica"));
    assert.ok(store.data.html!.includes(`--ol-accent: ${kit.tokens["--ol-accent"]}`));
  });
  it("rejects an unknown tematica id as data, without saving", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "aplicar_tematica", { tematica: "no-existe" });
    assert.equal(out.response.ok, false);
    assert.equal(store.saved.length, 0);
  });
});

// ── EL PLANO B NO DEJA DESTRUIR A CIEGAS ──────────────────────────────────
//
// Cuando la pagina no cabe en un turno, el modelo entra con SOLO EL INDICE: una
// linea por seccion, sin un byte de su contenido. Y el indice lista los hijos
// DIRECTOS de <body>, asi que en una pagina envuelta en un solo <div> —el patron
// mas comun de pagina generada por IA— ese indice es UNA LINEA, y esa linea es la
// pagina entera.
//
// El prompt le decia que podia «reemplazarla entera» y el unico freno era una
// frase pidiendole que no inventara. rejectDocumentWideOps no lo para: el
// envoltorio no es <html> ni <body>. Auditado el 2026-09-01, antes de que esta
// ruta llegara a correr en produccion.
describe("el plano B no deja destruir a ciegas", () => {
  // El envoltorio unico: todo el documento cuelga de un solo <div>.
  const ENVUELTA =
    '<html><body><div id="page"><header><h1>Grano Alto</h1></header>' +
    "<section><h2>Precios</h2><p>Desde 180</p></section>" +
    "<footer><p>Contacto</p></footer></div></body></html>";

  /** El id del envoltorio: la UNICA linea que veria el modelo en el indice. */
  function idEnvoltorio(tagged: string): string {
    const m = /<div[^>]*id="page"[^>]*data-op-id="([^"]+)"/.exec(tagged);
    if (!m) throw new Error("no se encontro el envoltorio etiquetado");
    return m[1];
  }
  function idSeccion(tagged: string): string {
    const m = /<section[^>]*data-op-id="([^"]+)"/.exec(tagged);
    if (!m) throw new Error("no se encontro la seccion etiquetada");
    return m[1];
  }
  function sesionPlanoB() {
    const session = makeSession({ html: ENVUELTA });
    session.entroACiegas = true;
    return session;
  }

  it("un replace contra una seccion que NO ha abierto se rechaza, y no guarda nada", async () => {
    const { deps, store } = makeDeps({ data: { html: ENVUELTA } });
    const session = sesionPlanoB();
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [
        {
          op: "replace",
          target: idEnvoltorio(session.taggedHtml),
          new_html: '<div id="page"><h1>Grano Alto</h1></div>',
        },
      ],
      resumen: "rehacer la pagina",
    });
    assert.equal(out.response.ok, false);
    assert.equal(out.response.error, "seccion_no_abierta");
    assert.equal(store.saved.length, 0);
    // Y el documento sigue entero: precios y pie donde estaban.
    assert.ok(store.data.html!.includes("Precios"));
    assert.ok(store.data.html!.includes("Contacto"));
  });

  it("un delete a ciegas tampoco pasa", async () => {
    const { deps, store } = makeDeps({ data: { html: ENVUELTA } });
    const session = sesionPlanoB();
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "delete", target: idEnvoltorio(session.taggedHtml) }],
      resumen: "quitar",
    });
    assert.equal(out.response.ok, false);
    assert.equal(out.response.error, "seccion_no_abierta");
    assert.equal(store.saved.length, 0);
  });

  it("insertar antes o despues sigue libre: no destruye nada y es lo que hace util al indice", async () => {
    const { deps, store } = makeDeps({ data: { html: ENVUELTA } });
    const session = sesionPlanoB();
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [
        {
          op: "insert_after",
          target: idEnvoltorio(session.taggedHtml),
          new_html: "<section><p>Aviso legal</p></section>",
        },
      ],
      resumen: "aviso",
    });
    assert.equal(out.response.ok, true);
    assert.ok(store.data.html!.includes("Aviso legal"));
  });

  it("y en cuanto la ABRE con leer_estado, el mismo replace se aplica", async () => {
    const { deps, store } = makeDeps({ data: { html: ENVUELTA } });
    const session = sesionPlanoB();
    const seccion = idSeccion(session.taggedHtml);
    const leida = await runAgentTool(session, deps, "leer_estado", { op_id: seccion });
    assert.ok(String((leida.response.seccion as { html?: string } | undefined)?.html).includes("Precios"));
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [
        { op: "replace", target: seccion, new_html: "<section><h2>Precios</h2><p>Desde 200</p></section>" },
      ],
      resumen: "subir el precio",
    });
    assert.equal(out.response.ok, true);
    assert.ok(store.data.html!.includes("Desde 200"));
  });

  // EL BRAZO DE CONTROL. Fuera del plano B el modelo tiene el documento entero
  // delante y no hay nada ciego: si esta guarda mordiera aqui, habria roto la
  // edicion normal, que es el 100% de los turnos que hoy funcionan.
  it("FUERA del plano B no cambia nada: con el documento delante el replace se aplica", async () => {
    const { deps, store } = makeDeps({ data: { html: ENVUELTA } });
    const session = makeSession({ html: ENVUELTA }); // sin soloIndice
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [
        {
          op: "replace",
          target: idSeccion(session.taggedHtml),
          new_html: "<section><h2>Precios</h2><p>Desde 250</p></section>",
        },
      ],
      resumen: "subir el precio",
    });
    assert.equal(out.response.ok, true);
    assert.ok(store.data.html!.includes("Desde 250"));
  });
});


// ── Y LO VISTO CADUCA EN CUANTO LOS IDS SE MUEVEN ─────────────────────────
//
// El agujero (auditado el 2026-09-01). Los `data-op-id` son un contador en
// orden de documento, asi que cualquier edicion los renumera de la herida hacia
// abajo. `session.idsVistos` no se vaciaba NUNCA, y eso convertia la guarda de
// arriba en un portillo que el modelo abria solo, con una edicion legitima:
//
//   <body 0><div 1><header 2><h1 3></header>
//     <section 4><h2 5><p 6>Desde 180</p></section>
//     <footer 7><p 8>Contacto</p></footer></div></body>
//
//   1. abre la seccion 4  -> vistos = {4, 5, 6}
//   2. borra el 6 (el <p> de dentro: legitimo, lo habia visto)
//   3. se re-etiqueta      -> AHORA EL <footer> ES EL 6
//   4. reemplaza el 6      -> pasaba, y se llevaba EL PIE por delante.
//
// Medido con el motor real antes de escribir esto.
describe("lo visto caduca cuando los ids se mueven", () => {
  const ENVUELTA_IDS =
    '<html><body><div id="page"><header><h1>Grano Alto</h1></header>' +
    "<section><h2>Precios</h2><p>Desde 180</p></section>" +
    "<footer><p>Contacto</p></footer></div></body></html>";

  function idDe(tagged: string, re: RegExp): string {
    const m = re.exec(tagged);
    if (!m) throw new Error(`no se encontro el elemento: ${re}`);
    return m[1]!;
  }
  const idSeccion = (t: string) => idDe(t, /<section[^>]*data-op-id="([^"]+)"/);
  const idParrafoInterno = (t: string) =>
    idDe(t, /<p[^>]*data-op-id="([^"]+)"[^>]*>Desde 180/);
  const idHeader = (t: string) => idDe(t, /<header[^>]*data-op-id="([^"]+)"/);

  function sesion() {
    const session = makeSession({ html: ENVUELTA_IDS });
    session.entroACiegas = true;
    return session;
  }

  // 🔴 REESCRITA EL 2026-09-03, y el motivo importa.
  //
  // Antes decia: «un id que se desplazo sobre OTRA seccion deja de valer para
  // destruir». Sujetaba que la guarda CAZABA el desplazamiento — borrabas un
  // parrafo, el id pasaba a ser el <footer>, y `rejectBlindOps` impedia
  // reemplazar un pie que el modelo no habia abierto.
  //
  // Con ids estables ese desplazamiento YA NO OCURRE: un id no se reutiliza
  // jamas (`tagger.rs` acuna por encima del maximo), asi que el id borrado
  // simplemente deja de existir. El incidente pasa de detectado a IMPOSIBLE, y
  // esta prueba sujeta eso — que es mas fuerte, no menos.
  it("un id borrado no aparece en otra seccion: deja de existir, punto", async () => {
    const { deps, store } = makeDeps({ data: { html: ENVUELTA_IDS } });
    const session = sesion();

    // 1. Abre la seccion. A partir de aqui ha visto la seccion y sus hijos.
    const seccion = idSeccion(session.taggedHtml);
    const borradoId = idParrafoInterno(session.taggedHtml);
    await runAgentTool(session, deps, "leer_estado", { op_id: seccion });

    // 2. Borra el parrafo de dentro: legitimo, lo tenia delante.
    const borrado = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "delete", target: borradoId }],
      resumen: "quitar el precio viejo",
    });
    assert.equal(borrado.response.ok, true);
    assert.ok(!store.data.html!.includes("Desde 180"));

    // 3. LA PROPIEDAD NUEVA: ese id no es ahora otro elemento — no es NINGUNO.
    const ahora = new RegExp(`<([a-zA-Z0-9-]+)[^>]*data-op-id="${borradoId}"`).exec(
      session.taggedHtml,
    );
    assert.equal(ahora, null, `el id borrado reaparecio: ${session.taggedHtml}`);

    // 4. Y usarlo no destruye nada: falla limpio, con el pie intacto.
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [
        { op: "replace", target: borradoId, new_html: "<footer><p>Otro</p></footer>" },
      ],
      resumen: "cambiar el pie",
    });
    assert.equal(out.response.ok, false);
    assert.ok(store.data.html!.includes("Contacto"));
    assert.ok(!store.data.html!.includes("Otro"));
  });

  it("y en cuanto ABRE el pie con su id nuevo, el mismo replace se aplica", async () => {
    const { deps, store } = makeDeps({ data: { html: ENVUELTA_IDS } });
    const session = sesion();
    const seccion = idSeccion(session.taggedHtml);
    const desplazado = idParrafoInterno(session.taggedHtml);
    await runAgentTool(session, deps, "leer_estado", { op_id: seccion });
    await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "delete", target: desplazado }],
      resumen: "quitar el precio viejo",
    });

    await runAgentTool(session, deps, "leer_estado", { op_id: desplazado });
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [
        { op: "replace", target: desplazado, new_html: "<footer><p>Otro</p></footer>" },
      ],
      resumen: "cambiar el pie",
    });
    assert.equal(out.response.ok, true);
    assert.ok(store.data.html!.includes("Otro"));
  });

  // EL BRAZO DE CONTROL, y la razon de que NO se vacie en cada re-etiquetado.
  //
  // Una lectura no cambia el documento, asi que la numeracion es la misma y lo
  // que el modelo abrio SIGUE abierto. Vaciar ahi le obligaria a reabrir cada
  // seccion en cada lectura — que en el plano B, donde cada lectura cuesta un
  // viaje, es justo lo que no se puede pagar.
  it("una lectura que NO cambia el documento no le hace olvidar lo abierto", async () => {
    const { deps, store } = makeDeps({ data: { html: ENVUELTA_IDS } });
    const session = sesion();
    const seccion = idSeccion(session.taggedHtml);

    // Abre la seccion, y despues MIRA otra cosa.
    await runAgentTool(session, deps, "leer_estado", { op_id: seccion });
    await runAgentTool(session, deps, "leer_estado", {
      op_id: idHeader(session.taggedHtml),
    });

    // La seccion que abrio primero sigue siendo suya.
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [
        {
          op: "replace",
          target: seccion,
          new_html: "<section><h2>Precios</h2><p>Desde 220</p></section>",
        },
      ],
      resumen: "subir el precio",
    });
    assert.equal(out.response.ok, true, JSON.stringify(out.response));
    assert.ok(store.data.html!.includes("Desde 220"));
  });

  // Cambiar de pagina tambien renumera: los ids de la Home no valen en la nueva.
  it("cambiar de pagina tambien caduca lo visto", async () => {
    const { deps } = makeDeps({
      data: {
        html: ENVUELTA_IDS,
        pages: {
          precios: { title: "Precios", html: "<html><body><main><p>Otra</p></main></body></html>" },
        },
      },
    });
    const session = sesion();
    await runAgentTool(session, deps, "leer_estado", {
      op_id: idSeccion(session.taggedHtml),
    });
    assert.ok((session.idsVistos?.size ?? 0) > 0, "sanity: abrio algo");

    await runAgentTool(session, deps, "trabajar_en_pagina", { pagina: "precios" });
    assert.equal(
      session.idsVistos,
      undefined,
      "al mudarse de pagina, los ids de la anterior no pueden seguir contando",
    );
  });
});
describe("leer_estado", () => {
  it("returns fresh module state after a mutation", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    // El ejemplo era Reservas (retirada el 2026-08-21) y luego Colecciones
    // (retirada el 2026-08-29). Lo que esta prueba vigila —que `leer_estado`
    // vea la mutación del turno anterior y no una copia rancia— sigue vivo con
    // cualquier módulo; hoy el único es `chat`.
    await runAgentTool(session, deps, "activar_modulo", { modulo: "chat" });
    const out = await runAgentTool(session, deps, "leer_estado", {});
    assert.equal((out.response.modulos as Record<string, boolean>).chat, true);
  });
  it("incluir_documento returns a freshly tagged doc", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "leer_estado", { incluir_documento: true });
    assert.ok(String(out.response.documento).includes("data-op-id"));
  });
  // 🔴 MIRAR OTRA PÁGINA SIN MUDARSE — 2026-08-31.
  //
  // Hasta hoy el Agente sólo veía la ACTIVA: para saber cómo estaba el navbar
  // de otra necesitaba `trabajar_en_pagina` + `leer_estado` (dos vueltas del
  // bucle, cada una reenviando el historial) y otras dos para volver. Jesús lo
  // reportó como «los links entre páginas fallan y se come muchos tokens»: le
  // pidió arreglar el logo, se arregló en la Home, y /nosotros quedó igual.
  //
  // Es el modelo de v0 y Lovable —bajo demanda, nunca por adelantado—,
  // comprobado antes de elegirlo.
  describe("ver_pagina", () => {
    const conSub: ProjectData = {
      html: "<html><body><h1>Home</h1></body></html>",
      pages: {
        nosotros: {
          slug: "nosotros",
          title: "Nosotros",
          html: '<html><body><header><a href="#">Logo</a></header></body></html>',
        },
      },
    } as ProjectData;

    it("devuelve el documento de OTRA página", async () => {
      const { deps } = makeDeps({ data: conSub });
      const out = await runAgentTool(makeSession(), deps, "leer_estado", {
        ver_pagina: "nosotros",
      });
      const vista = out.response.pagina_vista as { pagina: string; documento: string };
      assert.equal(vista.pagina, "nosotros");
      assert.ok(vista.documento.includes('href="#"'), "no trae el HTML de la subpágina");
    });

    it("SIN data-op-id: es para mirar, no para editar", async () => {
      const { deps } = makeDeps({ data: conSub });
      const out = await runAgentTool(makeSession(), deps, "leer_estado", {
        ver_pagina: "nosotros",
      });
      const vista = out.response.pagina_vista as { documento: string };
      assert.ok(!vista.documento.includes("data-op-id"), "vino etiquetado");
    });

    // 🔴 BRAZO DE CONTROL, y es la propiedad que da nombre a la herramienta: el
    // foco NO se mueve. Si `ver_pagina` mudara la sesión, el siguiente
    // `editar_pagina` escribiría en la página equivocada — silenciosamente.
    it("y NO mueve el foco: la sesión sigue donde estaba", async () => {
      const { deps } = makeDeps({ data: conSub });
      const session = makeSession();
      await runAgentTool(session, deps, "leer_estado", { ver_pagina: "nosotros" });
      assert.equal(session.page, null, "ver_pagina movió la sesión");
      const out = await runAgentTool(session, deps, "leer_estado", {});
      assert.equal(out.response.pagina_activa, "principal");
    });

    it("una página que no existe dice cuáles hay", async () => {
      const { deps } = makeDeps({ data: conSub });
      const out = await runAgentTool(makeSession(), deps, "leer_estado", {
        ver_pagina: "inventada",
      });
      assert.equal(out.response.ok, false);
      assert.ok(String(out.response.error).includes("nosotros"));
    });

    it("y sin `ver_pagina` la respuesta es la de siempre", async () => {
      const { deps } = makeDeps({ data: conSub });
      const out = await runAgentTool(makeSession(), deps, "leer_estado", {});
      assert.equal(out.response.pagina_vista, undefined);
    });
  });

  it("pagina_activa is 'principal' on home", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "leer_estado", {});
    assert.equal(out.response.pagina_activa, "principal");
  });
  // ⚰️ Aquí vivía su gemela: «el bloque negocio viaja en cada leer_estado
  // cuando hay perfil real». Se fue con el perfil el 2026-08-31, y ésta —que
  // ya existía como su brazo de control— pasa a ser el invariante entero: el
  // ESTADO no lleva un bloque `negocio`, nunca.
  it("el ESTADO nunca lleva un bloque `negocio`", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "leer_estado", {});
    assert.ok(!("negocio" in out.response));
  });
  it("pagina_activa is the slug on a subpage, and incluir_documento re-tags THAT subpage's html", async () => {
    const data: ProjectData = { html: HTML, pages: { menu: { html: "<html><body><h1>Menú</h1></body></html>" } } };
    const { deps } = makeDeps({ data });
    const session = makeSession({ page: "menu", html: data.pages!.menu.html });
    const out = await runAgentTool(session, deps, "leer_estado", { incluir_documento: true });
    assert.equal(out.response.pagina_activa, "menu");
    assert.ok(String(out.response.documento).includes("Menú"));
    assert.ok(!String(out.response.documento).includes("Tacos El Güero"));
  });
});

// RETIRADOS el 2026-08-26 con motion, música y 3D: las tres herramientas de
// settings salieron del catálogo del Agente. Eran presets nuestros que suplían
// el JavaScript prohibido —una coreografía de scroll, un reproductor flotante
// y una escena WebGL— y el modelo ahora los escribe dentro del documento,
// pudiendo hacer EL que la página pide en vez de uno de cuatro.

describe("preparar_marketing", () => {
  it("sets register+match and points at the marketing tab", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "preparar_marketing", { registro: "general", combinar: true });
    assert.equal(out.response.ok, true);
    assert.equal(store.data.settings?.marketing?.register, "general");
    assert.equal(out.response.pestana, "marketing");
  });
  it("invalid register comes back as data", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "preparar_marketing", { registro: "no-existe" });
    assert.equal(out.response.ok, false);
  });
});

describe("crear_pagina", () => {
  // 🔴 UN MÓDULO RETIRADO NO PUEDE ACABAR EN UNA PÁGINA EN BLANCO.
  //
  // El esquema anunciaba modulo="bookings" (Reservas se retiró el 2026-08-21)
  // y el boundary lo convertía en undefined SIN DECIR NADA. El core contestaba
  // entonces "se requiere slug, titulo o modulo" —un error de argumentos que
  // no menciona Reservas— así que el modelo reintentaba con slug y título y
  // creaba una página genérica vacía, dándole al dueño la apariencia de haber
  // atendido su petición. Los evals ya castigaban esa mentira; el esquema la
  // provocaba.
  it("un modulo retirado se RECHAZA nombrándolo, y no crea nada", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "crear_pagina", {
      modulo: "bookings",
      titulo: "Reservas",
    });
    assert.equal(out.response.ok, false);
    // El error tiene que decir QUÉ pasa, no un genérico de argumentos: es lo
    // único que impide que el modelo reintente y fabrique la página vacía.
    assert.match(String(out.response.error), /SE RETIRARON|ya no existe|no existe un módulo/i);
    assert.match(String(out.response.error), /honestidad/i);
    assert.equal(store.saved.length, 0);
    assert.equal(Object.keys(store.data.pages ?? {}).length, 0);
  });

  // 🔴 ESTA PRUEBA SE INVIRTIÓ, no se borró.
  //
  // Decía «y collections, que SÍ existe, sigue naciendo con su sección». Era
  // cierto hasta el 2026-08-29: ese día se retiraron las Colecciones y con
  // ellas `PAGE_MODULES` entero, o sea que `crear_pagina` YA NO NACE NINGUNA
  // página de módulo. La prueba se quedó pidiendo lo contrario y llevaba días
  // en rojo, arrastrando con ella la señal de las otras 610.
  //
  // Lo que hay que clavar ahora es lo de al lado: que `collections` se rechace
  // NOMBRÁNDOSE, igual que `bookings`. Si el rechazo fuera un genérico de
  // argumentos, el modelo reintentaría y acabaría fabricando la página vacía —
  // que es el fallo que el test de arriba existe para impedir.
  it("y collections, que TAMBIÉN se retiró, se rechaza igual", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "crear_pagina", { modulo: "collections" });
    assert.equal(out.response.ok, false);
    assert.match(String(out.response.error), /SE RETIRARON|ya no existe|no existe un módulo/i);
    assert.equal(store.saved.length, 0);
  });

  it("creates a page from the home shell and saves, deriving the slug from titulo when absent", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "crear_pagina", { titulo: "Sobre Nosotros" });
    assert.equal(out.response.ok, true);
    assert.equal(out.response.slug, "sobre-nosotros");
    assert.equal(out.action?.tool, "crear_pagina");
    assert.ok(store.data.pages?.["sobre-nosotros"]);
    assert.equal(store.saved.length, 1);
  });

  it("🔴 deja la sesión TRABAJANDO en la página nueva, no en la Home", async () => {
    // El modo de fallo no era un error, era peor: el modelo llamaba a
    // `editar_pagina` justo después con los op-ids de la HOME y las ediciones
    // entraban ahí. «Créame /pricing con tres planes» te metía los planes en
    // la portada y te dejaba /pricing vacía al lado. Sólo se salvaba si el
    // modelo encadenaba `trabajar_en_pagina` por su cuenta.
    const session = makeSession();
    const { deps } = makeDeps();
    const out = await runAgentTool(session, deps, "crear_pagina", { slug: "pricing" });

    assert.equal(out.response.ok, true);
    assert.equal(session.page, "pricing");
    assert.equal(out.page, "pricing");
    // Y el documento activo es el nuevo, no el de la Home: sin esto los
    // op-ids del siguiente `editar_pagina` seguirían apuntando a la portada.
    assert.ok(session.taggedHtml.includes("data-op-id"));
    // El shell viene de la Home pero el CONTENIDO no: el párrafo de la
    // portada no puede estar en la página nueva.
    assert.ok(!session.taggedHtml.includes("Los mejores del barrio"));
    // El lienzo del taller sigue al foco.
    assert.equal(typeof out.updatedHtml, "string");
    assert.ok((out.updatedHtml ?? "").length > 0);
  });

  it("y se lo DICE al modelo, para que no describa un cambio en la página equivocada", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "crear_pagina", { slug: "pricing" });
    assert.equal(out.response.pagina_activa, "pricing");
    assert.match(String(out.response.nota), /ya no valen|leer_estado/);
  });


  it("surfaces exists/limit/reserved-slug errors as data, without saving", async () => {
    const { deps: depsExists } = makeDeps({ data: { html: HTML, pages: { menu: { html: "<html>x</html>" } } } });
    const exists = await runAgentTool(makeSession(), depsExists, "crear_pagina", { slug: "menu" });
    assert.equal(exists.response.ok, false);

    const { deps: depsReserved, store: storeReserved } = makeDeps();
    const reserved = await runAgentTool(makeSession(), depsReserved, "crear_pagina", { slug: "cuenta" });
    assert.equal(reserved.response.ok, false);
    assert.equal(storeReserved.saved.length, 0);

    const pages: Record<string, { html: string }> = {};
    for (let i = 0; i < 20; i++) pages[`p${i}`] = { html: "<html>x</html>" };
    const { deps: depsLimit } = makeDeps({ data: { html: HTML, pages } });
    const limit = await runAgentTool(makeSession(), depsLimit, "crear_pagina", { slug: "one-more" });
    assert.equal(limit.response.ok, false);
  });

  it("no home html comes back as data, not a throw", async () => {
    const { deps } = makeDeps({ data: { html: "" } });
    const out = await runAgentTool(makeSession(), deps, "crear_pagina", { slug: "menu" });
    assert.equal(out.response.ok, false);
  });
});

// ── mirar_pagina: el derecho a preguntar ────────────────────────────────────
//
// 🔴 MEDIDO el 2026-09-02: con un veredicto de contraste que el medidor se
// había inventado, el Agente releyó el documento CINCO veces y teorizó seis
// sobre el velo del hero antes de rendirse y pintar media portada de sólido.
// No es un modelo tonto: es un modelo con una pregunta que no puede hacer.
describe("mirar_pagina", () => {
  it("tipo=medir devuelve la respuesta y NO toca la página", async () => {
    const { deps } = makeDeps();
    const vistas: unknown[] = [];
    const conOjos = {
      ...deps,
      observarPagina: async (input: unknown) => {
        vistas.push(input);
        return { respuesta: "detrás del titular se pinta rgb(11, 18, 32)" };
      },
    };
    const out = await runAgentTool(makeSession(), conOjos, "mirar_pagina", {
      tipo: "medir",
      pregunta: "¿qué color se pinta detrás del titular?",
    });
    assert.equal(out.response.ok, true);
    assert.match(String(out.response.respuesta), /rgb\(11, 18, 32\)/);
    // Read-only de verdad: ni tarjeta de acción ni documento nuevo.
    assert.equal(out.action, undefined);
    assert.equal(out.updatedHtml, undefined);
    assert.equal(vistas.length, 1);
    assert.equal((vistas[0] as { tipo: string }).tipo, "medir");
  });

  it("pasa la zona cuando se da, y no la inventa cuando no", async () => {
    const { deps } = makeDeps();
    const vistas: Record<string, unknown>[] = [];
    const conOjos = {
      ...deps,
      observarPagina: async (input: Record<string, unknown>) => {
        vistas.push(input);
        return { respuesta: "se ven tres cajas de color plano" };
      },
    };
    await runAgentTool(makeSession(), conOjos, "mirar_pagina", {
      tipo: "describir", pregunta: "¿qué hay?", zona: "las tarjetas",
    });
    await runAgentTool(makeSession(), conOjos, "mirar_pagina", {
      tipo: "describir", pregunta: "¿qué hay?",
    });
    assert.equal(vistas[0].zona, "las tarjetas");
    assert.equal("zona" in vistas[1], false);
  });

  // El tope de `describir` es 2 porque GASTA. Pasado el tope se endurece la
  // respuesta, no se bloquea la llamada — misma doctrina que elegir_foto.
  it("pasado el tope de describir, endurece la respuesta sin fallar", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    const conOjos = { ...deps, observarPagina: async () => ({ respuesta: "se ve algo" }) };
    for (let i = 0; i < 2; i++) {
      const ok = await runAgentTool(session, conOjos, "mirar_pagina", {
        tipo: "describir", pregunta: "¿?",
      });
      assert.equal(ok.response.ok, true, `la mirada #${i + 1} no debería estar topada`);
      assert.equal(ok.response.nota, undefined);
    }
    const tercera = await runAgentTool(session, conOjos, "mirar_pagina", {
      tipo: "describir", pregunta: "¿?",
    });
    assert.equal(tercera.response.ok, true);
    assert.match(String(tercera.response.nota), /demasiadas miradas/i);
  });

  // Y los dos topes son INDEPENDIENTES: gastar el de la cara no puede dejar al
  // Agente sin la medición, que es gratis y es la que de verdad desatasca.
  it("agotar describir NO agota medir", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    const conOjos = { ...deps, observarPagina: async () => ({ respuesta: "dato" }) };
    for (let i = 0; i < 3; i++) {
      await runAgentTool(session, conOjos, "mirar_pagina", { tipo: "describir", pregunta: "¿?" });
    }
    const medida = await runAgentTool(session, conOjos, "mirar_pagina", {
      tipo: "medir", pregunta: "¿qué hay detrás del titular?",
    });
    assert.equal(medida.response.respuesta, "dato");
    assert.equal(medida.response.nota, undefined);
  });

  it("un tipo que no existe se rechaza diciendo cuáles hay", async () => {
    const { deps } = makeDeps();
    const conOjos = { ...deps, observarPagina: async () => ({ respuesta: "x" }) };
    const out = await runAgentTool(makeSession(), conOjos, "mirar_pagina", {
      tipo: "adivinar", pregunta: "¿?",
    });
    assert.equal(out.response.ok, false);
    assert.match(String(out.response.error), /medir/);
    assert.match(String(out.response.error), /describir/);
  });

  it("sin la dependencia inyectada lo DICE, no revienta", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "mirar_pagina", {
      tipo: "medir", pregunta: "¿?",
    });
    assert.equal(out.response.ok, false);
    assert.match(String(out.response.error), /no está disponible/i);
  });

  // 🔴 «No se pudo mirar» NO puede leerse como «está bien». Es exactamente el
  // defecto que los ojos ya arreglaron una vez (`no_mirado`), y repetirlo aquí
  // sería reintroducirlo por la puerta de al lado.
  it("si la mirada falla, no devuelve un visto bueno", async () => {
    const { deps } = makeDeps();
    const conOjos = { ...deps, observarPagina: async () => null };
    const out = await runAgentTool(makeSession(), conOjos, "mirar_pagina", {
      tipo: "medir", pregunta: "¿?",
    });
    assert.equal(out.response.ok, false);
    assert.match(String(out.response.error), /no lo tomes como que está bien/i);
  });
});

describe("elegir_foto", () => {
  it("returns up to 6 fotos with absolute urls, no action card, no persistence", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "elegir_foto", {});
    assert.equal(out.response.ok, true);
    const fotos = out.response.fotos as { url: string; alt: string; estilo: string }[];
    assert.ok(fotos.length > 0);
    assert.ok(fotos.length <= 6);
    assert.ok(fotos[0].url.startsWith("https://images.openlen.com/"));
    assert.ok(fotos[0].estilo);
    assert.equal(out.action, undefined);
    assert.equal(out.updatedHtml, undefined);
    assert.equal(store.saved.length, 0);
    assert.equal(store.manifestFetches, 1);
  });

  it("filters by estilo through deps.fetchImageManifest", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "elegir_foto", { estilo: "claymorph" });
    assert.equal(out.response.ok, true);
    const fotos = out.response.fotos as { estilo: string }[];
    assert.ok(fotos.length >= 1);
    assert.ok(fotos.every((f) => f.estilo === "claymorph"));
  });

  it("filters by busqueda against alt/id/family", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "elegir_foto", { busqueda: "portfolio" });
    assert.equal(out.response.ok, true);
    const fotos = out.response.fotos as { url: string }[];
    assert.equal(fotos.length, 1);
    assert.ok(fotos[0].url.includes("warm-glassy"));
  });

  it("empty results come back ok:true with an empty list and a helpful nota", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "elegir_foto", { busqueda: "esto-no-existe-en-el-catalogo" });
    assert.equal(out.response.ok, true);
    assert.deepEqual(out.response.fotos, []);
    assert.ok(typeof out.response.nota === "string" && (out.response.nota as string).length > 0);
  });

  it("2nd empty search pivots the model off the hunt toward a real fallback", async () => {
    // The terror-hero bug: repeated empty searches for a genre the catalog
    // lacks used to keep saying "try another term" until the turn cap. Now the
    // first empty is still exploratory, but the second flips to a pivot note
    // that names concrete alternatives so the model stops hunting.
    const { deps } = makeDeps();
    const session = makeSession(); // shared across calls — the per-turn counter accumulates
    const first = await runAgentTool(session, deps, "elegir_foto", { busqueda: "terror-que-no-existe" });
    const second = await runAgentTool(session, deps, "elegir_foto", { busqueda: "horror-tampoco" });
    assert.deepEqual(first.response.fotos, []);
    assert.deepEqual(second.response.fotos, []);
    assert.equal(session.photoSearchesThisTurn, 2);
    // First: exploratory (no fallback tools named). Second: pivot.
    assert.ok(!/cambiar_tema|aplicar_tematica/.test(String(first.response.nota)));
    assert.match(String(second.response.nota), /cambiar_tema|aplicar_tematica|editar_pagina/);
  });

  it("hard-stops photo searches past the per-turn ceiling", async () => {
    // Backstop so a search-only chain can't spin toward the loop's absolute
    // cap (which would surface a red error): past the ceiling elegir_foto stops
    // returning fresh results even for a query that WOULD match.
    const { deps } = makeDeps();
    const session = makeSession();
    let last: Awaited<ReturnType<typeof runAgentTool>> | undefined;
    for (let i = 0; i < 8; i++) {
      last = await runAgentTool(session, deps, "elegir_foto", { estilo: "claymorph" });
    }
    assert.equal(last!.response.ok, true);
    assert.deepEqual(last!.response.fotos, []);
    assert.match(String(last!.response.nota), /demasiadas|deja de buscar/i);
  });

  it("a malformed manifest comes back as an empty list, not a throw", async () => {
    const { deps } = makeDeps({ imageManifest: { images: "not-an-array" } });
    const out = await runAgentTool(makeSession(), deps, "elegir_foto", {});
    assert.equal(out.response.ok, true);
    assert.deepEqual(out.response.fotos, []);
  });
});

describe("urlIsPageImage", () => {
  const U = "https://images.openlen.com/orig-photo.webp";
  it("rejects a url that only appears as body text (no fetch path)", () => {
    assert.equal(urlIsPageImage(`<p>mira ${U} qué linda</p>`, U), false);
  });
  it("accepts a url used as an img src", () => {
    assert.equal(urlIsPageImage(`<img src="${U}" alt="x">`, U), true);
  });
  it("accepts og:image content, preload href, srcset and css url()", () => {
    assert.equal(urlIsPageImage(`<meta property="og:image" content="${U}">`, U), true);
    assert.equal(urlIsPageImage(`<link rel="preload" as="image" href="${U}">`, U), true);
    assert.equal(urlIsPageImage(`<img srcset="${U} 1x, https://x/y 2x">`, U), true);
    assert.equal(urlIsPageImage(`<div style="background:url('${U}')"></div>`, U), true);
  });
  it("rejects a url that is only a PREFIX of a longer on-page url", () => {
    assert.equal(urlIsPageImage(`<img src="${U}?v=2&extra=1">`, U), false);
    assert.equal(urlIsPageImage(`<img srcset="${U}-large.webp 2x">`, U), false);
  });
});

describe("editar_imagen", () => {
  it("rejects a url not present in the document, without fetching or saving", async () => {
    const { deps, store } = makeDeps({ data: { html: IMG_HTML } });
    const session = makeSession(IMG_HTML);
    const out = await runAgentTool(session, deps, "editar_imagen", {
      imagen_url: "https://evil.com/not-in-doc.png",
      instruccion: "quita el logo",
    });
    assert.equal(out.response.ok, false);
    assert.equal(store.fetches.length, 0);
    assert.equal(store.imageEdits.length, 0);
    assert.equal(store.uploads.length, 0);
    assert.equal(store.saved.length, 0);
  });

  it("happy path: fetch→edit→upload→swap, persists the new url, versions=2, re-tags, card present", async () => {
    const { deps, store } = makeDeps({ data: { html: IMG_HTML } });
    const session = makeSession(IMG_HTML);
    const out = await runAgentTool(session, deps, "editar_imagen", {
      imagen_url: IMG_URL,
      instruccion: "quita el logo del fondo",
    });
    assert.equal(out.response.ok, true);
    assert.equal(out.response.nueva_url, "https://images.openlen.com/edited-123.webp");
    // The exact source URL is swapped for the new asset URL in the saved doc.
    assert.ok(store.data.html.includes("https://images.openlen.com/edited-123.webp"));
    assert.ok(!store.data.html.includes(IMG_URL));
    // pre-edit + post-edit snapshots.
    assert.equal(store.versions.length, 2);
    // Re-tagged for the next edit.
    assert.ok(session.taggedHtml.includes("https://images.openlen.com/edited-123.webp"));
    assert.ok(session.taggedHtml.includes("data-op-id"));
    assert.ok(!out.updatedHtml?.includes("data-op-id"));
    assert.ok(out.updatedHtml?.includes("edited-123.webp"));
    assert.equal(out.action?.tool, "editar_imagen");
    assert.equal(out.action?.ok, true);
    // The edit ran with the session user and the instruction as the prompt.
    assert.equal(store.imageEdits.length, 1);
    assert.equal(store.imageEdits[0].userId, "u1");
    assert.equal(store.imageEdits[0].prompt, "quita el logo del fondo");
    assert.equal(store.uploads.length, 1);
    assert.equal(store.uploads[0].projectId, "p1");
    assert.equal(session.imageEditsThisTurn, 1);
  });

  it("refuses a second edit in the same turn (per-turn cap), without fetching again", async () => {
    const { deps, store } = makeDeps({ data: { html: IMG_HTML } });
    const session = makeSession(IMG_HTML);
    const first = await runAgentTool(session, deps, "editar_imagen", {
      imagen_url: IMG_URL,
      instruccion: "quita el logo",
    });
    assert.equal(first.response.ok, true);
    const fetchesAfterFirst = store.fetches.length;
    const second = await runAgentTool(session, deps, "editar_imagen", {
      imagen_url: IMG_URL,
      instruccion: "otra edición",
    });
    assert.equal(second.response.ok, false);
    assert.ok(String(second.response.error).includes("turno"));
    // The cap fires before any fetch/edit/upload.
    assert.equal(store.fetches.length, fetchesAfterFirst);
    assert.equal(store.imageEdits.length, 1);
    assert.equal(store.uploads.length, 1);
  });

  it("a failed edit returns ok:false without uploading or saving, and does not consume the turn", async () => {
    const { deps, store } = makeDeps({
      data: { html: IMG_HTML },
      editImageResult: { error: "blocked", status: 422, body: { error: "blocked", reason: "SAFETY" } },
    });
    const session = makeSession(IMG_HTML);
    const out = await runAgentTool(session, deps, "editar_imagen", {
      imagen_url: IMG_URL,
      instruccion: "algo prohibido",
    });
    assert.equal(out.response.ok, false);
    assert.equal(store.uploads.length, 0);
    assert.equal(store.saved.length, 0);
    // Turn allowance untouched — the model can retry with another image.
    assert.equal(session.imageEditsThisTurn, 0);
  });

  it("a failed fetch returns ok:false without editing, uploading, or saving", async () => {
    const { deps, store } = makeDeps({
      data: { html: IMG_HTML },
      fetchImageResult: { ok: false, error: "upstream_error" },
    });
    const session = makeSession(IMG_HTML);
    const out = await runAgentTool(session, deps, "editar_imagen", {
      imagen_url: IMG_URL,
      instruccion: "algo",
    });
    assert.equal(out.response.ok, false);
    assert.equal(store.imageEdits.length, 0);
    assert.equal(store.uploads.length, 0);
    assert.equal(store.saved.length, 0);
    assert.equal(session.imageEditsThisTurn, 0);
  });
});

describe("publicar", () => {
  it("NEVER publishes — an existing claim + no new subdominio → confirm with the current name, republicar true", async () => {
    const { deps, store } = makeDeps({ subdomain: "tacos-guero", publishedAt: new Date() });
    const out = await runAgentTool(makeSession(), deps, "publicar", {});
    assert.equal(out.response.ok, true);
    assert.ok(out.confirm);
    assert.equal(out.confirm!.action, "publicar");
    assert.equal(out.confirm!.subdominio, "tacos-guero");
    assert.equal(out.confirm!.republicar, true);
    // The tool touches NOTHING — no project save, no publish side effect.
    assert.equal(store.saved.length, 0);
  });

  it("a new subdominio (normalized lowercase/trim) → uses it, republicar false", async () => {
    const { deps } = makeDeps({ subdomain: "viejo-nombre" });
    const out = await runAgentTool(makeSession(), deps, "publicar", { subdominio: "  Nuevo-Sitio  " });
    assert.equal(out.response.ok, true);
    assert.equal(out.confirm!.subdominio, "nuevo-sitio");
    assert.equal(out.confirm!.republicar, false);
  });

  it("a new subdominio that equals the current claim (case-insensitive) → republicar true", async () => {
    const { deps } = makeDeps({ subdomain: "mi-tienda" });
    const out = await runAgentTool(makeSession(), deps, "publicar", { subdominio: "MI-TIENDA" });
    assert.equal(out.response.ok, true);
    assert.equal(out.confirm!.subdominio, "mi-tienda");
    assert.equal(out.confirm!.republicar, true);
  });

  it("a shape-invalid subdominio (accents/spaces) → ok:false BEFORE any confirm card, nothing saved", async () => {
    const { deps, store } = makeDeps({ subdomain: "tienda-vieja" });
    const out = await runAgentTool(makeSession(), deps, "publicar", { subdominio: "héllo world" });
    assert.equal(out.response.ok, false);
    assert.equal(out.confirm, undefined);
    assert.equal(out.action, undefined);
    assert.equal(store.saved.length, 0);
    // The message must carry the actual rule, not just "invalid" — the model
    // needs it to explain the shape rule AND suggest a corrected name.
    assert.ok(String(out.response.error).includes("minúsculas"));
  });

  it("a reserved subdominio (cuenta) → ok:false BEFORE any confirm card, nothing saved", async () => {
    const { deps, store } = makeDeps({ subdomain: "tienda-vieja" });
    const out = await runAgentTool(makeSession(), deps, "publicar", { subdominio: "cuenta" });
    assert.equal(out.response.ok, false);
    assert.equal(out.confirm, undefined);
    assert.equal(out.action, undefined);
    assert.equal(store.saved.length, 0);
    assert.ok(String(out.response.error).toLowerCase().includes("reservad"));
  });

  it("no claim AND no subdominio → ok:false telling the model to ask the user, no confirm, nothing saved", async () => {
    const { deps, store } = makeDeps(); // subdomain null
    const out = await runAgentTool(makeSession(), deps, "publicar", {});
    assert.equal(out.response.ok, false);
    assert.equal(out.confirm, undefined);
    assert.ok(String(out.response.error).toLowerCase().includes("subdomin"));
    assert.equal(store.saved.length, 0);
  });

  // 🔴 Y SI VUELVE A LLAMAR EN EL MISMO TURNO, SE INVENTÓ EL NOMBRE.
  //
  // La respuesta de arriba le ordenaba en prosa «NO vuelvas a llamar a publicar
  // en este turno». No sujetaba: la primera versión traía un ejemplo con forma
  // de valor y DeepSeek reclamaba "mi-negocio" 3 de 3 veces, se quitó el
  // ejemplo, y el eval `publicar-sin-subdominio` lo pilló recayendo igual.
  //
  // ⚠️ QUIÉN LO SUJETA AHORA (2026-09-01). Esto lo guardaba
  // `session.pidioSubdominioEsteTurno`, un flag que se armaba al responder la
  // primera vez. Se retiró con `preguntar`: era la mitad vigilante de un parche
  // cuya otra mitad era la orden en prosa, y su propio comentario ya reconocía
  // que en el caso que de verdad pasa —UNA sola llamada con el nombre
  // inventado— no se armaba jamás.
  //
  // Lo sujeta la comprobación de `mensajeDelUsuario`, que es más fuerte porque
  // no depende del turno: un nombre que el dueño no escribió se rechaza en la
  // llamada 1 y en la 5. La ruta SIEMPRE lo pasa (route.ts, `mensajeDelUsuario:
  // prompt`), así que en producción la guarda está siempre armada — este doble
  // lo replica en vez de correr con una sesión que no existe.
  it("y una SEGUNDA llamada en el mismo turno se rechaza: el nombre es inventado", async () => {
    const { deps, store } = makeDeps(); // subdomain null
    const session = makeSession();
    session.mensajeDelUsuario = "ya publícala";

    const primera = await runAgentTool(session, deps, "publicar", {});
    assert.equal(primera.response.ok, false);

    const segunda = await runAgentTool(session, deps, "publicar", { subdominio: "mi-negocio" });
    assert.equal(segunda.response.ok, false, "se dejó colar el subdominio inventado");
    assert.equal(segunda.confirm, undefined, "construyó la tarjeta de confirmación igual");
    assert.equal(segunda.action, undefined);
    assert.equal(store.saved.length, 0);
    assert.match(String(segunda.response.error), /invent/i);
  });

  // 🔴 Y EL CASO QUE DE VERDAD PASA: SE LO INVENTA A LA PRIMERA.
  //
  // La guarda de arriba supone dos llamadas. MEDIDO con el eval
  // `publicar-sin-subdominio`: ante «ya publícala» el modelo manda UNA sola
  // llamada con un subdominio sacado del título, nunca lee la negativa, y la
  // guarda por turno no llega a armarse. El usuario ve una tarjeta de
  // confirmación para una dirección que jamás pidió.
  //
  // Lo que separa un nombre del DUEÑO de uno del modelo no es la intención: es
  // si el usuario lo escribió.
  it("un subdominio que el usuario NUNCA dijo se rechaza, sin tarjeta", async () => {
    const { deps, store } = makeDeps(); // sin reclamo
    const session = { ...makeSession(), mensajeDelUsuario: "ya publícala" };
    const out = await runAgentTool(session, deps, "publicar", { subdominio: "tacos-el-primo" });
    assert.equal(out.response.ok, false, "se coló un subdominio inventado");
    assert.equal(out.confirm, undefined, "construyó la tarjeta igual");
    assert.equal(store.saved.length, 0);
    assert.match(String(out.response.error), /no ha dicho|invent/i);
  });

  it("pero el que SÍ dijo pasa, aunque lo escribiera con espacios", async () => {
    const { deps } = makeDeps(); // sin reclamo
    // El dueño escribe «mi negocio»; el subdominio válido es «mi-negocio».
    // Exigirle el guion sería rechazarlo por la ortografía de una regla nuestra.
    const session = { ...makeSession(), mensajeDelUsuario: "publícala como mi negocio" };
    const out = await runAgentTool(session, deps, "publicar", { subdominio: "mi-negocio" });
    assert.equal(out.response.ok, true);
    assert.equal(out.confirm!.subdominio, "mi-negocio");
  });

  it("y con un reclamo YA existente la comprobación no estorba", async () => {
    // Republicar no elige nada nuevo: el nombre ya es del usuario de antes.
    const { deps } = makeDeps({ subdomain: "tienda-vieja" });
    const session = { ...makeSession(), mensajeDelUsuario: "ya publícala" };
    const out = await runAgentTool(session, deps, "publicar", {});
    assert.equal(out.response.ok, true);
    assert.equal(out.confirm!.republicar, true);
  });

  // BRAZO DE CONTROL: la guarda es POR TURNO, no una prohibición permanente.
  // El usuario contesta en el turno SIGUIENTE —sesión nueva— y ahí sí publica.
  it("pero en el turno siguiente, con el nombre que dio el usuario, publica", async () => {
    const { deps } = makeDeps(); // subdomain null
    const primerTurno = makeSession();
    await runAgentTool(primerTurno, deps, "publicar", {});

    const turnoSiguiente = makeSession();
    const out = await runAgentTool(turnoSiguiente, deps, "publicar", { subdominio: "mi-negocio" });
    assert.equal(out.response.ok, true);
    assert.equal(out.confirm!.subdominio, "mi-negocio");
    assert.equal(out.confirm!.republicar, false);
  });

  it("filters idiomas through isPublishLocale — invalid dropped, capped at 9", async () => {
    const { deps } = makeDeps({ subdomain: "tienda" });
    const out = await runAgentTool(makeSession(), deps, "publicar", {
      idiomas: ["es", "en", "xx", "zz", "pt", 42, null],
    });
    assert.equal(out.response.ok, true);
    assert.deepEqual(out.confirm!.idiomas, ["es", "en", "pt"]);
    // The dropped ones are noted in the response for the model.
    assert.ok(out.response.idiomas_ignorados);
  });

  it("more than 9 valid idiomas are capped to 9, the overflow surfaces in idiomas_ignorados", async () => {
    const { deps } = makeDeps({ subdomain: "tienda" });
    const out = await runAgentTool(makeSession(), deps, "publicar", {
      idiomas: ["en", "es", "pt", "fr", "de", "it", "ja", "ko", "zh", "nl"],
    });
    assert.equal(out.response.ok, true);
    assert.equal(out.confirm!.idiomas.length, 9);
    // The dropped-by-cap locale is reported too, not silently vanished.
    assert.deepEqual(out.response.idiomas_ignorados, ["nl"]);
  });

  it("idiomas absent → confirm.idiomas is [] and nothing is flagged as ignored", async () => {
    // The card omits the `languages` key entirely for an empty list, so the
    // endpoint keeps the project's stored setting — an [] here must NEVER
    // reach the POST body (it would wipe a live site's translations).
    const { deps } = makeDeps({ subdomain: "tienda" });
    const out = await runAgentTool(makeSession(), deps, "publicar", {});
    assert.equal(out.response.ok, true);
    assert.deepEqual(out.confirm!.idiomas, []);
    assert.equal(out.response.idiomas_ignorados, undefined);
  });
});

// ⚰️ AQUÍ VIVÍAN LAS PRUEBAS DE `guardar_dato_del_negocio` Y
// `recordar_del_negocio`, retiradas el 2026-08-31 con el perfil de negocio.
// Fijaban un contrato que ya no existe: copiar el WhatsApp del dueño a otra
// tabla además de escribirlo en su página.
//
// Su cobertura no se pierde, se INVIERTE en la batería del Agente:
// `negocio-whatsapp-de-paso` ya no exige que se guarde, exige que el número
// ACABE EN EL DOCUMENTO.

describe("recordar_preferencia — alcance de PROYECTO (alcance:\"esta_pagina\")", () => {
  // El alcance por defecto dejo de ser este el 2026-08-22: ahora una
  // preferencia se guarda para la PERSONA salvo que se pida lo contrario. Estas
  // pruebas siguen cubriendo la mecanica del brief —marcador, dedup,
  // refinamiento, tope— y por eso ahora piden el alcance explicitamente.
  it("appends under the agent marker and reports the card", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "recordar_preferencia", {
      alcance: "esta_pagina",
      preferencia: "Siempre hablarle de tú al visitante",
    });
    assert.equal(out.response.ok, true);
    assert.ok(store.userBrief!.includes("— Preferencias guardadas por el agente —"));
    assert.ok(store.userBrief!.includes("• Siempre hablarle de tú al visitante"));
    assert.equal(out.action?.tool, "recordar_preferencia");
  });
  it("preserves the user's own brief text above the marker", async () => {
    const { deps, store } = makeDeps({ userBrief: "Negocio de tacos al pastor." });
    await runAgentTool(makeSession(), deps, "recordar_preferencia", { alcance: "esta_pagina", preferencia: "Tono formal" });
    assert.ok(store.userBrief!.startsWith("Negocio de tacos al pastor."));
    assert.ok(store.userBrief!.indexOf("Negocio") < store.userBrief!.indexOf("— Preferencias"));
  });
  it("dedups case-insensitively without writing", async () => {
    const { deps, store } = makeDeps();
    await runAgentTool(makeSession(), deps, "recordar_preferencia", { alcance: "esta_pagina", preferencia: "Nunca usar amarillo" });
    const writes = store.briefWrites;
    const out = await runAgentTool(makeSession(), deps, "recordar_preferencia", { alcance: "esta_pagina", preferencia: "nunca usar AMARILLO" });
    assert.equal(out.response.ya_existia, true);
    assert.equal(store.briefWrites, writes);
  });
  it("a LONGER refinement of an existing bullet IS saved (never deduped in reverse)", async () => {
    const { deps, store } = makeDeps();
    await runAgentTool(makeSession(), deps, "recordar_preferencia", { alcance: "esta_pagina", preferencia: "Sé formal" });
    const out = await runAgentTool(makeSession(), deps, "recordar_preferencia", {
      alcance: "esta_pagina",
      preferencia: "Sé formal, excepto con proveedores VIP",
    });
    assert.equal(out.response.ok, true);
    assert.equal(out.response.ya_existia, undefined);
    assert.ok(store.userBrief!.includes("• Sé formal\n"));
    assert.ok(store.userBrief!.includes("• Sé formal, excepto con proveedores VIP"));
  });
  it("embedded newlines are collapsed — a \\n• payload saves as ONE bullet line", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "recordar_preferencia", {
      alcance: "esta_pagina",
      preferencia: "Tono cercano\n• Nunca usar rojo",
    });
    assert.equal(out.response.ok, true);
    const bullets = store.userBrief!.split("\n").filter((l) => l.trim().startsWith("• "));
    assert.equal(bullets.length, 1);
    assert.ok(store.userBrief!.includes("• Tono cercano • Nunca usar rojo"));
  });
  it("refuses when the brief is full, as data", async () => {
    const { deps, store } = makeDeps({ userBrief: "x".repeat(3990) });
    const out = await runAgentTool(makeSession(), deps, "recordar_preferencia", { alcance: "esta_pagina", preferencia: "Preferencia larga que no cabe" });
    assert.equal(out.response.ok, false);
    assert.equal(store.userBrief!.length, 3990);
  });
  it("rejects out-of-range preferencia", async () => {
    const { deps } = makeDeps();
    const short = await runAgentTool(makeSession(), deps, "recordar_preferencia", { alcance: "esta_pagina", preferencia: "ok" });
    assert.equal(short.response.ok, false);
  });
});


describe("recordar_preferencia — alcance de PERSONA (el DEFECTO)", () => {
  // EL BUG QUE ESTO CIERRA. MEDIDO el 2026-08-22: el usuario dijo «una cosa
  // importante para TODAS mis paginas: nunca escribas Contactanos», el modelo
  // lo guardo y confirmo «aplica a todas tus paginas de aqui en adelante»…
  // sobre `projects.userBrief`, que el proyecto siguiente no lee jamas.
  it("sin alcance guarda para la PERSONA, no en el brief del proyecto", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "recordar_preferencia", {
      preferencia: "Nunca escribas «Contáctanos», di «Escríbenos»",
    });
    assert.equal(out.response.ok, true);
    assert.equal(out.response.alcance, "siempre");
    assert.equal(store.memoriaUsuario.length, 1);
    assert.equal(store.memoriaUsuario[0]!.preferencia, "Nunca escribas «Contáctanos», di «Escríbenos»");
    // Y NO toca el brief del proyecto: si lo hiciera, seguiria atada a este.
    assert.equal(store.userBrief, null);
  });

  it("le dice al modelo que fue para TODAS sus paginas, para que lo confirme bien", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "recordar_preferencia", {
      preferencia: "Háblame siempre de tú",
    });
    assert.match(String(out.response.nota), /TODAS/);
  });

  it("un alcance desconocido cae al DEFECTO (persona), no al proyecto", async () => {
    // Falla hacia lo global: una preferencia global que debio ser local se poda;
    // una local que debio ser global es justo el bug, y es invisible.
    const { deps, store } = makeDeps();
    await runAgentTool(makeSession(), deps, "recordar_preferencia", {
      preferencia: "Nunca uses amarillo",
      alcance: "vete_a_saber",
    });
    assert.equal(store.memoriaUsuario.length, 1);
    assert.equal(store.userBrief, null);
  });

  it("con la memoria LLENA no guarda y lo dice como dato", async () => {
    const { deps, store } = makeDeps();
    deps.rememberAboutUser = async () => ({ ok: false as const, reason: "llena" as const });
    const out = await runAgentTool(makeSession(), deps, "recordar_preferencia", {
      preferencia: "Otra preferencia mas",
    });
    assert.equal(out.response.ok, false);
    assert.match(String(out.response.error), /llena/);
    assert.equal(store.userBrief, null);
  });
});

describe("runAgentTool", () => {
  it("returns ok:false for an unknown tool name instead of throwing", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "no_existe", {});
    assert.equal(out.response.ok, false);
    assert.equal(out.response.error, "herramienta desconocida");
  });
});

// F4 Task 2 — THE W1 PIN (wrong-slot writes). Fixtures per this describe
// block: HOME_HTML carries an on-page image (for the editar_imagen
// membership pin) and no --ol-accent; MENU_HTML carries its OWN --ol-accent
// (for the cambiar_tema seed pin) and no image. Every pin asserts the
// UNTOUCHED slot byte-for-byte, not merely that the touched slot changed.
describe("W1 regression pins (multi-página)", () => {
  const HOME_IMG_URL = "https://images.openlen.com/home-hero.webp";
  const HOME_HTML = `<!doctype html><html><head><title>Tacos El Güero</title><meta name="description" content="Tacos"></head><body><img src="${HOME_IMG_URL}" alt="foto"><h1 data-x="k">Tacos El Güero</h1><p>Los mejores del barrio.</p></body></html>`;
  const MENU_ACCENT = "#2266aa";
  const MENU_HTML = `<!doctype html><html style="--ol-accent: ${MENU_ACCENT}"><head><title>Menú</title><meta name="description" content="Menú"><style>a{color:var(--ol-accent)}body{background:var(--ol-bg)}</style></head><body><h1 data-x="k">Menú</h1><p>Estas son nuestras opciones.</p></body></html>`;
  const DATA_MP: ProjectData = {
    html: HOME_HTML,
    pages: { menu: { html: MENU_HTML, title: "Menú" } },
  };

  it("PIN: session.page='menu' → editar_pagina escribe SOLO pages.menu.html; data.html byte-intacto", async () => {
    const { deps, store } = makeDeps({ data: DATA_MP });
    const session = makeSession({ page: "menu", html: MENU_HTML });
    const target = contentOpId(session.taggedHtml);
    await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target, new_html: "<h1>Tacos al pastor</h1>" }],
      resumen: "titular menú",
    });
    assert.ok(store.data.pages!.menu.html.includes("Tacos al pastor"));
    assert.equal(store.data.html, HOME_HTML); // byte-intacto
  });

  // 🔴 EL LÍMITE QUE NO SE ENTERABA. `persistPage` tira el runtime de toda
  // subpágina —`paginaGuardaRuntime` es esa regla— y esto contestaba
  // `comportamiento_actualizado: true` igual, porque miraba lo que el modelo
  // MANDÓ y no lo que se guardó. Len le decía al dueño que le había cableado el
  // carrito y el botón no hacía nada.
  //
  // El control de que esta prueba no es vacía vive arriba: "un edit de SOLO
  // runtime no deja data-op-id en el documento guardado" hace lo mismo en la
  // Home y tiene que seguir en verde. Si rechazara de más, ésa se cae.
  // INVERTIDO el 2026-08-25. Este pin fijaba «un edit de runtime en una
  // SUBPÁGINA se rechaza», y era cierto — pero fijaba una limitación de
  // ALMACENAMIENTO (una sola columna para la cápsula) vendida como regla de
  // producto. Ahora cada página guarda la suya, y lo que hay que clavar es que
  // el script vaya a SU sitio: uno de /menu en la columna de la Home se llevaría
  // por delante el de la portada.
  it("PIN: un edit de runtime en una SUBPÁGINA se guarda COMO SUYO", async () => {
    const { deps, store } = makeDeps({ data: DATA_MP });

    const out = await runAgentTool(
      makeSession({ page: "menu", html: MENU_HTML }),
      deps,
      "editar_pagina",
      {
        edits: [{ op: "replace", target: "runtime", new_html: "document.title='x';" }],
        resumen: "carrito del menú",
        prueba: [{ clic: "#x", entonces: [{ donde: "#x", que: "cambia" }] }],
      },
    );

    assert.equal(out.response.ok, true, JSON.stringify(out.response));
    // El script acaba DENTRO del documento de /menu, y sólo de /menu. Antes
    // esto miraba a qué COLUMNA se había escrito; ahora se mira el documento,
    // que es la misma pregunta hecha donde de verdad vive la respuesta.
    assert.ok(
      store.data.pages?.menu?.html.includes("document.title='x';"),
      "el script no llegó al documento de /menu",
    );
    assert.ok(
      !store.data.html.includes("document.title='x';"),
      "el script de /menu acabó en la portada",
    );
    // Y el documento que se escribió sigue siendo el de /menu, no el de la Home.
    assert.ok(store.data.pages?.menu, "perdió la subpágina");
  });

  it("PIN: session.page=null → escribe SOLO data.html; pages byte-intactas", async () => {
    const { deps, store } = makeDeps({ data: DATA_MP });
    const session = makeSession({ page: null, html: HOME_HTML });
    const target = contentOpId(session.taggedHtml);
    await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target, new_html: "<h1>Bienvenidos</h1>" }],
      resumen: "titular home",
    });
    assert.ok(store.data.html!.includes("Bienvenidos"));
    assert.equal(store.data.pages!.menu.html, MENU_HTML); // byte-intacta
  });

  it("PIN: entre VARIAS subpáginas, editar_pagina toca SOLO la activa; la hermana y home byte-intactas", async () => {
    const ABOUT_HTML = `<!doctype html><html><head><title>Nosotros</title><meta name="description" content="Nosotros"></head><body><h1 data-x="k">Quiénes somos</h1><p>Desde 1998.</p></body></html>`;
    const dataMulti: ProjectData = {
      html: HOME_HTML,
      pages: { menu: { html: MENU_HTML, title: "Menú" }, about: { html: ABOUT_HTML, title: "Nosotros" } },
    };
    const { deps, store } = makeDeps({ data: dataMulti });
    const session = makeSession({ page: "menu", html: MENU_HTML });
    const target = contentOpId(session.taggedHtml);
    await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target, new_html: "<h1>Tacos al pastor</h1>" }],
      resumen: "titular menú",
    });
    assert.ok(store.data.pages!.menu.html.includes("Tacos al pastor"));
    assert.equal(store.data.pages!.about.html, ABOUT_HTML); // hermana byte-intacta
    assert.equal(store.data.html, HOME_HTML); // home byte-intacto
  });

  it("PIN: snapshots llevan page=session.page (pre y post)", async () => {
    const { deps, store } = makeDeps({ data: DATA_MP });
    const session = makeSession({ page: "menu", html: MENU_HTML });
    const target = contentOpId(session.taggedHtml);
    await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target, new_html: "<h1>Nuevo titular</h1>" }],
      resumen: "x",
    });
    // Pre-edit ("Before AI edit") + post-edit snapshot, both tagged "menu".
    assert.equal(store.versionPages.length, 2);
    assert.deepEqual(store.versionPages, ["menu", "menu"]);
  });

  it("cambiar_tema sobre subpágina siembra accent/modo DEL doc de la subpágina y persiste ahí", async () => {
    const { deps, store } = makeDeps({ data: DATA_MP });
    const session = makeSession({ page: "menu", html: MENU_HTML });
    const out = await runAgentTool(session, deps, "cambiar_tema", { modo: "dark" });
    assert.equal(out.response.ok, true);
    // Seeded from MENU's own --ol-accent, NOT home's (home has none — if this
    // tool mis-read row.data.html the seed would be missing and ok would be
    // false, failing this assert first).
    const dark = lookFromAccent(MENU_ACCENT).dark;
    assert.ok(store.data.pages!.menu.html.includes(`--ol-accent: ${dark["--ol-accent"]}`));
    assert.match(store.data.pages!.menu.html, /<html[^>]*\sdata-ol-mode="dark"/);
    assert.equal(store.data.html, HOME_HTML); // byte-intacto — home untouched
  });

  it("editar_imagen: membership contra el doc ACTIVO — URL que solo está en home, con page='menu' → ok:false sin fetch", async () => {
    const { deps, store } = makeDeps({ data: DATA_MP });
    const session = makeSession({ page: "menu", html: MENU_HTML });
    const out = await runAgentTool(session, deps, "editar_imagen", {
      imagen_url: HOME_IMG_URL,
      instruccion: "quita el fondo",
    });
    assert.equal(out.response.ok, false);
    assert.equal(store.fetches.length, 0);
    assert.equal(store.saved.length, 0);
  });

  // Beyond the 5 named pins: closes the "swap" half of the editar_imagen
  // interface clause (membership above only proves the READ side) — a
  // successful subpage image edit must write ONLY that subpage's slot.
  it("editar_imagen happy path on a subpage writes ONLY pages.menu.html; data.html byte-intacto", async () => {
    const menuWithImg = MENU_HTML.replace(
      "<body>",
      `<body><img src="${HOME_IMG_URL.replace("home-hero", "menu-photo")}" alt="menu">`,
    );
    const menuImgUrl = HOME_IMG_URL.replace("home-hero", "menu-photo");
    const { deps, store } = makeDeps({ data: { html: HOME_HTML, pages: { menu: { html: menuWithImg } } } });
    const session = makeSession({ page: "menu", html: menuWithImg });
    const out = await runAgentTool(session, deps, "editar_imagen", {
      imagen_url: menuImgUrl,
      instruccion: "hazla más cálida",
    });
    assert.equal(out.response.ok, true);
    assert.ok(store.data.pages!.menu.html.includes("edited-123.webp"));
    assert.ok(!store.data.pages!.menu.html.includes(menuImgUrl));
    assert.equal(store.data.html, HOME_HTML); // byte-intacto — home untouched
  });
});

// F4 Task 3 — trabajar_en_pagina: words-as-selector document switch. Never
// persists (no saveProjectData/snapshotVersion call ever) — it only moves
// session.page + re-tags session.taggedHtml against the FRESHLY loaded doc.
describe("trabajar_en_pagina", () => {
  const HOME_HTML = `<!doctype html><html><head><title>Tacos El Güero</title><meta name="description" content="Tacos"></head><body><h1 data-x="k">Tacos El Güero</h1><p>Los mejores del barrio.</p></body></html>`;
  const MENU_HTML = `<!doctype html><html><head><title>Menú</title><meta name="description" content="Menú"></head><body><h1 data-x="k">Nuestro Menú</h1><p>Estas son nuestras opciones.</p></body></html>`;
  const DATA_MP: ProjectData = {
    html: HOME_HTML,
    pages: { menu: { html: MENU_HTML, title: "Menú" } },
  };

  it("switches to an existing subpage: session.page set, taggedHtml re-tagged with THAT page's content", async () => {
    const { deps, store } = makeDeps({ data: DATA_MP });
    const session = makeSession({ page: null, html: HOME_HTML });
    const out = await runAgentTool(session, deps, "trabajar_en_pagina", { pagina: "menu" });
    assert.equal(out.response.ok, true);
    assert.equal(out.response.pagina_activa, "menu");
    assert.equal(session.page, "menu");
    assert.ok(session.taggedHtml.includes("Nuestro Menú"));
    assert.ok(!session.taggedHtml.includes("Tacos El Güero"));
    assert.ok(session.taggedHtml.includes("data-op-id"));
    assert.equal(out.action?.tool, "trabajar_en_pagina");
    // NO persistence — the switch alone never writes or snapshots anything.
    assert.equal(store.saved.length, 0);
    assert.equal(store.versions.length, 0);
  });

  // 🔴 LO QUE EL MODELO VE, NO LO QUE GUARDA EL SERVIDOR.
  //
  // El esquema de esta herramienta promete «usa los nuevos [data-op-id] que
  // trae la respuesta» y el system prompt dice que «la respuesta trae el
  // documento fresco». No lo traía: sólo ok, pagina_activa y una nota que
  // decía «documento cargado» — cargado en `session`, que el modelo NO VE (el
  // bucle sólo le pasa outcome.response). Tras el cambio de página el modelo
  // editaba con los op-ids de la anterior. Las pruebas de arriba miran
  // session.taggedHtml, que es justo la mitad que el modelo nunca recibe.
  it("la RESPUESTA lleva el documento nuevo, no sólo la sesión", async () => {
    const { deps } = makeDeps({ data: DATA_MP });
    const session = makeSession({ page: null, html: HOME_HTML });

    const out = await runAgentTool(session, deps, "trabajar_en_pagina", { pagina: "menu" });

    assert.equal(out.response.documento, session.taggedHtml);
    assert.ok(String(out.response.documento).includes("Nuestro Menú"));
    assert.ok(String(out.response.documento).includes("data-op-id"));
    // Y NO el de la página de la que venimos.
    assert.ok(!String(out.response.documento).includes("Tacos El Güero"));
  });

  it("y volviendo a la Home trae el de la Home", async () => {
    const { deps } = makeDeps({ data: DATA_MP });
    const session = makeSession({ page: "menu", html: MENU_HTML });

    const out = await runAgentTool(session, deps, "trabajar_en_pagina", { pagina: "principal" });

    assert.ok(String(out.response.documento).includes("Tacos El Güero"));
    assert.ok(!String(out.response.documento).includes("Nuestro Menú"));
  });

  it("un cambio que FALLA no manda documento — no hay página nueva que traer", async () => {
    const { deps } = makeDeps({ data: DATA_MP });
    const session = makeSession({ page: null, html: HOME_HTML });

    const out = await runAgentTool(session, deps, "trabajar_en_pagina", { pagina: "no-existe" });

    assert.equal(out.response.ok, false);
    assert.equal(out.response.documento, undefined);
  });

  it('"principal" switches back to home from an active subpage', async () => {
    const { deps, store } = makeDeps({ data: DATA_MP });
    const session = makeSession({ page: "menu", html: MENU_HTML });
    const out = await runAgentTool(session, deps, "trabajar_en_pagina", { pagina: "principal" });
    assert.equal(out.response.ok, true);
    assert.equal(out.response.pagina_activa, "principal");
    // F4-T8: response.pagina_activa stays "principal" (model-facing), but
    // action.summary — the user-visible field agent-action-card.tsx renders
    // — is the "" home sentinel so the panel can localize it instead of
    // showing a bare Spanish word.
    assert.equal(out.action?.summary, "");
    assert.equal(session.page, null);
    assert.ok(session.taggedHtml.includes("Tacos El Güero"));
    assert.ok(!session.taggedHtml.includes("Nuestro Menú"));
    assert.equal(store.saved.length, 0);
  });

  it('a REAL page slugged "principal" wins over the home alias (reachable, not shadowed)', async () => {
    // "principal" is NOT reserved, so a creator may legally name a subpage
    // that. Resolution must match the real page FIRST — otherwise
    // trabajar_en_pagina("principal") silently opens home → wrong-doc edits.
    const PRINCIPAL_PAGE = `<!doctype html><html><head><title>Principal Sub</title><meta name="description" content="x"></head><body><h1 data-x="k">Subpágina Principal</h1></body></html>`;
    const data: ProjectData = {
      html: HOME_HTML,
      pages: { principal: { html: PRINCIPAL_PAGE, title: "Principal" } },
    };
    const { deps } = makeDeps({ data });
    const session = makeSession({ page: null, html: HOME_HTML });
    const out = await runAgentTool(session, deps, "trabajar_en_pagina", { pagina: "principal" });
    assert.equal(out.response.ok, true);
    assert.equal(out.response.pagina_activa, "principal");
    assert.equal(session.page, "principal"); // the SLUG, not home (null)
    // F4-T8: action.summary shows the real slug verbatim here — NOT the ""
    // home sentinel — so this case stays distinguishable from an actual
    // home switch (see the test above).
    assert.equal(out.action?.summary, "principal");
    assert.ok(session.taggedHtml.includes("Subpágina Principal"));
    assert.ok(!session.taggedHtml.includes("Tacos El Güero")); // NOT the home doc
  });

  it('"home" and "" are equivalent aliases for principal', async () => {
    const { deps } = makeDeps({ data: DATA_MP });
    const s1 = makeSession({ page: "menu", html: MENU_HTML });
    const out1 = await runAgentTool(s1, deps, "trabajar_en_pagina", { pagina: "home" });
    assert.equal(out1.response.ok, true);
    assert.equal(s1.page, null);

    const s2 = makeSession({ page: "menu", html: MENU_HTML });
    const out2 = await runAgentTool(s2, deps, "trabajar_en_pagina", { pagina: "" });
    assert.equal(out2.response.ok, true);
    assert.equal(s2.page, null);
  });

  it("a nonexistent page comes back ok:false, listing available pages, without touching session.page", async () => {
    const { deps } = makeDeps({ data: DATA_MP });
    const session = makeSession({ page: null, html: HOME_HTML });
    const out = await runAgentTool(session, deps, "trabajar_en_pagina", { pagina: "contacto" });
    assert.equal(out.response.ok, false);
    assert.ok(String(out.response.error).includes("principal"));
    assert.ok(String(out.response.error).includes("menu"));
    // Session untouched on failure — still on home, still the home doc.
    assert.equal(session.page, null);
    assert.ok(session.taggedHtml.includes("Tacos El Güero"));
  });

  it("re-loads pages fresh — a page created earlier THIS turn (not in the session's stale view) is reachable", async () => {
    const { deps, store } = makeDeps({ data: { html: HOME_HTML } });
    const session = makeSession({ page: null, html: HOME_HTML });
    // Simulate crear_pagina having run earlier in the same turn: the DB row
    // now has a "menu" page, but session.page/taggedHtml still reflect home.
    store.data = { ...store.data, pages: { menu: { html: MENU_HTML, title: "Menú" } } };
    const out = await runAgentTool(session, deps, "trabajar_en_pagina", { pagina: "menu" });
    assert.equal(out.response.ok, true);
    assert.equal(session.page, "menu");
    assert.ok(session.taggedHtml.includes("Nuestro Menú"));
  });

  it("chained: trabajar_en_pagina(menu) then editar_pagina writes pages.menu, not data.html (W1 via the switch)", async () => {
    const { deps, store } = makeDeps({ data: DATA_MP });
    const session = makeSession({ page: null, html: HOME_HTML });
    const switched = await runAgentTool(session, deps, "trabajar_en_pagina", { pagina: "menu" });
    assert.equal(switched.response.ok, true);
    const target = contentOpId(session.taggedHtml);
    const edited = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target, new_html: "<h1>Tacos al pastor</h1>" }],
      resumen: "titular menú",
    });
    assert.equal(edited.response.ok, true);
    assert.ok(store.data.pages!.menu.html.includes("Tacos al pastor"));
    assert.equal(store.data.html, HOME_HTML); // byte-intacto — the switch, not editar_pagina, moved the slot
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUSCAR EN TODO EL SITIO.
//
// Las herramientas de mirar eran de UNA en UNA (`leer_estado op_id=` abre una
// sección; `ver_pagina` trae otra página entera), así que un dato repetido
// —un teléfono en el pie de tres páginas y en la meta description— salía
// arreglado a medias y reportado como hecho. Caso real de Jesús (2026-08-31):
// pidió arreglar el logo, se arregló en la Home y /nosotros quedó igual.
describe("buscar_en_pagina", () => {
  const HOME = `<!doctype html><html><head><title>Taller Bernal</title><meta name="description" content="Llama al 600112233"></head><body><h1>Taller Bernal</h1><p>Teléfono: 600112233</p></body></html>`;
  const NOSOTROS = `<!doctype html><html><head><title>Nosotros</title></head><body><h1>Quiénes somos</h1><footer><p>600112233</p></footer></body></html>`;
  const DATA: ProjectData = {
    html: HOME,
    pages: { nosotros: { html: NOSOTROS, title: "Nosotros" } },
  };

  it("encuentra el mismo dato en TODAS las páginas, no sólo en la activa", async () => {
    const { deps } = makeDeps({ data: DATA });
    const session = makeSession({ page: null, html: HOME });

    const out = await runAgentTool(session, deps, "buscar_en_pagina", { texto: "600112233" });

    assert.equal(out.response.ok, true);
    const c = out.response.coincidencias as { pagina: string; donde: string; op_id: string | null }[];
    // La Home dos veces (cuerpo + meta description) y /nosotros una.
    assert.deepEqual(
      [...new Set(c.map((x) => x.pagina))].sort(),
      ["nosotros", "principal"],
    );
    assert.ok(c.some((x) => x.pagina === "principal" && x.donde === "cabecera"));
  });

  it("🔴 el op_id sólo viaja para la página ACTIVA", async () => {
    const { deps } = makeDeps({ data: DATA });
    const session = makeSession({ page: null, html: HOME });

    const out = await runAgentTool(session, deps, "buscar_en_pagina", { texto: "600112233" });
    const c = out.response.coincidencias as { pagina: string; donde: string; op_id: string | null }[];

    // Fuera de la activa NO hay id: la misma id existe en todas las páginas, y
    // editar con la de /nosotros sin mudarse cambiaría la Home sin dar error.
    for (const x of c) {
      if (x.pagina !== "principal") assert.equal(x.op_id, null, "un op_id de otra página edita la equivocada");
    }
    const enCuerpo = c.find((x) => x.pagina === "principal" && x.donde === "cuerpo");
    assert.ok(enCuerpo?.op_id, "sin id en la activa la herramienta no sirve para editar");
    // Y ES UN ID DE VERDAD: el que `editar_pagina` va a resolver, o sea uno de
    // `session.taggedHtml`. Comprobarlo aquí es lo que separa «devuelve algo»
    // de «devuelve algo que funciona».
    assert.ok(session.taggedHtml.includes(`data-op-id="${enCuerpo!.op_id}"`));
  });

  it("y ese op_id EDITA de verdad la línea encontrada", async () => {
    const { deps, store } = makeDeps({ data: DATA });
    const session = makeSession({ page: null, html: HOME });

    const out = await runAgentTool(session, deps, "buscar_en_pagina", { texto: "600112233" });
    const c = out.response.coincidencias as { pagina: string; donde: string; op_id: string | null }[];
    const target = c.find((x) => x.pagina === "principal" && x.donde === "cuerpo")!.op_id!;

    const editado = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target, new_html: "<p>Teléfono: 600445566</p>" }],
      resumen: "teléfono nuevo",
    });

    assert.equal(editado.response.ok, true);
    assert.ok(store.data.html.includes("600445566"));
    assert.ok(!store.data.html.includes("<p>Teléfono: 600112233</p>"));
  });

  it("buscar no ESCRIBE nada", async () => {
    const { deps, store } = makeDeps({ data: DATA });
    await runAgentTool(makeSession({ page: null, html: HOME }), deps, "buscar_en_pagina", {
      texto: "Taller",
    });
    assert.equal(store.saved.length, 0);
    assert.equal(store.versions.length, 0);
  });

  it("un texto de una letra se rechaza, y dice por qué", async () => {
    const { deps } = makeDeps({ data: DATA });
    const out = await runAgentTool(makeSession({ page: null, html: HOME }), deps, "buscar_en_pagina", {
      texto: "a",
    });
    assert.equal(out.response.ok, false);
    assert.match(String(out.response.error), /caracteres/);
  });

  it("sin coincidencias responde ok con la lista vacía — no es un error", async () => {
    const { deps } = makeDeps({ data: DATA });
    const out = await runAgentTool(makeSession({ page: null, html: HOME }), deps, "buscar_en_pagina", {
      texto: "zanahoria",
    });
    assert.equal(out.response.ok, true);
    assert.deepEqual(out.response.coincidencias, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HALLAZGO 3 — «Un runtime se puede reemplazar, pero no borrar».
//
// Una página con JavaScript del modelo no tenía NINGUNA forma de perderlo:
// `splitRuntimeOps` sólo aceptaba `replace`, un `replace` vacío se rechazaba, y
// la ausencia de runtime hace que `persistPage` RE-SELLE el código anterior
// sobre el documento nuevo. «Quita el carrito» era imposible de cumplir, y el
// modelo podía pasarse el turno reescribiendo el marcado sin conseguirlo.
//
// Estas pruebas miran lo que llega a la CAPA DE DATOS, no lo que el modelo
// mandó: el defecto anterior era exactamente esa diferencia.
// 🔴 UN ID QUE YA NO EXISTE NO PUEDE COSTAR UNA VUELTA — 2026-08-31.
//
// MEDIDO en producción: `editar_pagina` falla el 7,9% de las veces (3 de 38).
// Antes, el error decía sólo el motivo, así que el modelo tenía que llamar a
// `leer_estado` para recuperarse: una vuelta entera del bucle reenviando todo
// el historial. Ahora el documento fresco viaja DENTRO del error — el mismo
// payload que iba a pedir de todas formas.
//
// Es la misma cura que `trabajar_en_pagina` ya había aplicado en este fichero.
// Y el contexto que la justifica: los agentes que editan por texto exacto
// tienen este problema mucho peor (Anthropic publica 15-20% de fallo al primer
// intento en su `str_replace`; Cline lleva 4 estrategias de rescate, OpenCode
// nueve). Direccionar por data-op-id evita casi todo eso; lo que faltaba era no
// cobrar la recuperación.
// ─────────────────────────────────────────────────────────────────────────────
// PREGUNTAR — la parada la ejecuta el servidor, no la buena voluntad del modelo.
//
// «Esto lo decide el usuario» viajaba como `ok:false` con una ORDEN dentro («NO
// vuelvas a llamar a publicar en este turno; termina preguntándole») más un flag
// de sesión para cazarle si la desobedecía. Está MEDIDO que la desobedecía.
describe("preguntar", () => {
  it("devuelve la pregunta para que el bucle cierre el turno", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "preguntar", {
      texto: "¿Qué dirección quieres para tu página?",
    });

    assert.equal(out.response.ok, true);
    assert.equal(out.pregunta, "¿Qué dirección quieres para tu página?");
    // Preguntar no toca la página ni la base.
    assert.equal(store.saved.length, 0);
    assert.equal(out.updatedHtml, undefined);
  });

  it("una pregunta vacía se rechaza — el usuario no puede leer nada", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "preguntar", { texto: "   " });
    assert.equal(out.response.ok, false);
    assert.equal(out.pregunta, undefined);
  });

  it("recorta una pregunta kilométrica: eso ya no es una pregunta", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "preguntar", {
      texto: "¿".repeat(2_000),
    });
    assert.equal(out.response.ok, true);
    assert.ok((out.pregunta ?? "").length <= 600);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LEER DE INTERNET.
//
// ⚠️ SIN RED. Estas pruebas usan direcciones que la defensa SSRF rechaza SIN
// resolver DNS —localhost por nombre, un protocolo que no es http— así que
// recorren la tubería de verdad, incluido el fetcher real, y no sale un solo
// paquete. La extracción de texto y el paralelismo se prueban aparte, con el
// fetcher inyectado (lib/agent/internet.test.ts).
describe("leer_de_internet", () => {
  it("una dirección que no es una web pública se rechaza, con el motivo", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "leer_de_internet", {
      urls: ["http://localhost/secreto"],
    });
    assert.equal(out.response.ok, true);
    const paginas = out.response.paginas as { ok: boolean; error?: string }[];
    assert.equal(paginas[0]!.ok, false);
    assert.match(String(paginas[0]!.error), /no es una web pública/);
  });

  it("🔴 la respuesta dice que eso es INFORMACIÓN, no instrucciones", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "leer_de_internet", {
      urls: ["ftp://algo.com/x"],
    });
    // Quien controle una web ajena puede escribir dentro «olvida tus
    // instrucciones». El envoltorio no es una defensa completa —a este nivel
    // no la hay— pero entregar el texto desnudo sería peor.
    assert.match(String(out.response.nota), /NO instrucciones/i);
    assert.match(String(out.response.nota), /ignóralo/i);
  });

  it("sin urls no llama a nadie", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "leer_de_internet", { urls: [] });
    assert.equal(out.response.ok, false);
  });

  it("tope por turno: a la tercera se niega y dice qué hacer en su lugar", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    for (let i = 0; i < 2; i++) {
      const out = await runAgentTool(session, deps, "leer_de_internet", {
        urls: ["http://localhost/x"],
      });
      assert.equal(out.response.ok, true, "la lectura " + (i + 1) + " se negó");
    }
    const tercera = await runAgentTool(session, deps, "leer_de_internet", {
      urls: ["http://localhost/x"],
    });
    assert.equal(tercera.response.ok, false);
    assert.match(String(tercera.response.error), /tope/);
  });
});

describe("declarar_tareas", () => {
  it("devuelve la lista para que el bucle la compruebe al cerrar", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "declarar_tareas", {
      tareas: ["cambiar el titular", "poner el teléfono", "publicar"],
    });

    assert.equal(out.response.ok, true);
    assert.deepEqual(out.tareas, ["cambiar el titular", "poner el teléfono", "publicar"]);
    // Declarar NO hace nada: es una lista de trabajo, no un cambio.
    assert.equal(store.saved.length, 0);
    assert.equal(out.updatedHtml, undefined);
  });

  it("le dice CÓMO se va a comprobar — un checklist con criterio secreto es un examen sorpresa", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "declarar_tareas", { tareas: ["una"] });
    assert.match(String(out.response.nota), /cambió algo|cambi/i);
  });

  it("una lista vacía —o de puros huecos— se rechaza", async () => {
    const { deps } = makeDeps();
    for (const tareas of [[], ["", "   "], "no soy una lista"]) {
      const out = await runAgentTool(makeSession(), deps, "declarar_tareas", { tareas });
      assert.equal(out.response.ok, false, `aceptó ${JSON.stringify(tareas)}`);
      assert.equal(out.tareas, undefined);
    }
  });

  it("corta a 8: declarar veinte pasos es escribir un plan que no cabe en el turno", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "declarar_tareas", {
      tareas: Array.from({ length: 20 }, (_, i) => `paso ${i}`),
    });
    assert.equal(out.tareas?.length, 8);
  });
});

describe("publicar sin subdominio ya no da órdenes de comportamiento", () => {
  it("señala `preguntar` en vez de pedirle al modelo que se pare solo", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "publicar", {});

    assert.equal(out.response.ok, false);
    const error = String(out.response.error);
    assert.match(error, /preguntar/);
    // Y NO la orden vieja, que es la que el modelo se saltaba.
    assert.doesNotMatch(error, /NO vuelvas a llamar/i);
    // Sin tarjeta: el usuario no puede confirmar una dirección que nadie eligió.
    assert.equal(out.confirm, undefined);
  });

  it("y un nombre que el usuario NO dijo se sigue rechazando, la primera vez y la quinta", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    session.mensajeDelUsuario = "ya publícala";

    for (let i = 0; i < 5; i++) {
      const out = await runAgentTool(session, deps, "publicar", { subdominio: "tacos-el-guero" });
      assert.equal(out.response.ok, false, `la llamada ${i + 1} pasó`);
      assert.match(String(out.response.error), /te lo has inventado/);
      assert.equal(out.confirm, undefined);
    }
  });

  it("pero el nombre que SÍ dijo pasa a la primera", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    session.mensajeDelUsuario = "publícala como tacos-el-guero";

    const out = await runAgentTool(session, deps, "publicar", { subdominio: "tacos-el-guero" });
    assert.equal(out.response.ok, true);
    assert.equal(out.confirm?.subdominio, "tacos-el-guero");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REVERTIR — los snapshots existían; lo que faltaba era que el Agente llegara.
describe("revertir_ultimo_cambio", () => {
  async function editaDosVeces(session: AgentSession, deps: AgentDeps) {
    const primera = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target: contentOpId(session.taggedHtml), new_html: "<h1>Uno</h1>" }],
      resumen: "uno",
    });
    assert.equal(primera.response.ok, true);
    const segunda = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target: contentOpId(session.taggedHtml), new_html: "<h1>Dos</h1>" }],
      resumen: "dos",
    });
    assert.equal(segunda.response.ok, true);
  }

  it("🔴 vuelve al estado ANTERIOR, no al actual", async () => {
    const { deps, store } = makeDeps();
    const session = makeSession();
    await editaDosVeces(session, deps);
    assert.ok(store.data.html.includes("Dos"));

    const out = await runAgentTool(session, deps, "revertir_ultimo_cambio", {});

    assert.equal(out.response.ok, true);
    // El snapshot más nuevo ES el estado actual: restaurarlo no desharía nada y
    // le diría al usuario que sí. Se vuelve al segundo.
    assert.ok(store.data.html.includes("Uno"), "no deshizo: la página sigue en el último cambio");
    assert.ok(!store.data.html.includes("Dos"));
  });

  it("la respuesta trae el documento restaurado con ids nuevos, y la sesión también", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    await editaDosVeces(session, deps);

    const out = await runAgentTool(session, deps, "revertir_ultimo_cambio", {});

    assert.equal(out.response.documento, session.taggedHtml);
    assert.ok(String(out.response.documento).includes("Uno"));
    assert.ok(String(out.response.documento).includes("data-op-id"));
    // Y el lienzo se refresca: sin esto el usuario ve la página vieja.
    assert.ok(String(out.updatedHtml).includes("Uno"));
  });

  it("y editar DESPUÉS de revertir aplica contra el documento restaurado", async () => {
    const { deps, store } = makeDeps();
    const session = makeSession();
    await editaDosVeces(session, deps);
    await runAgentTool(session, deps, "revertir_ultimo_cambio", {});

    // Los ids de antes de revertir son de otro documento: si la sesión no se
    // hubiera re-etiquetado, esto editaría a ciegas o fallaría.
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target: contentOpId(session.taggedHtml), new_html: "<h1>Tres</h1>" }],
      resumen: "tres",
    });
    assert.equal(out.response.ok, true);
    assert.ok(store.data.html.includes("Tres"));
  });

  it("sin cambio anterior lo DICE, en vez de fingir que deshizo algo", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    const out = await runAgentTool(session, deps, "revertir_ultimo_cambio", {});
    assert.equal(out.response.ok, false);
    assert.match(String(out.response.error), /no hay/i);
  });

  it("🔴 deshacer en una subpágina no toca la Home", async () => {
    const HOME = `<!doctype html><html><head><title>H</title><meta name="description" content="x"></head><body><h1 data-x="k">Home</h1></body></html>`;
    const MENU = `<!doctype html><html><head><title>M</title><meta name="description" content="x"></head><body><h1 data-x="k">Menú</h1></body></html>`;
    const { deps, store } = makeDeps({
      data: { html: HOME, pages: { menu: { html: MENU, title: "Menú" } } },
    });
    const session = makeSession({ page: "menu", html: MENU });
    await editaDosVeces(session, deps);

    const out = await runAgentTool(session, deps, "revertir_ultimo_cambio", {});

    assert.equal(out.response.ok, true);
    assert.ok(store.data.pages!.menu.html.includes("Uno"));
    // La Home, byte-intacta: los snapshots están separados por página y el
    // filtro de ámbito es lo que lo sostiene.
    assert.equal(store.data.html, HOME);
    assert.equal(out.page, "menu");
  });
});

describe("editar_pagina: un target inexistente se recupera sin otra vuelta", () => {
  it("🔴 el error trae el documento fresco y sus data-op-id", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "editar_pagina", {
      edits: [{ op: "replace", target: "no-existe-este-id", new_html: "<p>x</p>" }],
      resumen: "apunta a un id muerto",
    });
    assert.equal(out.response.ok, false);
    assert.ok(
      String(out.response.documento ?? "").includes("data-op-id"),
      "el error no trae el documento: el modelo tendría que gastar una vuelta en leer_estado",
    );
    assert.ok(String(out.response.como_hacerlo ?? "").includes("sin pedir leer_estado"));
  });

  // BRAZO DE CONTROL: un edit que SÍ aplica no arrastra el documento en la
  // respuesta. Sería pagar el payload en cada edición correcta — lo contrario
  // de lo que esto viene a ahorrar.
  it("pero un edit que aplica NO arrastra el documento", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    const doc = await runAgentTool(session, deps, "leer_estado", { incluir_documento: true });
    const id = /data-op-id="([^"]+)"/.exec(String(doc.response.documento))![1]!;
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target: id, new_html: "<p>ok</p>" }],
      resumen: "edición válida",
    });
    // El aserto que importa es el del documento. `ok` se comprueba aparte
    // porque un edit válido puede traer avisos (meta desfasada, CSS que no
    // aplica) y eso no es lo que esta prueba vigila.
    assert.equal(
      out.response.documento,
      undefined,
      `un edit correcto arrastró el documento: ${JSON.stringify(out.response).slice(0, 200)}`,
    );
  });
});

describe("editar_pagina: retirar el JavaScript del modelo", () => {
  // Ya no hay cápsula que construir: el script es parte del documento, así que
  // «la página tiene JavaScript» se dice poniéndoselo dentro.
  const CODIGO_VIVO = "document.title='vivo';";
  const HTML_VIVO = HTML.replace("</body>", `<script>${CODIGO_VIVO}</script></body>`);

  it("un edit `delete` contra runtime VACÍA la columna", async () => {
    const { deps, store } = makeDeps({ data: { html: HTML_VIVO } });

    const out = await runAgentTool(makeSession(), deps, "editar_pagina", {
      edits: [{ op: "delete", target: "runtime" }],
      resumen: "quitar el carrito",
    });

    assert.equal(out.response.ok, true);
    // El script SALE del documento guardado. Antes esto miraba una columna y
    // la distinción `null` vs `undefined` era la diferencia entre borrarlo y
    // no tocarlo; ahora borrarlo es quitar bytes del HTML.
    assert.ok(
      !store.data.html.includes(CODIGO_VIVO),
      "el borrado no quitó el script del documento",
    );
    assert.equal(
      (out.response as { comportamiento_retirado?: boolean }).comportamiento_retirado,
      true,
    );
  });

  it("un borrado NO se cuenta como turno sin cambios", async () => {
    const { deps } = makeDeps({ data: { html: HTML_VIVO } });

    const out = await runAgentTool(makeSession(), deps, "editar_pagina", {
      edits: [{ op: "delete", target: "runtime" }],
      resumen: "quitar el carrito",
    });

    // Quitar el script CAMBIA los bytes del documento, así que ni siquiera hace
    // falta la salvedad que había antes — cuando el html salía idéntico porque
    // lo que cambiaba vivía en otra columna.
    const critico = String((out.response as { aviso_critico?: string }).aviso_critico ?? "");
    assert.ok(
      !/NO cambió NADA/.test(critico),
      `dijo que no cambió nada tras un borrado: ${critico}`,
    );
  });

  it("tampoco le exige una `prueba` de lo que acaba de retirar", async () => {
    const { deps } = makeDeps({ data: { html: HTML_VIVO } });

    const out = await runAgentTool(makeSession(), deps, "editar_pagina", {
      edits: [{ op: "delete", target: "runtime" }],
      resumen: "quitar el carrito",
    });

    const critico = String((out.response as { aviso_critico?: string }).aviso_critico ?? "");
    assert.ok(!/prueba/.test(critico), `pidió prueba de un comportamiento retirado: ${critico}`);
  });

  // INVERTIDO el 2026-08-25, y con el MISMO peligro vigilado desde el otro
  // lado: un borrado desde /menu tiene que vaciar la entrada de /menu. Antes se
  // rechazaba entero para que ese `null` no llegara nunca a la columna de la
  // Home; ahora llega, pero llega con el nombre de su página.
  it("un borrado desde una SUBPÁGINA vacía la SUYA, no la de la Home", async () => {
    const dataMp: ProjectData = {
      html: HTML_VIVO,
      pages: { menu: { html: HTML_VIVO, title: "Menú" } },
    };
    const { deps, store } = makeDeps({ data: dataMp });

    const out = await runAgentTool(
      makeSession({ page: "menu", html: HTML }),
      deps,
      "editar_pagina",
      { edits: [{ op: "delete", target: "runtime" }], resumen: "quitar el carrito" },
    );

    assert.equal(out.response.ok, true, JSON.stringify(out.response));
    assert.ok(
      !store.data.pages?.menu?.html.includes(CODIGO_VIVO),
      "el borrado no quitó el script de /menu",
    );
    assert.ok(
      store.data.html.includes(CODIGO_VIVO),
      "un borrado desde /menu se llevó el de la Home",
    );
  });

  // ── CONTRA-PRUEBAS ──────────────────────────────────────────────────────
  it("CONTRA-PRUEBA: un edit `replace` con código sigue REEMPLAZANDO, no borrando", async () => {
    const { deps, store } = makeDeps({ data: { html: HTML_VIVO } });

    await runAgentTool(makeSession(), deps, "editar_pagina", {
      edits: [{ op: "replace", target: "runtime", new_html: "document.title='nuevo';" }],
      resumen: "arreglar el carrito",
    });

    assert.ok(store.data.html.includes("document.title='nuevo';"), "no llegó al documento");
  });

  it("CONTRA-PRUEBA: una edición normal PRESERVA el JavaScript (no lo borra)", async () => {
    const { deps, store } = makeDeps({ data: { html: HTML_VIVO } });
    // La sesión tiene que llevar el documento VIVO: es el que se edita.
    const session = makeSession({ html: HTML_VIVO });
    const target = contentOpId(session.taggedHtml);

    await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target, new_html: "<h1>Otro titular</h1>" }],
      resumen: "titular",
    });

    // El script sigue en el documento. No hace falta re-sellar nada: una
    // edición del titular no toca el `<script>`, igual que no toca el `<footer>`.
    assert.ok(
      store.data.html.includes(CODIGO_VIVO),
      "una edición normal se llevó el JavaScript",
    );
  });
});

// RETIRADO con el interruptor. Fijaba que con `OPENLEN_MODEL_JS=0` un edit
// de runtime se rechazara ANTES de guardar o snapshotear. No hay bandera
// que apagar: el modelo siempre puede escribir el JavaScript de su página.

describe("mutoDurable: lo que ya escribió en la base", () => {
  it("una edición del documento lo marca", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    const target = contentOpId(session.taggedHtml);

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target, new_html: "<h1>Otro</h1>" }],
      resumen: "titular",
    });

    assert.equal(out.mutoDurable, true);
  });

  // El caso que `updatedHtml` sola habría perdido: cambiar los AJUSTES es
  // igual de durable y no produce documento.
  it("un cambio de AJUSTES lo marca aunque no emita html", async () => {
    const { deps } = makeDeps();

    // Era `cambiar_motion`, retirada el 2026-08-26. `preparar_marketing` sirve
    // igual: escribe ajustes y no emite documento, que es lo que se mide.
    const out = await runAgentTool(makeSession(), deps, "preparar_marketing", {
      registro: "general",
    });

    assert.equal(out.response.ok, true, JSON.stringify(out.response));
    assert.equal(out.updatedHtml, undefined, "no debería emitir documento");
    assert.equal(out.mutoDurable, true);
  });

  // CONTRA-PRUEBA: si TODO quedara marcado, el arreglo del hallazgo 4 pintaría
  // «aplicado» sobre turnos que no tocaron nada — al revés pero igual de falso.
  it("CONTRA-PRUEBA: una lectura NO lo marca", async () => {
    const { deps } = makeDeps();

    const out = await runAgentTool(makeSession(), deps, "leer_estado", {});

    assert.equal(out.mutoDurable, undefined);
  });

  it("CONTRA-PRUEBA: una herramienta que RECHAZA sin escribir tampoco", async () => {
    const { deps } = makeDeps();

    // Un edit contra la raíz: se rechaza entero y no se guarda nada.
    const out = await runAgentTool(makeSession(), deps, "editar_pagina", {
      edits: [{ op: "replace", target: "no-existe-este-id", new_html: "<p>x</p>" }],
      resumen: "x",
    });

    assert.equal(out.response.ok, false);
    assert.equal(out.mutoDurable, undefined);
  });
});

// ─── guardar_dato_del_negocio ────────────────────────────────────────────────
//
// El dueño te da su WhatsApp una vez. Sin esto, mañana en otro proyecto se lo
// vuelves a preguntar. Y no es sólo memoria: el botón flotante de contacto, la
// banda de plataformas y el pie que se hornea al publicar leen el PERFIL, no la
// conversación ni el HTML — un teléfono que sólo está escrito en una página es
// un teléfono que ninguna de esas tres cosas encuentra.


// ─── recordar_del_negocio ────────────────────────────────────────────────────
//
// La hermana en prosa de `guardar_dato_del_negocio`: aquélla guarda VALORES que
// el código consume (el wa.me del botón), ésta guarda CONTEXTO que sólo consume
// el modelo — «hace blackwork, nada de color». Sin esto el Agente vive sólo el
// turno de hoy: la próxima página la escribe un modelo que no estuvo en la
// conversación.


// ───────────────────────────────────────────────────────────────────────────
// `redisenar_pagina` no puede morir por una clave que no usa.
//
// El guardia pedía `GEMINI_API_KEY` SIEMPRE, y el rediseño corre por Fireworks
// desde que `OPENLEN_AGENT_PROVIDER` pasó a opt-out. En una caja sin esa clave
// —el estado exacto al que apunta la salida de Gemini— la herramienta moría
// entera con un motivo FALSO: el usuario pedía «rediséñala» y oía «GEMINI_API_KEY
// no configurada» de algo que no toca Gemini.
//
// Se comprueba SIN RED a propósito: sin `FIREWORKS_API_KEY` el cliente corta en
// `missing_key` antes de abrir un socket.
describe("redisenar_pagina y la clave que no usa", () => {
  const ENTRADA: RedesignInput = {
    html: HTML,
    direccion: "más moderna y oscura",
    brief: null,
  };

  async function conEntorno(
    env: Record<string, string | undefined>,
    fn: () => Promise<void>,
  ) {
    const previo: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(env)) {
      previo[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(previo)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  it("el rediseño no pide ninguna clave de Gemini, ponga lo que ponga el entorno", async () => {
    // Aqui habia tres casos que describian `OPENLEN_AGENT_PROVIDER=gemini`,
    // incluido un brazo de control que EXIGIA el mensaje «GEMINI_API_KEY no
    // configurada». Con el proveedor fuera (2026-08-28) ese mensaje no puede
    // volver a existir, y esto es la guarda: se pone el valor que antes lo
    // producia y se comprueba que no aparece.
    await conEntorno(
      {
        GEMINI_API_KEY: undefined,
        FIREWORKS_API_KEY: undefined,
        OPENLEN_AGENT_PROVIDER: "gemini",
      },
      async () => {
        const r = await realDeps().redesignDocument("u-prueba", ENTRADA);
        assert.equal(r.ok, false);
        assert.notEqual(
          r.ok === false ? r.error : "",
          "GEMINI_API_KEY no configurada",
          "volvio el guardia que pedia una clave que esta ruta no usa",
        );
      },
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// EL AVISO DE PIVOTAR CUENTA VACÍAS SEGUIDAS, NO BÚSQUEDAS.
//
// MEDIDO el 2026-08-28: `hero-terror-sin-fotos` («un hero tipo Fears to
// Fathom») quemó 272.308 tokens en Flash y murió en el tope de PASOS del bucle
// — sus 6 vueltas se agotaron antes de que el techo de 6 búsquedas mordiera.
//
// 🔴 BAJAR ESE TECHO A 3 ARREGLARÍA ESE CASO ROMPIENDO OTRO: cuenta TODAS las
// búsquedas, encuentren o no, así que una galería de cuatro fotos distintas
// —cuatro búsquedas productivas— se quedaría a medias. Lo que delata el
// callejón sin salida son las vacías CONSECUTIVAS.
//
// ⚠️ Y NO SE BLOQUEA LA BÚSQUEDA. Se probó y es peor negocio: buscar no es una
// llamada al modelo, es un filtro local, así que bloquearla no ahorra nada y
// puede dejar al usuario sin una foto que existía.
describe("el aviso de pivotar cuenta vacías SEGUIDAS", () => {
  const NADA = { busqueda: "esto-no-existe-en-el-catalogo" };

  it("a la segunda vacía seguida el aviso pasa a ser el pivote", async () => {
    const { deps } = makeDeps();
    const session = makeSession();

    const primera = await runAgentTool(session, deps, "elegir_foto", NADA);
    assert.ok(String(primera.response.nota).includes("UNA vez más"));

    const segunda = await runAgentTool(session, deps, "elegir_foto", NADA);
    assert.ok(String(segunda.response.nota).includes("acotado"));
    assert.ok(String(segunda.response.nota).includes("degradado"));
  });

  it("una que SÍ encuentra reinicia la cuenta", async () => {
    const { deps } = makeDeps();
    const session = makeSession();

    await runAgentTool(session, deps, "elegir_foto", NADA);
    await runAgentTool(session, deps, "elegir_foto", NADA);
    assert.equal(session.busquedasVaciasSeguidas, 2);

    // Encuentra → la cuenta vuelve a cero. Y la búsqueda NO estaba bloqueada:
    // ésa es la diferencia con la pared dura que se descartó.
    const buena = await runAgentTool(session, deps, "elegir_foto", { busqueda: "portfolio" });
    assert.ok((buena.response.fotos as unknown[]).length > 0);
    assert.equal(session.busquedasVaciasSeguidas, 0);

    // Por tanto la siguiente vacía vuelve a ser la PRIMERA: consejo suave.
    const siguiente = await runAgentTool(session, deps, "elegir_foto", NADA);
    assert.ok(String(siguiente.response.nota).includes("UNA vez más"));
  });

  // EL CASO QUE BAJAR EL TECHO A 3 HABRÍA ROTO.
  it("cuatro búsquedas PRODUCTIVAS seguidas nunca llegan al pivote", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    for (let i = 0; i < 4; i++) {
      const out = await runAgentTool(session, deps, "elegir_foto", { busqueda: "portfolio" });
      assert.ok(
        (out.response.fotos as unknown[]).length > 0,
        `la búsqueda productiva #${i + 1} volvió vacía: el tope cuenta lo que no debe`,
      );
    }
    assert.equal(session.busquedasVaciasSeguidas, 0);
  });
});


// ── LAS DOS HERRAMIENTAS QUE ESCRIBEN DOCUMENTO LO DECLARAN IGUAL ──────────
//
// `editar_pagina` sabía decir «no cambié nada» y `cambiar_tema` no: devolvía
// `ok: true` con `tokens_aplicados` aunque no hubiera movido un byte. Y ninguna
// de las dos sabía decir «no lo sé», que es lo que pasa cuando no hay documento
// anterior con el que comparar. Ahora las dos construyen la respuesta desde el
// mismo sitio.
describe("qué le pasó al documento, dicho y no inferido", () => {
  it("editar_pagina declara CAMBIO con los dos hashes", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [
        {
          op: "replace",
          target: contentOpId(session.taggedHtml),
          new_html: "<h1>Tacos El Mejor</h1>",
        },
      ],
      resumen: "cambiar el titular",
    });
    assert.equal(out.response.ok, true);
    assert.equal(out.response.cambio, "cambio");
    assert.match(String(out.response.hash_antes), /^[0-9a-f]{16}$/);
    assert.match(String(out.response.hash_despues), /^[0-9a-f]{16}$/);
    assert.notEqual(out.response.hash_antes, out.response.hash_despues);
  });

  it("y declara SIN_CAMBIO cuando el documento sale idéntico", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    // La ficha cruda NO ha pasado por la puerta de HTML, y la puerta
    // transforma: la primera escritura de cualquier turno difiere siempre. Así
    // que se escribe una vez para dejar guardado un documento ya normalizado, y
    // se mide la SEGUNDA.
    const edit = (target: string) => ({
      edits: [{ op: "replace", target, new_html: "<h1>Tacos El Mejor</h1>" }],
      resumen: "el titular",
    });
    const primera = await runAgentTool(
      session,
      deps,
      "editar_pagina",
      edit(contentOpId(session.taggedHtml)),
    );
    assert.equal(primera.response.cambio, "cambio");

    // El MISMO marcado, carácter por carácter: es el fallo medido el 22/08 —
    // el modelo reproducía el original y cerraba diciendo que lo arregló.
    const out = await runAgentTool(
      session,
      deps,
      "editar_pagina",
      edit(contentOpId(session.taggedHtml)),
    );
    assert.equal(out.response.ok, true);
    assert.equal(out.response.cambio, "sin_cambio");
    assert.equal(out.response.sin_cambios, true);
    // Y se le DICE al modelo, para que no cierre afirmando un arreglo.
    assert.match(String(out.response.aviso_critico), /NO cambió NADA/);
  });

  it("cambiar_tema también lo declara — antes no sabía decirlo", async () => {
    const { deps } = makeDeps({ data: { html: THEMED_HTML } });
    const session = makeSession({ html: THEMED_HTML });
    const out = await runAgentTool(session, deps, "cambiar_tema", { accent: "#ff0055" });
    assert.equal(out.response.ok, true);
    assert.ok(
      out.response.cambio === "cambio" || out.response.cambio === "sin_cambio",
      `esperaba una de las tres variantes, vino ${String(out.response.cambio)}`,
    );
  });
});

// ── EL ESTADO DESCRIBE EL DOCUMENTO, no sólo el proyecto ───────────────────
//
// Contaba título, subdominio, páginas y módulos, y ni una palabra del documento
// que el Agente va a editar. Así que el modelo descubría los hechos más caros
// chocándose con ellos: MEDIDO el 2026-08-22, sólo 7 de las 178 plantillas
// dicen `var(--ol-…)` en su CSS — en las otras 171 `cambiar_tema` no mueve
// nada, y el modelo gastaba una llamada entera en enterarse de algo que se sabe
// mirando el CSS.
describe("el ESTADO cuenta cómo es el documento", () => {
  const fila = (html: string, pages?: Record<string, { html: string }>) => ({
    data: { html, ...(pages ? { pages } : {}) },
    title: "Tacos",
    subdomain: null,
    publishedAt: null,
  });

  it("dice QUÉ tokens lee la página, no si lee alguno", () => {
    const html =
      `<html><head><style>body{background:var(--ol-bg);color:var(--ol-fg)}</style></head><body><h1>x</h1></body></html>`;
    const s = summarizeProjectState(fila(html));
    assert.deepEqual(s.lee_tokens, ["--ol-bg", "--ol-fg"]);
  });

  it("y una página que no lee ninguno lo dice con una lista vacía", () => {
    // 171 de 178 plantillas están así: `cambiar_tema` escribiría el token y la
    // página se quedaría exactamente igual.
    const s = summarizeProjectState(fila(HTML));
    assert.deepEqual(s.lee_tokens, []);
  });

  it("dice el modo, que es claro salvo que la raíz diga lo contrario", () => {
    assert.equal(summarizeProjectState(fila(HTML)).modo, "light");
    const oscuro = `<html data-ol-mode="dark"><body><h1>x</h1></body></html>`;
    assert.equal(summarizeProjectState(fila(oscuro)).modo, "dark");
  });

  it("dice la tipografía del titular cuando la página la declara", () => {
    const conFuente = `<html style="--ol-font-display:'Fraunces',serif"><body><h1>x</h1></body></html>`;
    assert.deepEqual(summarizeProjectState(fila(conFuente)).fuentes, { titular: "Fraunces" });
  });

  it("y se calla cuando no hay ninguna declarada — mejor nada que inventada", () => {
    assert.equal(summarizeProjectState(fila(HTML)).fuentes, undefined);
  });

  /**
   * 🔴 Y DESCRIBE LA PÁGINA ACTIVA, no siempre la Home.
   *
   * Es el mismo eje por el que ya se habían equivocado los ojos —aprobar el
   * trabajo mirando otra página— y la lista de páginas: el Agente puede estar
   * trabajando en /menu, y los rasgos de la portada no dicen nada de ella.
   */
  it("describe la página ACTIVA, no la Home", () => {
    const home = `<html><body><h1>portada</h1></body></html>`;
    const menu =
      `<html data-ol-mode="dark"><head><style>a{color:var(--ol-accent)}</style></head><body><h1>menu</h1></body></html>`;
    const row = fila(home, { menu: { html: menu } });

    const enHome = summarizeProjectState(row);
    assert.deepEqual(enHome.lee_tokens, []);
    assert.equal(enHome.modo, "light");

    const enMenu = summarizeProjectState(row, "menu");
    assert.deepEqual(enMenu.lee_tokens, ["--ol-accent"]);
    assert.equal(enMenu.modo, "dark");
  });

  it("un documento vacío no inventa rasgos", () => {
    const s = summarizeProjectState(fila(""));
    assert.equal(s.lee_tokens, undefined);
    assert.equal(s.modo, undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LAS DOS GUARDAS QUE BAJARON DEL PROMPT AL CÓDIGO (2026-09-01).
//
// Las dos existían como reglas 🔴 del prompt del Agente y nada las hacía
// cumplir: si el modelo las ignoraba, el usuario perdía trabajo y no se
// enteraba. Ahora son hechos que la herramienta le devuelve al modelo, y el
// modelo tiene que responder por ellos.
// ─────────────────────────────────────────────────────────────────────────────
describe("secciones_tocadas — el modelo se entera de QUÉ tocó", () => {
  // 🔴 MEDIDO el 2026-09-02 con una página de 80 secciones: a «borra entera la
  // sección número 40» el modelo borró la 41 y cerró diciendo que había borrado
  // la 40. El índice no era ambiguo; se le fue una fila. No se puede impedir que
  // un modelo lea mal — lo que sí se puede es devolverle por escrito lo que
  // acaba de tocar, mientras todavía está a tiempo de arreglarlo.
  const TRES = `<!doctype html><html><head><title>T</title></head><body>` +
    `<header><h1>Portada</h1></header>` +
    `<section><h2>Seccion numero 39</h2><p>a</p></section>` +
    `<section><h2>Seccion numero 40</h2><p>b</p></section>` +
    `<section><h2>Seccion numero 41</h2><p>c</p></section>` +
    `</body></html>`;

  function idDeSeccion(tagged: string, titulo: string): string {
    // El op-id de la <section> que contiene ese encabezado.
    const i = tagged.indexOf(titulo);
    const antes = tagged.slice(0, i);
    const m = [...antes.matchAll(/<section[^>]*data-op-id="([^"]+)"/g)].pop();
    if (!m) throw new Error("no encontré la sección de " + titulo);
    return m[1];
  }

  it("dice por su NOMBRE la sección que se quitó", async () => {
    const session = makeSession({ html: TRES });
    const { deps } = makeDeps({ data: { html: TRES } });
    const target = idDeSeccion(session.taggedHtml, "Seccion numero 41");

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "delete", target }],
      resumen: "quitar una sección",
    });

    assert.equal(out.response.ok, true, JSON.stringify(out.response));
    const tocadas = (out.response as { secciones_tocadas?: string[] }).secciones_tocadas;
    assert.deepEqual(tocadas, ['quitaste: "Seccion numero 41"']);
  });

  it("y distingue reemplazar de quitar", async () => {
    const session = makeSession({ html: TRES });
    const { deps } = makeDeps({ data: { html: TRES } });
    const target = idDeSeccion(session.taggedHtml, "Seccion numero 40");

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target, new_html: "<section><h2>Otra cosa</h2></section>" }],
      resumen: "reemplazar",
    });

    assert.equal(out.response.ok, true, JSON.stringify(out.response));
    const tocadas = (out.response as { secciones_tocadas?: string[] }).secciones_tocadas;
    assert.deepEqual(tocadas, ['reemplazaste: "Seccion numero 40"']);
  });
});

describe("guardas de persistHtmlChange", () => {
  const CON_FORM = `<!doctype html><html><head><title>T</title></head><body><h1>Taller</h1><form><label>Correo<input name="correo"></label><button type="submit">Enviar</button></form></body></html>`;

  it("avisa cuando el turno PISA una edición que entró mientras pensaba", async () => {
    // La sesión cree que en disco está `HTML`; en disco hay otra cosa, porque
    // el usuario editó por la pestaña Contenido en mitad del turno.
    const enDisco = HTML.replace("Los mejores del barrio.", "Abrimos domingos.");
    const session = makeSession();
    session.baseHtml = HTML;
    const { deps, store } = makeDeps({ data: { html: enDisco } });

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target: contentOpId(session.taggedHtml), new_html: "<h1>Tacos El Güero 2</h1>" }],
      resumen: "titular",
    });

    assert.equal(out.response.ok, true);
    assert.equal((out.response as { piso_edicion_del_usuario?: boolean }).piso_edicion_del_usuario, true);
    const critico = String((out.response as { aviso_critico?: string }).aviso_critico ?? "");
    assert.ok(/pisad|reemplazad|mientras pensabas/i.test(critico), critico);
    // Y la versión del ANTES lleva el motivo en su etiqueta: sin eso queda
    // indistinguible de las decenas de «Before AI edit» de un día normal.
    assert.ok(
      store.versions.some((l) => /antes de que el Agente la pisara/i.test(l)),
      JSON.stringify(store.versions),
    );
  });

  it("NO avisa en el caso corriente: nadie tocó nada mientras tanto", async () => {
    const session = makeSession();
    session.baseHtml = HTML;
    const { deps } = makeDeps({ data: { html: HTML } });

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target: contentOpId(session.taggedHtml), new_html: "<h1>Tacos El Güero 2</h1>" }],
      resumen: "titular",
    });

    assert.equal(out.response.ok, true);
    assert.equal((out.response as { piso_edicion_del_usuario?: boolean }).piso_edicion_del_usuario, undefined);
  });

  it("cuenta los formularios que la edición se llevó por delante", async () => {
    // El caso medido el 2026-08-31: el usuario tenía una sección con su
    // formulario y el modelo la reescribió sin él «porque es más honesto».
    const session = makeSession({ html: CON_FORM });
    const { deps } = makeDeps({ data: { html: CON_FORM } });

    // El `<form>` es hermano del <h1>, así que hay que apuntarle a él: es
    // exactamente lo que hizo el modelo en el caso real —sustituir el
    // formulario por un enlace de WhatsApp—.
    const formOpId = /<form[^>]*data-op-id="([^"]+)"/.exec(session.taggedHtml)?.[1];
    assert.ok(formOpId, "el fixture tiene que traer un <form> etiquetado");
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{
        op: "replace",
        target: formOpId,
        new_html: '<a href="https://wa.me/34600111222">Escríbenos por WhatsApp</a>',
      }],
      resumen: "contacto por whatsapp",
    });

    assert.equal(out.response.ok, true);
    assert.equal((out.response as { formularios_perdidos?: number }).formularios_perdidos, 1);
    const critico = String((out.response as { aviso_critico?: string }).aviso_critico ?? "");
    assert.ok(/formulario/i.test(critico), critico);
  });

  it("una edición que no toca el formulario no lo cuenta como perdido", async () => {
    const session = makeSession({ html: CON_FORM });
    const { deps } = makeDeps({ data: { html: CON_FORM } });

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target: contentOpId(session.taggedHtml), new_html: "<h1>Taller El Norte</h1>" }],
      resumen: "titular",
    });

    assert.equal(out.response.ok, true, JSON.stringify(out.response));
    assert.equal((out.response as { formularios_perdidos?: number }).formularios_perdidos, undefined);
  });
});

// ───── LA FOTO DEL DUEÑO, EN EL CAMINO DE EDICIÓN ─────
//
// PRUEBA DE CABLE, no de lógica. La lógica ya la sujeta facts-kept.test.ts. Lo
// que se comprueba aquí es lo ÚNICO que fallaba: que la guarda esté ENCHUFADA a
// `editar_pagina`. Existía desde el 22/08 — colgada de `redisenar_pagina`, que
// el Agente no llamó ni una vez en seis turnos seguidos del conductor
// multiturno. Una guarda en la herramienta equivocada es no tener guarda.
describe("editar_pagina avisa cuando se lleva por delante la foto del dueño", () => {
  const FOTO = "https://images.openlen.com/fachada-aurora.webp";
  const OTRA = "https://images.openlen.com/fachada-nueva.webp";
  const CON_FOTO = `<!doctype html><html><body><h1>Aurora</h1><section><img src="${FOTO}" alt="Fachada"></section></body></html>`;

  function imgOpId(taggedHtml: string): string {
    const m = /<img[^>]*data-op-id="([^"]+)"/.exec(taggedHtml);
    if (!m) throw new Error("no data-op-id found for img");
    return m[1];
  }

  it("tapar la foto con un sólido la nombra y pide reponerla", async () => {
    const { deps } = makeDeps();
    const session = makeSession({ html: CON_FOTO });

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [
        {
          op: "replace",
          target: imgOpId(session.taggedHtml),
          new_html: '<div style="background:#0b1220;height:420px"></div>',
        },
      ],
      resumen: "arreglar contraste del hero",
    });

    assert.equal(out.response.ok, true);
    const aviso = String(out.response.aviso_critico ?? "");
    assert.ok(aviso.includes(FOTO), `el aviso no nombra la foto: ${aviso}`);
    assert.match(aviso, /reponlo AHORA/i);
  });

  it("BRAZO DE CONTROL: sustituir la foto NO avisa — se lo pidieron", async () => {
    const { deps } = makeDeps();
    const session = makeSession({ html: CON_FOTO });

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [
        {
          op: "attrs",
          target: imgOpId(session.taggedHtml),
          attrs: [{ name: "src", value: OTRA }],
        },
      ],
      resumen: "cambiar la foto",
    });

    assert.equal(out.response.ok, true);
    const aviso = String(out.response.aviso_critico ?? "");
    assert.ok(!aviso.includes(FOTO), `lloró al lobo con una sustitución: ${aviso}`);
  });
});

// ───── op="text": el verbo que faltaba ─────
//
// PRUEBA DE CABLE. La logica la sujeta el crate (tests/ops_apply.rs, siete
// casos con sus brazos). Aqui se comprueba lo unico que el crate no puede: que
// el verbo LLEGUE — que `editar_pagina` lo acepte, lo convierta y lo pase al
// motor. Es la leccion de `attrs`, que estuvo un dia entero dentro del motor
// sin que nadie se lo ofreciera al modelo, y por tanto no existia.
describe("editar_pagina acepta op=text y no reescribe el nodo", () => {
  const CON_CLASE = '<!doctype html><html><body><h1 class="titulo grande">Viejo</h1></body></html>';
  const CON_HIJOS = '<!doctype html><html><body><section><h2>Titulo</h2><img src="f.webp"></section></body></html>';

  function opIdDe(taggedHtml: string, etiqueta: string): string {
    const re = new RegExp(`<${etiqueta}[^>]*data-op-id="([^"]+)"`);
    const m = re.exec(taggedHtml);
    if (!m) throw new Error(`sin data-op-id para <${etiqueta}>`);
    return m[1];
  }

  it("cambia el texto y CONSERVA las clases — lo que replace obligaba a reteclear", async () => {
    const { deps, store } = makeDeps();
    const session = makeSession({ html: CON_CLASE });

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "text", target: opIdDe(session.taggedHtml, "h1"), text: "Nuevo" }],
      resumen: "nuevo titular",
    });

    assert.equal(out.response.ok, true);
    assert.ok(store.data.html.includes("Nuevo"), store.data.html);
    assert.ok(!store.data.html.includes("Viejo"), store.data.html);
    assert.ok(store.data.html.includes('class="titulo grande"'), store.data.html);
  });

  it("BRAZO DE CONTROL: sobre un nodo con hijos se NIEGA y dice a que id apuntar", async () => {
    const { deps, store } = makeDeps();
    const session = makeSession({ html: CON_HIJOS });
    const antes = store.data.html;

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "text", target: opIdDe(session.taggedHtml, "section"), text: "Hola" }],
      resumen: "texto de la seccion",
    });

    assert.equal(out.response.ok, false);
    const detalle = JSON.stringify(out.response);
    assert.match(detalle, /hijo/i);
    // La pagina no se toco: ni el titulo ni la foto se fueron.
    assert.equal(store.data.html, antes);
  });

  it("op=text sin `text` se rechaza antes de llegar al motor", async () => {
    const { deps } = makeDeps();
    const session = makeSession({ html: CON_CLASE });

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "text", target: opIdDe(session.taggedHtml, "h1") }],
      resumen: "sin texto",
    });

    assert.equal(out.response.ok, false);
    assert.match(String(out.response.error), /`text`/);
  });
});

// ───── IDS ESTABLES: editar dos veces sin releer ─────
//
// LA PROPIEDAD DE TERMINAL. Claude Code lo dice al reves en sus instrucciones:
// «no releas un fichero que acabas de editar». Aqui releer era OBLIGATORIO —
// `apply_ops` quitaba los ids, se re-etiquetaba desde cero y la numeracion se
// desplazaba. Cada edicion costaba una vuelta extra, y cada vuelta reenvia el
// sobre entero (18.580 tokens).
//
// 🔴 LA EDICION TIENE QUE DESPLAZAR. Primera version de estas pruebas: un
// `attrs`, que no mueve la estructura — y entonces re-etiquetar desde cero daba
// los MISMOS ids por casualidad, asi que pasaban igual con el cambio
// desconectado. Eran promesas, no pruebas. Con un `insert_before` al principio
// del documento, la numeracion vieja se corre entera y la diferencia se ve.
describe("las direcciones sobreviven a una edicion que desplaza", () => {
  const DOC = '<!doctype html><html><body><h1>uno</h1><p>dos</p><span>tres</span></body></html>';

  function idsDe(html: string): string[] {
    return [...html.matchAll(/data-op-id="([^"]+)"/g)].map((m) => m[1]);
  }
  /** El id del elemento cuyo texto es `texto`, en el documento etiquetado. */
  function idPorTexto(html: string, texto: string): string {
    const re = new RegExp(`data-op-id="([^"]+)"[^>]*>${texto}<`);
    const m = re.exec(html);
    if (!m) throw new Error(`no encuentro "${texto}" en ${html}`);
    return m[1];
  }

  it("insertar al principio NO renumera lo que venia detras", async () => {
    const { deps } = makeDeps();
    const session = makeSession({ html: DOC });
    const idSpanAntes = idPorTexto(session.taggedHtml, "tres");
    const idH1 = idPorTexto(session.taggedHtml, "uno");

    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "insert_before", target: idH1, new_html: "<nav>menu</nav>" }],
      resumen: "un nav arriba",
    });
    assert.equal(out.response.ok, true, JSON.stringify(out.response));

    // El <span> no se toco: su direccion tiene que ser la MISMA. Sin ids
    // estables se habria corrido, porque ahora tiene un <nav> delante.
    assert.equal(
      idPorTexto(session.taggedHtml, "tres"),
      idSpanAntes,
      `el span se renumero:\n${session.taggedHtml}`,
    );
    // Y el <nav> nuevo estrena id, sin pisar ninguno.
    const ids = idsDe(session.taggedHtml);
    assert.equal(new Set(ids).size, ids.length, `ids repetidos: ${ids.join(",")}`);
  });

  it("SE PUEDE EDITAR OTRA VEZ con un id de ANTES, sin leer_estado en medio", async () => {
    // Lo unico que importa de todo el cambio. Sin ids estables, tras insertar
    // un <nav> el id del <p> pasa a ser el del <h1>: el segundo edit escribiria
    // en el elemento equivocado.
    const { deps, store } = makeDeps();
    const session = makeSession({ html: DOC });
    const idH1 = idPorTexto(session.taggedHtml, "uno");
    const idParrafo = idPorTexto(session.taggedHtml, "dos");

    const primera = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "insert_before", target: idH1, new_html: "<nav>menu</nav>" }],
      resumen: "un nav arriba",
    });
    assert.equal(primera.response.ok, true, JSON.stringify(primera.response));

    // El MISMO id de antes de la primera edicion, sin releer nada.
    const segunda = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "text", target: idParrafo, text: "dos bis" }],
      resumen: "texto al parrafo",
    });
    assert.equal(segunda.response.ok, true, JSON.stringify(segunda.response));

    // Y escribio en el PARRAFO, no en otro elemento.
    assert.match(store.data.html, /<p[^>]*>dos bis<\/p>/, store.data.html);
    assert.ok(store.data.html.includes("<h1>uno</h1>"), store.data.html);
    assert.ok(store.data.html.includes("<nav>menu</nav>"), store.data.html);
  });

  it("BRAZO DE CONTROL: lo que se GUARDA nunca lleva ids", async () => {
    // La copia con ids es de la sesion. Persistirla rompio un proyecto real el
    // 2026-08-23: `tag_with_op_ids` salta lo ya etiquetado, asi que al turno
    // siguiente taggedCount=0 y la ruta responde 400 para siempre.
    const { deps, store } = makeDeps();
    const session = makeSession({ html: DOC });
    const idH1 = idPorTexto(session.taggedHtml, "uno");

    await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "insert_before", target: idH1, new_html: "<nav>menu</nav>" }],
      resumen: "un nav",
    });

    assert.ok(!store.data.html.includes("data-op-id"), store.data.html);
    assert.ok(!session.baseHtml?.includes("data-op-id"), String(session.baseHtml));
    assert.ok(session.taggedHtml.includes("data-op-id"), session.taggedHtml);
  });
});
