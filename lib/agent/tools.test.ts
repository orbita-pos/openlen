// Run: npx tsx --test lib/agent/tools.test.ts
//
// node:test, not vitest — this exercises the native @/lib/html-engine (Rust)
// binding via tagWithOpIds/applyOps, which vite's jsdom environment can't
// load. See vitest.config.ts's NB comment on lib/agent for the split.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tagWithOpIds } from "@/lib/html-ops";
import { lookFromAccent } from "@/lib/palette-gen";
import { applyTematicaToHtml } from "@/lib/tematicas/apply-server";
import { TEMATICA_PRESETS } from "@/lib/tematicas/presets";
import { runAgentTool, summarizeProjectState, urlIsPageImage, type AgentDeps, type AgentSession } from "./tools";
import type { ProjectData } from "@/lib/projects/types";

const HTML = `<!doctype html><html><head><title>Tacos El Güero</title><meta name="description" content="Tacos"></head><body><h1 data-x="k">Tacos El Güero</h1><p>Los mejores del barrio.</p></body></html>`;

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
  }>,
) {
  const store = {
    data: (overrides?.data ?? { html: HTML }) as ProjectData,
    saved: [] as ProjectData[],
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
    userBrief: (overrides?.userBrief ?? null) as string | null,
    briefWrites: 0,
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
        title: "Tacos",
        subdomain: overrides?.subdomain ?? null,
        publishedAt: overrides?.publishedAt ?? null,
        userBrief: store.userBrief,
      };
    },
    async saveProjectData(_p, _u, data) { store.data = data; store.saved.push(data); },
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

describe("summarizeProjectState", () => {
  it("reports modules off by default and unpublished", () => {
    const s = summarizeProjectState({ data: { html: HTML }, title: "Tacos", subdomain: null, publishedAt: null });
    assert.equal(s.publicado, false);
    assert.equal((s.modulos as Record<string, boolean>).members, false);
  });
});

describe("activar_modulo", () => {
  it("enables members with the Cuentas preset and saves", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "activar_modulo", { modulo: "members" });
    assert.equal(out.response.ok, true);
    assert.equal(store.data.settings?.members?.enabled, true);
    assert.equal(store.data.settings?.members?.accountArea, true);
    assert.equal(out.action?.tool, "activar_modulo");
    assert.equal(store.saved.length, 1);
  });
  it("provisions owner chat on chat enable, threading the session email", async () => {
    const { deps, store } = makeDeps();
    await runAgentTool(makeSession(), deps, "activar_modulo", { modulo: "chat" });
    assert.equal(store.provisioned, 1);
    // The email must reach the dep — getOrCreateOwnerChatUser short-circuits on
    // an existing row, so a dropped email would strand the owner forever.
    assert.equal(store.provisionedOpts?.email, "owner@example.com");
    assert.equal(store.provisionedOpts?.displayName, "Tacos");
  });
  it("surfaces the comments-without-members error to the model, not as a throw", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "activar_modulo", { modulo: "comments" });
    assert.equal(out.response.ok, false);
    assert.ok(String(out.response.error).includes("members"));
  });

  // Task 8 review round 2 — CI coverage for the pedidos number-resolution
  // chain (previously only exercised by the eval battery, never by a fast
  // unit test): args.numero > settings.orders.number > settings.whatsapp.number
  // fallback, the no-number-anywhere guard, and off preserving the number.
  it("pedidos ON with only whatsapp.number set falls back to it", async () => {
    const { deps, store } = makeDeps({
      data: { html: HTML, settings: { whatsapp: { enabled: true, number: "5512345678" } } },
    });
    const out = await runAgentTool(makeSession(), deps, "activar_modulo", { modulo: "pedidos" });
    assert.equal(out.response.ok, true);
    assert.deepEqual(store.data.settings?.orders, { enabled: true, number: "5512345678" });
    assert.equal(store.saved.length, 1);
  });

  it("pedidos ON with both orders.number and whatsapp.number set — orders.number wins (precedence)", async () => {
    const { deps, store } = makeDeps({
      data: {
        html: HTML,
        settings: {
          orders: { enabled: false, number: "5599999999" },
          whatsapp: { enabled: true, number: "5512345678" },
        },
      },
    });
    const out = await runAgentTool(makeSession(), deps, "activar_modulo", { modulo: "pedidos" });
    assert.equal(out.response.ok, true);
    assert.equal(store.data.settings?.orders?.number, "5599999999");
  });

  it("pedidos ON with no number anywhere — ok:false asking for the number, nothing saved", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "activar_modulo", { modulo: "pedidos" });
    assert.equal(out.response.ok, false);
    assert.ok(String(out.response.error).includes("número"));
    assert.equal(store.saved.length, 0);
  });

  it("pedidos OFF preserves the existing number (apagar no lo borra)", async () => {
    const { deps, store } = makeDeps({
      data: { html: HTML, settings: { orders: { enabled: true, number: "5512345678" } } },
    });
    const out = await runAgentTool(makeSession(), deps, "activar_modulo", {
      modulo: "pedidos",
      encender: false,
    });
    assert.equal(out.response.ok, true);
    assert.deepEqual(store.data.settings?.orders, { enabled: false, number: "5512345678" });
  });
});

