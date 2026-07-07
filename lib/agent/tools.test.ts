// Run: npx tsx --test lib/agent/tools.test.ts
//
// node:test, not vitest — this exercises the native @/lib/html-engine (Rust)
// binding via tagWithOpIds/applyOps, which vite's jsdom environment can't
// load. See vitest.config.ts's NB comment on lib/agent for the split.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tagWithOpIds } from "@/lib/html-ops";
import { lookFromAccent } from "@/lib/palette-gen";
import { runAgentTool, summarizeProjectState, type AgentDeps, type AgentSession } from "./tools";
import type { ProjectData } from "@/lib/projects/types";

const HTML = `<!doctype html><html><head><title>Tacos El Güero</title><meta name="description" content="Tacos"></head><body><h1 data-x="k">Tacos El Güero</h1><p>Los mejores del barrio.</p></body></html>`;

function makeDeps(
  overrides?: Partial<{ data: ProjectData; audioAssets: { url: string; name: string }[] }>,
) {
  const store = {
    data: (overrides?.data ?? { html: HTML }) as ProjectData,
    saved: [] as ProjectData[],
    versions: [] as string[],
    provisioned: 0,
    provisionedOpts: null as { email: string | null; displayName: string } | null,
    audioAssets: overrides?.audioAssets ?? [],
  };
  const deps: AgentDeps = {
    async loadProject() {
      return { data: store.data, title: "Tacos", subdomain: null, publishedAt: null, userBrief: null };
    },
    async saveProjectData(_p, _u, data) { store.data = data; store.saved.push(data); },
    async snapshotVersion(a) { store.versions.push(a.label); },
    async provisionOwnerChat(_p, _u, opts) { store.provisioned += 1; store.provisionedOpts = opts; },
    async listAudioAssets() { return store.audioAssets; },
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

describe("runAgentTool", () => {
  it("returns ok:false for an unknown tool name instead of throwing", async () => {
    const { deps } = makeDeps();
    const out = await runAgentTool(makeSession(), deps, "no_existe", {});
    assert.equal(out.response.ok, false);
    assert.equal(out.response.error, "herramienta desconocida");
  });
});
