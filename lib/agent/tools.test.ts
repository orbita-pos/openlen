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
import { BEHAVIOR_NAMES } from "@/lib/behaviors/doc";
import type { ProjectData } from "@/lib/projects/types";
import { aprenderDelNegocio } from "@/lib/business-profiles/aprender";
import { recordarDelNegocio } from "@/lib/business-profiles/documento";
import type { BusinessProfileData } from "@/lib/business-profiles/types";

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
    profileNumber: string | null;
    businessProfile: import("@/lib/business-profiles/types").BusinessProfileData | null;
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
    perfilNegocio: {} as BusinessProfileData,
    versions: [] as string[],
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
    async loadBusinessProfile() { return overrides?.businessProfile ?? null; },
    async redesignDocument(_u, input) {
      store.redesigns.push(input);
      return overrides?.redesignResult ?? {
        ok: true,
        html: `<!doctype html><html lang="es"><head><title>Rediseñada</title></head><body><h1>Nuevo diseño</h1></body></html>`,
        usage: { inputTokens: 10_000, outputTokens: 8_000, cachedTokens: 0 },
        modelRuntime: null,
      };
    },
    async snapshotVersion(a) { store.versions.push(a.label); store.versionPages.push(a.page); },
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
    async setCollectionSheetSource() {
      throw new Error("setCollectionSheetSource not stubbed in this test");
    },
    async syncCollection() {
      throw new Error("syncCollection not stubbed in this test");
    },
    async clearCollectionSource() {
      throw new Error("clearCollectionSource not stubbed in this test");
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
    async learnAboutBusiness(_p: string, _u: string, campo: string, valor: string) {
      const r = aprenderDelNegocio(store.perfilNegocio, campo, valor);
      if (!r.ok) return { ok: false as const, motivo: r.motivo };
      store.perfilNegocio = r.data;
      return { ok: true as const, anterior: r.anterior, cambio: r.cambio };
    },
    async rememberAboutBusiness(_p: string, _u: string, nota: string) {
      const r = recordarDelNegocio(store.perfilNegocio, nota);
      if (!r.ok) return { ok: false as const, motivo: r.motivo };
      store.perfilNegocio = r.data;
      return { ok: true as const, yaExistia: r.yaExistia };
    },
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
    // `members` se retiró (2026-08-21); `collections` es un módulo VIVO y sirve
    // igual para lo que esto vigila: que el estado nazca con todo apagado.
    assert.equal((s.modulos as Record<string, boolean>).collections, false);
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

  it("el motor recibe el negocio del perfil (hechos reales para el rediseño)", async () => {
    const { deps, store } = makeDeps({
      businessProfile: {
        business_name: "Tacos El Güero", industry: "taquería",
        tagline_es: null, tagline_en: null, pitch: null, hero_keyword: null,
        features: [], pricing: [], testimonials: [], cta_primary: null,
        cta_secondary: null, faq_questions: [], language_detected: null,
        contact: { whatsapp: "6671234567", phone: null, email: null, address: null, socials: null },
      },
    });
    await runAgentTool(makeSession(), deps, "redisenar_pagina", CALL);
    const negocio = store.redesigns[0].negocio as Record<string, unknown>;
    assert.equal(negocio?.nombre, "Tacos El Güero");
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
});

// Arreglo 1 (revisión final de rama) — la nómina de conductas ("countdown,
// filter, lightbox, copy, autoplay, theme, sticky", y el número "7") vivía
// hardcodeada en CUATRO sitios en prosa que el modelo lee, dos de ellos
// literalmente "siete" — la imagen especular del bug fundacional del
// proyecto. lib/behaviors/prose-derivation.test.ts (vitest, registro
// mockeado con una 8ª receta falsa) prueba los otros 3 sitios
// (design-guidance.ts, agent/catalog.ts, lib/behaviors/doc.ts); ESTE archivo
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

  it("la llamada real (sin segundo argumento) usa BEHAVIOR_NAMES — la MISMA constante derivada que design-guidance.ts/agent/catalog.ts/lib/behaviors/doc.ts", () => {
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

describe("leer_estado", () => {
  it("returns fresh module state after a mutation", async () => {
    const { deps } = makeDeps();
    const session = makeSession();
    // El ejemplo era Reservas; se retiró (2026-08-21). Lo que esta prueba
    // vigila —que `leer_estado` vea la mutación del turno anterior y no una
    // copia rancia— sigue vivo con cualquier módulo.
    await runAgentTool(session, deps, "activar_modulo", { modulo: "collections" });
    const out = await runAgentTool(session, deps, "leer_estado", {});
    assert.equal((out.response.modulos as Record<string, boolean>).collections, true);
  });
  it("incluir_documento returns a freshly tagged doc", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "leer_estado", { incluir_documento: true });
    assert.ok(String(out.response.documento).includes("data-op-id"));
  });
  it("pagina_activa is 'principal' on home", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "leer_estado", {});
    assert.equal(out.response.pagina_activa, "principal");
  });
  // P2 — el bloque negocio viaja en cada leer_estado cuando hay perfil real.
  it("negocio rides leer_estado when the project has a filled profile", async () => {
    const { deps } = makeDeps({
      businessProfile: {
        business_name: "Tacos El Güero",
        industry: "taquería",
        tagline_es: null, tagline_en: null, pitch: null, hero_keyword: null,
        features: [], pricing: [], testimonials: [],
        cta_primary: null, cta_secondary: null, faq_questions: [],
        language_detected: null,
        contact: {
          whatsapp: "6671234567", phone: null, email: null, address: null,
          socials: { instagram: "https://instagram.com/elguero", facebook: null, tiktok: null, website: null },
        },
      },
    });
    const out = await runAgentTool(makeSession(), deps, "leer_estado", {});
    const negocio = out.response.negocio as Record<string, unknown>;
    assert.equal(negocio.nombre, "Tacos El Güero");
    assert.equal((negocio.contacto as Record<string, string>).whatsapp, "6671234567");
    assert.equal((negocio.redes as Record<string, string>).instagram, "https://instagram.com/elguero");
  });
  it("negocio is ABSENT (not null) when there is no profile", async () => {
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

  it("y collections, que SÍ existe, sigue naciendo con su sección", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "crear_pagina", { modulo: "collections" });
    assert.equal(out.response.ok, true);
    assert.equal(store.saved.length, 1);
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

describe("guardar_dato_del_negocio", () => {
  it("guarda un dato nuevo y lo anuncia como del NEGOCIO, no de la página", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "guardar_dato_del_negocio", {
      campo: "whatsapp",
      valor: "5213312345678",
    });
    assert.equal(out.response.ok, true);
    assert.equal(store.perfilNegocio.contact?.whatsapp, "5213312345678");
    assert.match(String(out.response.nota), /todas sus p/i);
    // Deja tarjeta: el usuario tiene que VER que se guardó algo suyo.
    assert.equal(out.action?.tool, "guardar_dato_del_negocio");
  });

  /**
   * PISAR UN DATO EN SILENCIO ES CÓMO SE PIERDE EL NÚMERO QUE SÍ FUNCIONABA.
   * La herramienta devuelve lo que había y le ORDENA al modelo decirlo.
   */
  it("al sustituir, devuelve el valor anterior y pide que se diga", async () => {
    const { deps } = makeDeps();
    const s = makeSession();
    await runAgentTool(s, deps, "guardar_dato_del_negocio", {
      campo: "whatsapp",
      valor: "5213311111111",
    });
    const out = await runAgentTool(s, deps, "guardar_dato_del_negocio", {
      campo: "whatsapp",
      valor: "5213399999999",
    });
    assert.equal(out.response.anterior, "5213311111111");
    assert.match(String(out.response.nota), /SUSTITUISTE/);
  });

  /** Si el dato ya era ése, una tarjeta de acción le diría al usuario que se
   *  hizo algo que no se hizo. */
  it("y si ya estaba, no anuncia nada", async () => {
    const { deps } = makeDeps();
    const s = makeSession();
    const args = { campo: "email", valor: "hola@aguja.mx" };
    await runAgentTool(s, deps, "guardar_dato_del_negocio", args);
    const out = await runAgentTool(s, deps, "guardar_dato_del_negocio", args);
    assert.equal(out.response.ya_estaba, true);
    assert.equal(out.action, undefined);
  });

  /**
   * EL MOTIVO VIAJA COMO TEXTO ACCIONABLE. «campo_desconocido» no le dice al
   * modelo qué hacer distinto; la lista de campos válidos sí.
   */
  it("un campo que nadie lee se rechaza NOMBRANDO los que valen", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "guardar_dato_del_negocio", {
      campo: "color_favorito",
      valor: "azul",
    });
    assert.equal(out.response.ok, false);
    assert.match(String(out.response.error), /whatsapp/);
    assert.deepEqual(store.perfilNegocio, {});
  });
});