describe("editar_pagina", () => {
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

  // The edit SUCCEEDS (sanitize strips silently, it never blocks) — which is
  // exactly why the model has to be told. Without the aviso the agent closes
  // the turn with "listo, ya te puse el mapa" over a document that has no
  // iframe in it: a false claim its honesty rule can't catch.
  it("surfaces an aviso when the model's html carried an iframe (map/embed)", async () => {
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
    assert.ok(!store.data.html.includes("<iframe"), "the iframe must be gone from the saved doc");
    const aviso = (out.response as { aviso?: string }).aviso ?? "";
    assert.match(aviso, /iframe/i);
    // It must also hand the model the real alternative, not just a refusal.
    assert.match(aviso, /YouTube|reproductor/i);
    assert.match(aviso, /jamás afirmes|DÍSELO/i);
  });

  it("surfaces an aviso when the model's html carried a <script> (dead control)", async () => {
    const { deps } = makeDeps();
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
    const aviso = (out.response as { aviso?: string }).aviso ?? "";
    assert.match(aviso, /JavaScript/i);
    // Both counters must be live — a snake_case key on the camelCase napi
    // surface reads undefined and the whole guard silently never fires.
    assert.match(aviso, /1 <script>/);
    assert.match(aviso, /1 atributos on\*/);
    assert.match(aviso, /CSS puro|<details>/i);
    // Task 16 — CONDUCTAS must be the FIRST option offered, not an
    // afterthought: most real dead-JS cases (a countdown, a filter, a
    // lightbox, a copy button) are solved by a recipe, not by CSS and
    // definitely not by giving up.
    assert.match(aviso, /CONDUCTA/i);
    const conductaIdx = aviso.search(/CONDUCTA/i);
    const cssIdx = aviso.search(/CSS puro/i);
    assert.ok(
      conductaIdx >= 0 && cssIdx >= 0 && conductaIdx < cssIdx,
      "CONDUCTAS debe ofrecerse antes que CSS puro (orden: conducta, css, honestidad)",
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
  it("surfaces an aviso when a data-ol-copy points at a missing id (dead at birth)", async () => {
    const { deps, store } = makeDeps();
    const session = makeSession();
    const target = /<h1[^>]*\bdata-op-id="([^"]+)"/.exec(session.taggedHtml)![1];
    const out = await runAgentTool(session, deps, "editar_pagina", {
      edits: [
        { op: "replace", target, new_html: `<h1>Menú</h1><button data-ol-copy="cupon">Copiar</button>` },
      ],
      resumen: "boton copiar",
    });
    assert.equal(out.response.ok, true);
    // The edit SUCCEEDS and saves — validateBehaviors doesn't block, it
    // warns, same contract as the sanitizer's aviso above.
    assert.ok(store.data.html.includes('data-ol-copy="cupon"'));
    const aviso = (out.response as { aviso?: string }).aviso ?? "";
    assert.match(aviso, /cupon/);
    assert.match(aviso, /nacería muerto/i);
  });

  it("surfaces an aviso when a data-ol-countdown value isn't a valid ISO date", async () => {
    const { deps } = makeDeps();
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
    assert.equal(out.response.ok, true);
    const aviso = (out.response as { aviso?: string }).aviso ?? "";
    assert.match(aviso, /fecha ISO válida/i);
  });

  it("stays quiet when a behavior is wired correctly (no crying wolf)", async () => {
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
      resumen: "cupon correcto",
    });
    assert.equal(out.response.ok, true);
    assert.equal((out.response as { aviso?: string }).aviso, undefined);
  });

  it("composes both avisos when a turn strips a <script> AND mis-wires a behavior", async () => {
    const { deps } = makeDeps();
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
    assert.equal(out.response.ok, true);
    const aviso = (out.response as { aviso?: string }).aviso ?? "";
    assert.match(aviso, /JavaScript/i);
    assert.match(aviso, /ghost/);
    assert.match(aviso, /nacería muerto/i);
  });
});

