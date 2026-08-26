// Run: npx tsx --test lib/agent/live-data-tool.test.ts (part of test:node)
//
// Task 17 — conectar_datos_vivos: the owner-facing tool that turns "datos
// vivos" on by chat. node:test (not vitest) because it imports ./tools,
// which loads the native @/lib/html-engine binding transitively at module
// scope — same reason tools.test.ts isn't a vitest file (see that file's
// header comment).
//
// The security-critical assertion lives in the "hostile URL" test: it pins
// that resolveSheetCsvUrl runs BEFORE any of fetchSheetRows /
// setCollectionSheetSource / syncCollection / saveProjectData — a bad host
// must produce ZERO fetch and ZERO mutation, not just an error response.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tagWithOpIds } from "@/lib/html-ops";
import { runAgentTool, type AgentDeps, type AgentSession } from "./tools";
import type { ProjectData } from "@/lib/projects/types";

const HTML = `<!doctype html><html><head><title>Taqueria</title><meta name="description" content="x"></head><body><h1 data-x="k">Taqueria</h1></body></html>`;

const GOOD_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit#gid=0";
const GOOD_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/export?format=csv&gid=0";

const HOSTILE_URLS = [
  "http://127.0.0.1/x",
  "http://evil.com/spreadsheets/d/ABC/export?format=csv",
  "https://docs.google.com.evil.com/spreadsheets/d/ABC/edit",
  "not a url",
];

function makeDeps(
  overrides?: Partial<{
    data: ProjectData;
    sheetRows: Record<string, string>[];
    syncResult: { upserted: number; archived: number };
    collectionId: string;
    syncThrows: Error;
    clearThrows: Error;
  }>,
) {
  const store = {
    data: (overrides?.data ?? { html: HTML }) as ProjectData,
    saved: [] as ProjectData[],
    fetchSheetRowsCalls: [] as string[],
    setCollectionSheetSourceCalls: [] as { projectId: string; sheetUrl: string }[],
    syncCollectionCalls: [] as {
      projectId: string;
      collectionId: string;
      rows: Record<string, string>[];
    }[],
    clearCollectionSourceCalls: [] as string[],
  };
  const sheetRows =
    overrides?.sheetRows ??
    [
      { nombre: "Taco", precio: "25" },
      { nombre: "Torta", precio: "45" },
      { nombre: "Agua", precio: "20" },
    ];
  const syncResult = overrides?.syncResult ?? { upserted: 3, archived: 0 };
  const collectionId = overrides?.collectionId ?? "col-1";

  const deps: AgentDeps = {
    async loadProject() {
      return {
        data: store.data,
        generatedRuntime: null,
        pageRuntimes: null,
        title: "Taqueria",
        subdomain: null,
        publishedAt: null,
        userBrief: null,
      };
    },
    async saveProjectData(_p, _u, data) {
      store.data = data;
      store.saved.push(data);
    },
    async profileWhatsappNumber() { return null; },
    async loadBusinessProfile() { return null; },
    async redesignDocument() { return { ok: false, error: "no usado en estos tests" }; },
    async snapshotVersion() {},
    async provisionOwnerChat() {},
    async listAudioAssets() {
      return [];
    },
    async fetchImageManifest() {
      return { version: 1, generated: "", count: 0, images: [] };
    },
    async fetchImage() {
      return { ok: false, error: "unused" };
    },
    async uploadAsset() {
      return { url: "https://images.openlen.com/x.webp" };
    },
    async editImage() {
      return { error: "unused", status: 400, body: {} };
    },
    async setUserBrief() {
      return true;
    },
    async fetchSheetRows(csvUrl) {
      store.fetchSheetRowsCalls.push(csvUrl);
      return sheetRows;
    },
    async setCollectionSheetSource(projectId, sheetUrl) {
      store.setCollectionSheetSourceCalls.push({ projectId, sheetUrl });
      return collectionId;
    },
    async syncCollection(projectId, collectionIdArg, rows) {
      store.syncCollectionCalls.push({ projectId, collectionId: collectionIdArg, rows });
      if (overrides?.syncThrows) throw overrides.syncThrows;
      return syncResult;
    },
    async clearCollectionSource(projectId) {
      store.clearCollectionSourceCalls.push(projectId);
      if (overrides?.clearThrows) throw overrides.clearThrows;
    },
    async rememberAboutUser() {
      return { ok: true as const, yaExistia: false };
    },
  };
  return { deps, store };
}

