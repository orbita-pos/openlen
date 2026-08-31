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
    syncCollectionCalls: [] as {
      projectId: string;
      collectionId: string;
      rows: Record<string, string>[];
    }[],
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
    ownerEmail: "owner@example.com",
    imageEditsThisTurn: 0,
    photoSearchesThisTurn: 0,
    busquedasVaciasSeguidas: 0,
  };
}

describe("conectar_datos_vivos", () => {

  // ⚰️ Aquí había seis pruebas de `intent="lista"`: resolvía el CSV, encendía el
  // módulo Colecciones como parte de la conexión (cero fricción), no lo
  // re-encendía si ya estaba, y al fallar el sync devolvía la fuente atrás,
  // apagaba lo que había encendido y NO afirmaba que la lista quedara intacta.
  //
  // Todo eso se va el 2026-08-29 con las colecciones. Lo que queda —`valores`—
  // hidrata los data-ol-live de la página y nunca dependió de ellas.
  it("a HOSTILE url is rejected by resolveSheetCsvUrl BEFORE any fetch or mutation", async () => {
    for (const bad of HOSTILE_URLS) {
      const { deps, store } = makeDeps();
      const out = await runAgentTool(makeSession(), deps, "conectar_datos_vivos", {
        sheet_url: bad,
        intent: "lista",
      });
      assert.equal(out.response.ok, false, `expected rejection for ${bad}`);
      assert.equal(store.fetchSheetRowsCalls.length, 0, `fetch happened for ${bad}`);
      // store.saved es el ÚNICO sitio donde podría aterrizar una escritura de
      // ajustes: cero aquí significa que la URL hostil no provocó NINGUNA
      // mutación, no sólo que no sincronizó. (Antes esto vigilaba en concreto
      // el encendido del módulo Colecciones, retirado el 2026-08-29; la
      // aserción vale igual y por una razón más general.)
      assert.equal(store.saved.length, 0, `project saved for ${bad}`);
    }
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

  // 🔴 «TU LISTA QUEDÓ COMO ESTABA» ERA MENTIRA POR TRES SITIOS.
  //
  // Esta prueba exigía ese texto. Pero al llegar aquí el módulo Colecciones ya
  // se había ENCENDIDO y persistido, `syncCollectionFromSheet` escribe fila a
  // fila sin transacción (Neon HTTP no las tiene), y el `.catch(() => {})` del
  // clear se tragaba su propio fallo. El dueño leía que no había pasado nada
  // sobre un proyecto con el módulo encendido y filas ya cambiadas.


  // ⚰️ Aquí había una prueba de que un fallo de sincronización no apagaba el
  // módulo Colecciones si ya venía encendido. Se va con el módulo el
  // 2026-08-29: `settings.collections` ya no existe en el tipo, así que la
  // prueba no podría ni construir su fixture.

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

// LAPIDA del 2026-08-29. Aqui se probaba que `leer_estado` reportara la hoja
// de la COLECCION (`settings.collections.source.sheet`), la que dejaba el
// catalogo de SOLO LECTURA. Se va con el modulo: no queda store que devuelva
// aquel 409, ni sync que escriba los items, ni ruta para desconectarla.
//
// La prueba se INVIERTE, no se borra: la que queda exige que el estado ya NO
// mencione esa hoja, y la de al lado vigila que DATOS VIVOS —que es otra hoja,
// en otro sitio de `settings`, y sigue viva— se siga reportando. Se llamaban
// parecido; por eso las dos van juntas.
describe("leer_estado ya no habla de la hoja de la coleccion", () => {
  it("aunque el proyecto la traiga heredada en sus ajustes", async () => {
    const { deps } = makeDeps({
      data: {
        html: HTML,
        // Un proyecto de antes del barrido puede tener esto guardado en la
        // base: el tipo ya no lo declara, pero la fila no se toco.
        settings: { collections: { enabled: true, source: { sheet: GOOD_SHEET_URL } } },
      } as unknown as ProjectData,
    });
    const out = await runAgentTool(makeSession(), deps, "leer_estado", {});
    assert.equal("coleccion_desde_hoja" in out.response, false);
  });

  // BRAZO DE CONTROL: si el barrido se hubiera llevado la hoja equivocada,
  // esto lo cazaria.
  it("pero SI sigue diciendo la de Datos vivos", async () => {
    const { deps } = makeDeps({
      data: {
        html: HTML,
        settings: { liveData: { sheetUrl: GOOD_SHEET_URL } },
      } as ProjectData,
    });
    const out = await runAgentTool(makeSession(), deps, "leer_estado", {});
    const estado = out.response as Record<string, { hoja?: string }>;
    assert.equal(estado.datos_vivos?.hoja, GOOD_SHEET_URL);
  });
});