describe("cambiar_tema", () => {
  it("applies an accent bundle, persists through the sanitize pipeline, re-tags", async () => {
    const { deps, store } = makeDeps();
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
    const darkDoc = HTML.replace("<html>", `<html data-ol-mode="dark">`);
    const { deps, store } = makeDeps({ data: { html: darkDoc } });
    const out = await runAgentTool(makeSession(), deps, "cambiar_tema", { accent: "#e8743a" });
    assert.equal(out.response.ok, true);
    assert.match(store.data.html!, /<html[^>]*\sdata-ol-mode="dark"/);
    const dark = lookFromAccent("#e8743a").dark;
    assert.ok(store.data.html!.includes(`--ol-accent: ${dark["--ol-accent"]}`));
    assert.ok(store.data.html!.includes(`--ol-bg: ${dark["--ol-bg"]}`));
  });
  it("standalone modo:dark re-derives the bundle from the page's current accent + stamps the attr", async () => {
    const withAccent = HTML.replace("<html>", `<html style="--ol-accent: #e8743a">`);
    const { deps, store } = makeDeps({ data: { html: withAccent } });
    const out = await runAgentTool(makeSession(), deps, "cambiar_tema", { modo: "dark" });
    assert.equal(out.response.ok, true);
    assert.match(store.data.html!, /<html[^>]*\sdata-ol-mode="dark"/);
    const dark = lookFromAccent("#e8743a").dark;
    assert.ok(store.data.html!.includes(`--ol-bg: ${dark["--ol-bg"]}`));
    assert.ok(store.data.html!.includes(`--ol-accent: ${dark["--ol-accent"]}`));
  });
});