function makeSession(html?: string): AgentSession {
  return {
    projectId: "p1",
    userId: "u1",
    taggedHtml: tagWithOpIds(html ?? HTML).taggedHtml,
    page: null,
    runtimeCapability: { allowed: true },
    ownerEmail: "owner@example.com",
    imageEditsThisTurn: 0,
    photoSearchesThisTurn: 0,
  };
}

describe("conectar_datos_vivos", () => {
  it("intent=lista: resolves the CSV export URL and syncs the default Collection", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "conectar_datos_vivos", {
      sheet_url: GOOD_SHEET_URL,
      intent: "lista",
    });
    assert.equal(out.response.ok, true);
    assert.equal(store.fetchSheetRowsCalls.length, 1);
    assert.equal(store.fetchSheetRowsCalls[0], GOOD_CSV_URL);
    assert.deepEqual(store.setCollectionSheetSourceCalls, [
      { projectId: "p1", sheetUrl: GOOD_SHEET_URL },
    ]);
    assert.equal(store.syncCollectionCalls.length, 1);
    assert.equal(store.syncCollectionCalls[0].projectId, "p1");
    assert.equal(store.syncCollectionCalls[0].collectionId, "col-1");
    assert.equal(store.syncCollectionCalls[0].rows.length, 3);
    assert.equal(out.response.elementos_sincronizados, 3);
    assert.match(String(out.response.nota), /3/);
    assert.equal(out.action?.tool, "conectar_datos_vivos");
  });

  it("a HOSTILE url is rejected by resolveSheetCsvUrl BEFORE any fetch or mutation", async () => {
    for (const bad of HOSTILE_URLS) {
      const { deps, store } = makeDeps();
      const out = await runAgentTool(makeSession(), deps, "conectar_datos_vivos", {
        sheet_url: bad,
        intent: "lista",
      });
      assert.equal(out.response.ok, false, `expected rejection for ${bad}`);
      assert.equal(store.fetchSheetRowsCalls.length, 0, `fetch happened for ${bad}`);
      assert.equal(store.setCollectionSheetSourceCalls.length, 0, `collection source set for ${bad}`);
      assert.equal(store.syncCollectionCalls.length, 0, `sync happened for ${bad}`);
      // store.saved is the ONLY place a Collections-module activation write
      // (settings.collections.enabled) could land — zero here means the
      // hostile URL triggered zero activation too, not just zero sync.
      assert.equal(store.saved.length, 0, `project saved for ${bad}`);
    }
  });

  it("intent=lista from collections-NOT-enabled activates the Collections module as part of the connect (enable + source + sync, one call)", async () => {
    const { deps, store } = makeDeps(); // default data = {html: HTML}, no settings at all
    assert.equal(store.data.settings?.collections?.enabled, undefined);
    const out = await runAgentTool(makeSession(), deps, "conectar_datos_vivos", {
      sheet_url: GOOD_SHEET_URL,
      intent: "lista",
    });
    assert.equal(out.response.ok, true);
    // The activation write: settings.collections.enabled must be TRUE in what
    // was saved — otherwise the published grid stays gated shut
    // (lib/publish/filesystem.ts:586-588) even though the chat says success.
    assert.equal(store.saved.length, 1);
    assert.equal(store.saved[0].settings?.collections?.enabled, true);
    assert.equal(store.data.settings?.collections?.enabled, true);
    // ...AND the source got set AND the sync ran, same call.
    assert.deepEqual(store.setCollectionSheetSourceCalls, [
      { projectId: "p1", sheetUrl: GOOD_SHEET_URL },
    ]);
    assert.equal(store.syncCollectionCalls.length, 1);
    assert.match(String(out.response.nota), /sincroniz/);
  });

  it("intent=lista when Collections is ALREADY enabled does NOT double-activate", async () => {
    const { deps, store } = makeDeps({
      data: { html: HTML, settings: { collections: { enabled: true } } },
    });
    const out = await runAgentTool(makeSession(), deps, "conectar_datos_vivos", {
      sheet_url: GOOD_SHEET_URL,
      intent: "lista",
    });
    assert.equal(out.response.ok, true);
    // No activation write at all — the module was already on, so no
    // saveProjectData call (and no re-fired chat-provisioning side effect).
    assert.equal(store.saved.length, 0);
    assert.equal(store.setCollectionSheetSourceCalls.length, 1);
    assert.equal(store.syncCollectionCalls.length, 1);
  });

  it("a HOSTILE url with intent=valores is also rejected with zero fetch/mutation", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "conectar_datos_vivos", {
      sheet_url: "http://169.254.169.254/latest/meta-data/",
      intent: "valores",
    });
    assert.equal(out.response.ok, false);
    assert.equal(store.fetchSheetRowsCalls.length, 0);
    assert.equal(store.saved.length, 0);
  });

  it("intent=valores: persists settings.liveData.sheetUrl and reports detected keys, never touching Collections", async () => {
    const { deps, store } = makeDeps({
      sheetRows: [
        { clave: "precio_taco", valor: "25" },
        { clave: "cupos", valor: "12" },
      ],
    });
    const out = await runAgentTool(makeSession(), deps, "conectar_datos_vivos", {
      sheet_url: GOOD_SHEET_URL,
      intent: "valores",
    });
    assert.equal(out.response.ok, true);
    assert.equal(store.saved.length, 1);
    assert.equal(store.saved[0].settings?.liveData?.sheetUrl, GOOD_SHEET_URL);
    assert.deepEqual(out.response.claves_detectadas, ["precio_taco", "cupos"]);
    assert.equal(store.setCollectionSheetSourceCalls.length, 0);
    assert.equal(store.syncCollectionCalls.length, 0);
  });

  it("respects liveDataEnabled() — OFF wires nothing", async () => {
    const prev = process.env.OPENLEN_LIVE_DATA;
    process.env.OPENLEN_LIVE_DATA = "0";
    try {
      const { deps, store } = makeDeps();
      const out = await runAgentTool(makeSession(), deps, "conectar_datos_vivos", {
        sheet_url: GOOD_SHEET_URL,
        intent: "lista",
      });
      assert.equal(out.response.ok, false);
      assert.equal(store.fetchSheetRowsCalls.length, 0);
      assert.equal(store.setCollectionSheetSourceCalls.length, 0);
      assert.equal(store.saved.length, 0);
    } finally {
      if (prev === undefined) delete process.env.OPENLEN_LIVE_DATA;
      else process.env.OPENLEN_LIVE_DATA = prev;
    }
  });

  // Minor de la revisión Task 17 (cerrado 2026-07-15): el gate comparte código
  // entre intents, pero este test lo PINA para "valores" — una regresión que
  // moviera el chequeo adentro de la rama "lista" pasaría el test de arriba.
  it("kill-switch OFF also blocks intent=valores (no settings write)", async () => {
    const prev = process.env.OPENLEN_LIVE_DATA;
    process.env.OPENLEN_LIVE_DATA = "0";
    try {
      const { deps, store } = makeDeps();
      const out = await runAgentTool(makeSession(), deps, "conectar_datos_vivos", {
        sheet_url: GOOD_SHEET_URL,
        intent: "valores",
      });
      assert.equal(out.response.ok, false);
      assert.equal(store.fetchSheetRowsCalls.length, 0);
      assert.equal(store.saved.length, 0);
    } finally {
      if (prev === undefined) delete process.env.OPENLEN_LIVE_DATA;
      else process.env.OPENLEN_LIVE_DATA = prev;
    }
  });

  // Minor de la revisión Task 17 (cerrado 2026-07-15): sync que truena tras
  // fijar la fuente NO deja la colección bloqueada+vacía — el candado se
  // revierte y el dueño puede reintentar.
  it("sync failure after locking rolls the source back (no read-only+empty trap)", async () => {
    const { deps, store } = makeDeps({ syncThrows: new Error("neon hiccup") });
    const out = await runAgentTool(makeSession(), deps, "conectar_datos_vivos", {
      sheet_url: GOOD_SHEET_URL,
      intent: "lista",
    });
    assert.equal(out.response.ok, false);
    assert.equal(store.setCollectionSheetSourceCalls.length, 1);
    assert.deepEqual(store.clearCollectionSourceCalls, ["p1"]);
  });

  // 🔴 «TU LISTA QUEDÓ COMO ESTABA» ERA MENTIRA POR TRES SITIOS.
  //
  // Esta prueba exigía ese texto. Pero al llegar aquí el módulo Colecciones ya
  // se había ENCENDIDO y persistido, `syncCollectionFromSheet` escribe fila a
  // fila sin transacción (Neon HTTP no las tiene), y el `.catch(() => {})` del
  // clear se tragaba su propio fallo. El dueño leía que no había pasado nada
  // sobre un proyecto con el módulo encendido y filas ya cambiadas.
  it("el módulo que encendimos AQUÍ se apaga al fallar el sync", async () => {
    const { deps, store } = makeDeps({ syncThrows: new Error("neon hiccup") });

    const out = await runAgentTool(makeSession(), deps, "conectar_datos_vivos", {
      sheet_url: GOOD_SHEET_URL,
      intent: "lista",
    });

    assert.equal(out.response.ok, false);
    // Encendido y vuelto a apagar: el estado final es el de antes del turno.
    assert.equal(store.data.settings?.collections?.enabled, false);
    assert.equal(store.saved.length, 2);
  });

  it("y NO afirma que la lista quedó intacta — dice que puede estar a medias", async () => {
    const { deps } = makeDeps({ syncThrows: new Error("neon hiccup") });

    const out = await runAgentTool(makeSession(), deps, "conectar_datos_vivos", {
      sheet_url: GOOD_SHEET_URL,
      intent: "lista",
    });

    const error = String(out.response.error);
    assert.doesNotMatch(error, /quedó como estaba|quedó intacta/);
    assert.match(error, /a medias/);
    // El sync es una reconciliación completa, no un delta: reconectar el mismo
    // Sheet converge. Por eso el consejo es verdadero y no un parche.
    assert.match(error, /MISMO Sheet/);
  });

  it("si el módulo ya venía encendido, NO se apaga — ese cambio no es nuestro", async () => {
    const { deps, store } = makeDeps({
      data: { html: HTML, settings: { collections: { enabled: true } } } as ProjectData,
      syncThrows: new Error("neon hiccup"),
    });

    const out = await runAgentTool(makeSession(), deps, "conectar_datos_vivos", {
      sheet_url: GOOD_SHEET_URL,
      intent: "lista",
    });

    assert.equal(out.response.ok, false);
    assert.equal(store.data.settings?.collections?.enabled, true);
    assert.equal(store.saved.length, 0);
  });

  it("si además falla soltar la fuente, se DICE — antes se lo tragaba un catch vacío", async () => {
    const { deps } = makeDeps({
      syncThrows: new Error("neon hiccup"),
      clearThrows: new Error("tampoco"),
    });

    const out = await runAgentTool(makeSession(), deps, "conectar_datos_vivos", {
      sheet_url: GOOD_SHEET_URL,
      intent: "lista",
    });

    const error = String(out.response.error);
    assert.match(error, /ligada al Sheet/);
    assert.match(error, /solo lectura/);
  });

  it("rejects an unknown intent without touching any dep", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "conectar_datos_vivos", {
      sheet_url: GOOD_SHEET_URL,
      intent: "nope",
    });
    assert.equal(out.response.ok, false);
    assert.equal(store.fetchSheetRowsCalls.length, 0);
  });

  it("rejects a missing sheet_url without touching any dep", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "conectar_datos_vivos", {
      intent: "lista",
    });
    assert.equal(out.response.ok, false);
    assert.equal(store.fetchSheetRowsCalls.length, 0);
  });
});

// El caso `lista` era INVISIBLE para el Agente: la hoja de la coleccion vive en
// settings.collections.source, no en settings.liveData, y `summarizeProjectState`
// solo miraba la segunda. Es el peor de los dos, porque es el que deja la
// coleccion de SOLO LECTURA — el Agente intentaba anadir un producto, recibia un
// 409 y no tenia forma de saber por que.
describe("leer_estado dice si el catalogo viene de una hoja", () => {
  it("lo reporta, y dice que por eso no se puede editar a mano", async () => {
    const { deps } = makeDeps({
      data: {
        html: HTML,
        settings: { collections: { enabled: true, source: { sheet: GOOD_SHEET_URL } } },
      } as ProjectData,
    });
    const out = await runAgentTool(makeSession(), deps, "leer_estado", {});
    const estado = out.response as Record<string, { hoja?: string; solo_lectura?: boolean }>;
    assert.equal(estado.coleccion_desde_hoja?.hoja, GOOD_SHEET_URL);
    assert.equal(estado.coleccion_desde_hoja?.solo_lectura, true);
  });

  it("sin hoja conectada, el estado no menciona nada", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "leer_estado", {});
    assert.equal("coleccion_desde_hoja" in out.response, false);
  });
});