// ─── recordar_del_negocio ────────────────────────────────────────────────────
//
// La hermana en prosa de `guardar_dato_del_negocio`: aquélla guarda VALORES que
// el código consume (el wa.me del botón), ésta guarda CONTEXTO que sólo consume
// el modelo — «hace blackwork, nada de color». Sin esto el Agente vive sólo el
// turno de hoy: la próxima página la escribe un modelo que no estuvo en la
// conversación.

describe("recordar_del_negocio", () => {
  it("apunta una nota y la anuncia como durable", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "recordar_del_negocio", {
      nota: "El estudio hace blackwork, nada de color",
    });
    assert.equal(out.response.ok, true);
    assert.match(String(out.response.nota), /de aqu[íi] en adelante/i);
    assert.match(String(store.perfilNegocio.memoria), /blackwork/);
    assert.equal(out.action?.tool, "recordar_del_negocio");
  });

  /** ACUMULA, al revés que un dato duro: lo que el dueño cuenta son muchas
   *  cosas, y la segunda no desmiente a la primera. */
  it("y la siguiente se suma, no sustituye", async () => {
    const { deps, store } = makeDeps();
    const s = makeSession();
    await runAgentTool(s, deps, "recordar_del_negocio", { nota: "Hace blackwork" });
    await runAgentTool(s, deps, "recordar_del_negocio", { nota: "Atiende con cita" });
    assert.match(String(store.perfilNegocio.memoria), /blackwork/);
    assert.match(String(store.perfilNegocio.memoria), /cita/);
  });

  /** Anunciar una escritura que no ocurrió le enseña al usuario un cambio
   *  inexistente. */
  it("si ya estaba, no deja tarjeta", async () => {
    const { deps } = makeDeps();
    const s = makeSession();
    const args = { nota: "Hace blackwork" };
    await runAgentTool(s, deps, "recordar_del_negocio", args);
    const out = await runAgentTool(s, deps, "recordar_del_negocio", args);
    assert.equal(out.response.ya_estaba, true);
    assert.equal(out.action, undefined);
  });

  /**
   * LLENO NO ES UN ERROR TÉCNICO. El modelo tiene que dejar de insistir Y
   * decírselo al dueño — si sólo reintenta, el dueño ve un turno que no hizo
   * nada y no sabe por qué.
   */
  it("lleno le ordena avisar al dueño, no reintentar", async () => {
    const { deps } = makeDeps();
    const s = makeSession();
    let ultima;
    for (let i = 0; i < 40; i++) {
      ultima = await runAgentTool(s, deps, "recordar_del_negocio", {
        nota: `Nota numero ${i} sobre el negocio, sus servicios y su forma de trabajar`,
      });
      if (ultima.response.ok === false) break;
    }
    assert.equal(ultima?.response.ok, false, "nunca llegó a llenarse");
    assert.match(String(ultima?.response.error), /NO insistas/);
    assert.match(String(ultima?.response.error), /Mi negocio/);
  });

  it("y una parrafada se rechaza pidiendo un resumen", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "recordar_del_negocio", {
      nota: "x".repeat(241),
    });
    assert.equal(out.response.ok, false);
    assert.match(String(out.response.error), /res[úu]mela/i);
    assert.equal(store.perfilNegocio.memoria, undefined);
  });
});