describe("aplicar_tematica", () => {
  it("stamps a kit, persists through sanitize, keeps settings intact, re-tags", async () => {
    const kit = TEMATICA_PRESETS[0];
    const { deps, store } = makeDeps({ data: { html: HTML, settings: { motion: "calm" } } });
    const session = makeSession();
    const out = await runAgentTool(session, deps, "aplicar_tematica", { tematica: kit.id });
    assert.equal(out.response.ok, true);
    assert.ok(store.data.html!.includes(`data-ol-tematica="${kit.id}"`));
    assert.ok(store.data.html!.includes("<style data-ol-tematica"));
    assert.ok(!store.data.html!.includes("data-op-id"));
    assert.equal(store.data.settings?.motion, "calm");
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
    await runAgentTool(session, deps, "activar_modulo", { modulo: "bookings" });
    const out = await runAgentTool(session, deps, "leer_estado", {});
    assert.equal((out.response.modulos as Record<string, boolean>).bookings, true);
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

describe("cambiar_motion", () => {
  it("sets and clears settings.motion", async () => {
    const { deps, store } = makeDeps();
    const on = await runAgentTool(makeSession(), deps, "cambiar_motion", { look: "dramatic" });
    assert.equal(on.response.ok, true);
    assert.equal(store.data.settings?.motion, "dramatic");
    const off = await runAgentTool(makeSession(), deps, "cambiar_motion", { look: "off" });
    assert.equal(off.response.ok, true);
    assert.equal(store.data.settings?.motion, undefined);
  });
  it("rejects unknown look as data", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "cambiar_motion", { look: "frenetic" });
    assert.equal(out.response.ok, false);
  });
});

describe("poner_musica", () => {
  it("sets music only from the project's own audio assets", async () => {
    const { deps, store } = makeDeps({
      audioAssets: [{ url: "/api/projects/p1/assets/track1.mp3", name: "track1.mp3" }],
    });
    const out = await runAgentTool(makeSession(), deps, "poner_musica", {
      accion: "poner", asset_url: "/api/projects/p1/assets/track1.mp3",
    });
    assert.equal(out.response.ok, true);
    assert.equal(store.data.settings?.music?.src, "/api/projects/p1/assets/track1.mp3");
    // F4-T8: action.summary is the stable "on"/"off" code, not the raw
    // Spanish "poner" enum value — agent-action-card.tsx localizes it.
    assert.equal(out.action?.summary, "on");
  });
  it("refuses external URLs and returns the available tracks as {nombre,url} pistas", async () => {
    const { deps, store } = makeDeps({ audioAssets: [{ url: "/api/projects/p1/assets/track1.mp3", name: "track1.mp3" }] });
    const out = await runAgentTool(makeSession(), deps, "poner_musica", {
      accion: "poner", asset_url: "https://evil.com/x.mp3",
    });
    assert.equal(out.response.ok, false);
    assert.ok(String(out.response.error).includes("track1.mp3"));
    // The URLs are content-hash-named — the model can only retry if it gets the
    // actual url back (the discovery dead-end fix).
    const pistas = out.response.pistas as { nombre: string; url: string }[];
    assert.equal(pistas.length, 1);
    assert.equal(pistas[0].url, "/api/projects/p1/assets/track1.mp3");
    assert.equal(pistas[0].nombre, "track1.mp3");
    assert.equal(store.saved.length, 0);
  });
  it("a bare accion=poner (no asset_url) returns the pistas to pick from", async () => {
    const { deps } = makeDeps({ audioAssets: [{ url: "/api/projects/p1/assets/song.mp3", name: "song.mp3" }] });
    const out = await runAgentTool(makeSession(), deps, "poner_musica", { accion: "poner" });
    assert.equal(out.response.ok, false);
    const pistas = out.response.pistas as { nombre: string; url: string }[];
    assert.equal(pistas[0].url, "/api/projects/p1/assets/song.mp3");
  });
  it("quitar clears music", async () => {
    const { deps, store } = makeDeps({ data: { html: HTML, settings: { music: { src: "/api/projects/p1/assets/a.mp3" } } } });
    const out = await runAgentTool(makeSession(), deps, "poner_musica", { accion: "quitar" });
    assert.equal(out.response.ok, true);
    assert.equal(store.data.settings?.music, undefined);
    assert.equal(out.action?.summary, "off");
  });
});

describe("activar_3d", () => {
  it("enables and disables scene3d", async () => {
    const { deps, store } = makeDeps();
    const onOut = await runAgentTool(makeSession(), deps, "activar_3d", { encender: true });
    assert.equal(store.data.settings?.scene3d?.enabled, true);
    // F4-T8: action.summary is the stable "on"/"off" code — the old
    // "encendida"/"apagada" literals reached the panel with no i18n path.
    assert.equal(onOut.action?.summary, "on");
    const offOut = await runAgentTool(makeSession(), deps, "activar_3d", { encender: false });
    assert.equal(store.data.settings?.scene3d, undefined);
    assert.equal(offOut.action?.summary, "off");
  });
});

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
  it("creates a page from the home shell and saves, deriving the slug from titulo when absent", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "crear_pagina", { titulo: "Sobre Nosotros" });
    assert.equal(out.response.ok, true);
    assert.equal(out.response.slug, "sobre-nosotros");
    assert.equal(out.action?.tool, "crear_pagina");
    assert.ok(store.data.pages?.["sobre-nosotros"]);
    assert.equal(store.saved.length, 1);
  });

  it("modulo=bookings injects the module section and does not touch settings.bookings", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "crear_pagina", { modulo: "bookings" });
    assert.equal(out.response.ok, true);
    // The fixture HTML carries no lang="es" attribute, so the module's
    // language resolution (isSpanish test in create-page.ts) falls to English.
    assert.equal(out.response.slug, "booking");
    assert.ok(store.data.pages?.["booking"]?.html.includes("data-ol-bookings-section"));
    assert.equal(store.data.settings?.bookings?.enabled, undefined);
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

