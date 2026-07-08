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
import { runAgentTool, summarizeProjectState, type AgentDeps, type AgentSession } from "./tools";
import type { ProjectData } from "@/lib/projects/types";

const HTML = `<!doctype html><html><head><title>Tacos El Güero</title><meta name="description" content="Tacos"></head><body><h1 data-x="k">Tacos El Güero</h1><p>Los mejores del barrio.</p></body></html>`;

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

function makeDeps(
  overrides?: Partial<{
    data: ProjectData;
    audioAssets: { url: string; name: string }[];
    imageManifest: unknown;
  }>,
) {
  const store = {
    data: (overrides?.data ?? { html: HTML }) as ProjectData,
    saved: [] as ProjectData[],
    versions: [] as string[],
    provisioned: 0,
    provisionedOpts: null as { email: string | null; displayName: string } | null,
    audioAssets: overrides?.audioAssets ?? [],
    imageManifest: overrides?.imageManifest ?? DEFAULT_IMAGE_MANIFEST,
    manifestFetches: 0,
  };
  const deps: AgentDeps = {
    async loadProject() {
      return { data: store.data, title: "Tacos", subdomain: null, publishedAt: null, userBrief: null };
    },
    async saveProjectData(_p, _u, data) { store.data = data; store.saved.push(data); },
    async snapshotVersion(a) { store.versions.push(a.label); },
    async provisionOwnerChat(_p, _u, opts) { store.provisioned += 1; store.provisionedOpts = opts; },
    async listAudioAssets() { return store.audioAssets; },
    async fetchImageManifest() { store.manifestFetches += 1; return store.imageManifest; },
  };
  return { deps, store };
}

function makeSession(): AgentSession {
  return {
    projectId: "p1",
    userId: "u1",
    taggedHtml: tagWithOpIds(HTML).taggedHtml,
    ownerEmail: "owner@example.com",
  };
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
  });
  it("refuses external URLs and lists available assets", async () => {
    const { deps, store } = makeDeps({ audioAssets: [{ url: "/api/projects/p1/assets/track1.mp3", name: "track1.mp3" }] });
    const out = await runAgentTool(makeSession(), deps, "poner_musica", {
      accion: "poner", asset_url: "https://evil.com/x.mp3",
    });
    assert.equal(out.response.ok, false);
    assert.ok(String(out.response.error).includes("track1.mp3"));
    assert.equal(store.saved.length, 0);
  });
  it("quitar clears music", async () => {
    const { deps, store } = makeDeps({ data: { html: HTML, settings: { music: { src: "/api/projects/p1/assets/a.mp3" } } } });
    const out = await runAgentTool(makeSession(), deps, "poner_musica", { accion: "quitar" });
    assert.equal(out.response.ok, true);
    assert.equal(store.data.settings?.music, undefined);
  });
});

describe("activar_3d", () => {
  it("enables and disables scene3d", async () => {
    const { deps, store } = makeDeps();
    await runAgentTool(makeSession(), deps, "activar_3d", { encender: true });
    assert.equal(store.data.settings?.scene3d?.enabled, true);
    await runAgentTool(makeSession(), deps, "activar_3d", { encender: false });
    assert.equal(store.data.settings?.scene3d, undefined);
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

  it("a malformed manifest comes back as an empty list, not a throw", async () => {
    const { deps } = makeDeps({ imageManifest: { images: "not-an-array" } });
    const out = await runAgentTool(makeSession(), deps, "elegir_foto", {});
    assert.equal(out.response.ok, true);
    assert.deepEqual(out.response.fotos, []);
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