describe("recordar_preferencia", () => {
  it("appends under the agent marker and reports the card", async () => {
    const { deps, store } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "recordar_preferencia", {
      preferencia: "Siempre hablarle de tú al visitante",
    });
    assert.equal(out.response.ok, true);
    assert.ok(store.userBrief!.includes("— Preferencias guardadas por el agente —"));
    assert.ok(store.userBrief!.includes("• Siempre hablarle de tú al visitante"));
    assert.equal(out.action?.tool, "recordar_preferencia");
  });
  it("preserves the user's own brief text above the marker", async () => {
    const { deps, store } = makeDeps({ userBrief: "Negocio de tacos al pastor." });
    await runAgentTool(makeSession(), deps, "recordar_preferencia", { preferencia: "Tono formal" });
    assert.ok(store.userBrief!.startsWith("Negocio de tacos al pastor."));
    assert.ok(store.userBrief!.indexOf("Negocio") < store.userBrief!.indexOf("— Preferencias"));
  });
  it("dedups case-insensitively without writing", async () => {
    const { deps, store } = makeDeps();
    await runAgentTool(makeSession(), deps, "recordar_preferencia", { preferencia: "Nunca usar amarillo" });
    const writes = store.briefWrites;
    const out = await runAgentTool(makeSession(), deps, "recordar_preferencia", { preferencia: "nunca usar AMARILLO" });
    assert.equal(out.response.ya_existia, true);
    assert.equal(store.briefWrites, writes);
  });
  it("a LONGER refinement of an existing bullet IS saved (never deduped in reverse)", async () => {
    const { deps, store } = makeDeps();
    await runAgentTool(makeSession(), deps, "recordar_preferencia", { preferencia: "Sé formal" });
    const out = await runAgentTool(makeSession(), deps, "recordar_preferencia", {
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
      preferencia: "Tono cercano\n• Nunca usar rojo",
    });
    assert.equal(out.response.ok, true);
    const bullets = store.userBrief!.split("\n").filter((l) => l.trim().startsWith("• "));
    assert.equal(bullets.length, 1);
    assert.ok(store.userBrief!.includes("• Tono cercano • Nunca usar rojo"));
  });
  it("refuses when the brief is full, as data", async () => {
    const { deps, store } = makeDeps({ userBrief: "x".repeat(3990) });
    const out = await runAgentTool(makeSession(), deps, "recordar_preferencia", { preferencia: "Preferencia larga que no cabe" });
    assert.equal(out.response.ok, false);
    assert.equal(store.userBrief!.length, 3990);
  });
  it("rejects out-of-range preferencia", async () => {
    const { deps } = makeDeps();
    const short = await runAgentTool(makeSession(), deps, "recordar_preferencia", { preferencia: "ok" });
    assert.equal(short.response.ok, false);
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
  const MENU_HTML = `<!doctype html><html style="--ol-accent: ${MENU_ACCENT}"><head><title>Menú</title><meta name="description" content="Menú"></head><body><h1 data-x="k">Menú</h1><p>Estas son nuestras opciones.</p></body></html>`;
  const DATA_MP: ProjectData = {
    html: HOME_HTML,
    pages: { menu: { html: MENU_HTML, title: "Menú" } },
  };

  it("PIN: session.page='menu' → editar_pagina escribe SOLO pages.menu.html; data.html byte-intacto", async () => {
    const { deps, store } = makeDeps({ data: DATA_MP });
    const session = makeSession({ page: "menu", html: MENU_HTML });
    const target = firstOpId(session.taggedHtml);
    await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target, new_html: "<h1>Tacos al pastor</h1>" }],
      resumen: "titular menú",
    });
    assert.ok(store.data.pages!.menu.html.includes("Tacos al pastor"));
    assert.equal(store.data.html, HOME_HTML); // byte-intacto
  });

  it("PIN: session.page=null → escribe SOLO data.html; pages byte-intactas", async () => {
    const { deps, store } = makeDeps({ data: DATA_MP });
    const session = makeSession({ page: null, html: HOME_HTML });
    const target = firstOpId(session.taggedHtml);
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
    const target = firstOpId(session.taggedHtml);
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
    const target = firstOpId(session.taggedHtml);
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
    const target = firstOpId(session.taggedHtml);
    const edited = await runAgentTool(session, deps, "editar_pagina", {
      edits: [{ op: "replace", target, new_html: "<h1>Tacos al pastor</h1>" }],
      resumen: "titular menú",
    });
    assert.equal(edited.response.ok, true);
    assert.ok(store.data.pages!.menu.html.includes("Tacos al pastor"));
    assert.equal(store.data.html, HOME_HTML); // byte-intacto — the switch, not editar_pagina, moved the slot
  });
});
