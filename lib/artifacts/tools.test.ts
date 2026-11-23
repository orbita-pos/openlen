// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { artifactFixture } from "./testing/fixture";
import { createArtifactJobs } from "./jobs";
import { createArtifactData } from "./data";
import { createArtifactAgent, artifactToolDeclarations } from "./tools";
import {createArtifactContextCapture,createArtifactSourceFreeze} from "./context";
import { buildFunctionDeclarations } from "../agent/catalog";
import { buildManualDeLaPlataforma, documentosDeLaPlataforma } from "../agent/manual-de-la-plataforma";
import { isConcurrencySafe } from "../agent/tool-concurrency";

let f: Awaited<ReturnType<typeof artifactFixture>>;
beforeAll(async () => { f = await artifactFixture(); }, 30_000);
beforeEach(async () => { await f.pg.exec(`truncate "artifactRequests" cascade`); });
afterAll(async () => { await f.pg.close(); });
function agent(messageId = "human-message") {
  return createArtifactAgent({ database: f.database, store: f.store, jobs: createArtifactJobs(f.database, f.store), data: createArtifactData(f.database, f.store, async () => null), captureContext: async () => ({ files: {}, settingsHash: "a".repeat(64), capturedAt: new Date().toISOString(), resourceRefs: [] }) }, f.owner, () => messageId, ["slides", "image"]);
}
const piece = (item_key: string) => ({ kind: "image", title: "Imagen promocional", brief: "Mi app", item_key });

it("keeps two images distinct and makes a repeated create of one item idempotent", async () => {
  const a = agent();
  const first = await a.execute("create_deliverable", { ...piece("image-1"), ownerId: "stranger", projectId: "other" });
  const second = await a.execute("create_deliverable", piece("image-2"));
  const repeated = await a.execute("create_deliverable", piece("image-1"));
  expect(first.response.artifactId).toBe(repeated.response.artifactId);
  expect(first.response.artifactId).not.toBe(second.response.artifactId);
  expect(first.mutoDurable).toBe(true);
  const index = await agent("another-message").contextIndex();
  expect(index).toContain(String(second.response.artifactId));
  expect(index).toContain("image-2");
  expect(index).toContain("draft");
  expect(index).not.toContain("completed");
  const [count] = await f.database.query(`select count(*)::int n from "artifacts" where "projectId"='other'`);
  expect(count!.n).toBe(0);
});

it("keeps the code of an artifact error raised by another bundle's copy of the class", async () => {
  // In Next dev every route has its own copy of ./types, and the runtime is shared through globalThis:
  // the services may throw an ArtifactError that is not `instanceof` this file's class.
  class ArtifactError extends Error { constructor(readonly code: string) { super(code); this.name = "ArtifactError"; } }
  const data = { ...createArtifactData(f.database, f.store, async () => null), queryArtifactData: async () => { throw new ArtifactError("invalid_dataset"); } };
  const a = createArtifactAgent({ database: f.database, store: f.store, jobs: createArtifactJobs(f.database, f.store), data, captureContext: async () => ({ files: {}, settingsHash: "a".repeat(64), capturedAt: new Date().toISOString(), resourceRefs: [] }) }, f.owner, () => "human-message", ["dashboard"]);
  const created = await a.execute("create_deliverable", { kind: "dashboard", item_key: "board", title: "Escenario", brief: "Mi app" });
  const saved = await a.execute("query_deliverable_data", { deliverable_id: created.response.artifactId, source: "scenario", columns: ["mes"], rows_json: "[[\"Mes 1\"]]" });
  expect(saved.response).toEqual({ ok: false, error: "invalid_dataset" });
});

it("tells Len what was wrong, not only the code", async () => {
  const a = createArtifactAgent({ database: f.database, store: f.store, jobs: createArtifactJobs(f.database, f.store), data: createArtifactData(f.database, f.store, async () => null), captureContext: async () => ({ files: {}, settingsHash: "a".repeat(64), capturedAt: new Date().toISOString(), resourceRefs: [] }) }, f.owner, () => "human-message", ["dashboard"]);
  const created = await a.execute("create_deliverable", { kind: "dashboard", item_key: "board", title: "Escenario", brief: "Mi app" });
  const saved = await a.execute("query_deliverable_data", { deliverable_id: created.response.artifactId, source: "scenario", columns: ["mes"], rows_json: JSON.stringify([{ mes: "Mes 1", clientes: 40 }]) });
  expect(saved.response).toEqual({ ok: false, error: "invalid_dataset", message: expect.stringContaining("clientes") });
  expect(artifactToolDeclarations(["dashboard"]).find((t) => t.name === "query_deliverable_data")).toMatchObject({ parameters: { properties: { rows_json: { description: expect.stringContaining("row objects") } } } });
});

// Trial F (21/10): Len waited for a render with `sleep 180`. Claude Code waits on the CONDITION (an until-loop that
// checks every 2 s) instead of a time; here the condition is the piece's export jobs.
async function queuedDeck(a: ReturnType<typeof agent>) {
  const created = await a.execute("create_deliverable", { kind: "slides", item_key: "deck", title: "Presentación", brief: "Mi app" });
  const id = String(created.response.artifactId);
  await a.workspace.write(`/.len/artifacts/${id}/deck.json`, JSON.stringify({ version: 3, title: "Turnia", order: ["cover"] }), null);
  await a.workspace.write(`/.len/artifacts/${id}/slides/cover.html`, '<section id="cover" style="background:#fff"><h1>Turnia</h1></section>', null);
  const rendered = await a.execute("render_deliverable", { deliverable_id: id, revision: 2, formats: ["pdf"] });
  return { id, jobId: String(rendered.response.jobId) };
}

it("inspect_deliverable with wait_ms answers as soon as the render ends, keeping the turn alive meanwhile", async () => {
  const a = agent();
  const { id, jobId } = await queuedDeck(a);
  setTimeout(() => void f.database.query(`update "artifactJobs" set "status"='completed' where "id"=$1`, [jobId]), 300);
  let alive = 0;
  const started = Date.now();
  const out = await a.execute("inspect_deliverable", { deliverable_id: id, wait_ms: 120_000 }, { alive: () => { alive++; } });
  expect(Date.now() - started).toBeLessThan(10_000);
  expect(out.response).toMatchObject({ ok: true, jobs: [expect.objectContaining({ id: jobId, status: "completed" })] });
  expect(out.response.note).toBeUndefined();
  expect(alive).toBeGreaterThan(0);
});

it("stops waiting at wait_ms and says the render is still going", async () => {
  const a = agent();
  const { id } = await queuedDeck(a);
  const started = Date.now();
  const out = await a.execute("inspect_deliverable", { deliverable_id: id, wait_ms: 300 });
  expect(Date.now() - started).toBeLessThan(3_000);
  expect(out.response).toMatchObject({ ok: true, note: expect.stringMatching(/still queued after 0\.3 s/) });
});

it("stops waiting when the turn is stopped", async () => {
  const a = agent();
  const { id } = await queuedDeck(a);
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 200);
  const started = Date.now();
  await a.execute("inspect_deliverable", { deliverable_id: id, wait_ms: 120_000 }, { signal: stop.signal });
  expect(Date.now() - started).toBeLessThan(3_000);
});

// A1 of Len 3.1 (the 23/10 video turn): the jobs came oldest first, so the failure of revision 3 was read before
// the current one, and the current one (motion_nondeterministic) came with empty diagnostics.
it("inspect_deliverable shows the newest job first and says what to do about a failure", async () => {
  const a = agent();
  const { id, jobId } = await queuedDeck(a);
  await f.database.query(`update "artifactJobs" set "createdAt"=now()-interval '1 hour' where "id"=$1`, [jobId]);
  await f.database.query(
    `insert into "artifactJobs" ("id","artifactId","revision","actorId","operation","optionsHash","options","status","errorCode","diagnostics")
     select $1,$2,"revision","actorId","operation",'h2','{}'::jsonb,'failed','motion_nondeterministic','[]'::jsonb from "artifactJobs" where "id"=$3`,
    ["00000000-0000-4000-8000-000000000002", id, jobId],
  );
  const out = await a.execute("inspect_deliverable", { deliverable_id: id });
  const jobs = out.response.jobs as { id: string; whatToDo?: string }[];
  expect(jobs[0]).toMatchObject({ id: "00000000-0000-4000-8000-000000000002", whatToDo: expect.stringMatching(/seek.*new revision/s) });
  expect(jobs[1]!.id).toBe(jobId);
  expect(jobs[1]!.whatToDo).toBeUndefined();
});

it("a wait that ends with the export still going says pending: true (polling, not a repeated call)", async () => {
  const a = agent();
  const { id } = await queuedDeck(a);
  const out = await a.execute("inspect_deliverable", { deliverable_id: id, wait_ms: 300 });
  expect(out.response).toMatchObject({ ok: true, pending: true });
});

it("declares the wait on inspect_deliverable and points render_deliverable to it", () => {
  const tools = artifactToolDeclarations(["slides"]);
  expect(tools.find((t) => t.name === "inspect_deliverable")).toMatchObject({ parameters: { properties: { wait_ms: { type: "NUMBER", description: expect.stringMatching(/600000/) } } } });
  expect(String(tools.find((t) => t.name === "render_deliverable")!.description)).toMatch(/inspect_deliverable with wait_ms/);
  expect(String(tools.find((t) => t.name === "render_deliverable")!.description)).toMatch(/asked for again on the same revision.*paid image or voice is not repeated/);
});

it("render returns queued with persisted ids and refuses an unavailable format", async () => {
  const a = agent();
  const created = await a.execute("create_deliverable", { kind: "slides", item_key: "deck", title: "Presentación", brief: "Mi app" });
  const id = String(created.response.artifactId);
  await a.workspace.write(`/.len/artifacts/${id}/deck.json`, JSON.stringify({ version: 3, title: "Turnia", order: ["cover"] }), null);
  await a.workspace.write(`/.len/artifacts/${id}/slides/cover.html`, '<section id="cover" style="background:#fff"><h1>Turnia</h1></section>', null);
  const result = await a.execute("render_deliverable", { deliverable_id: id, revision: 2, formats: ["pdf"] });
  expect(result.response).toMatchObject({ ok: true, status: "queued", artifactId: id, revision: 2 });
  expect(JSON.parse(result.action!.valores!)).toMatchObject({ artifactId: id, jobId: result.response.jobId });
  const fresh = await agent("new-chat").execute("inspect_deliverable", { deliverable_id: id });
  expect(fresh.response.status).toBe("queued");
  const invalid = await a.execute("render_deliverable", { deliverable_id: id, revision: 2, formats: ["mp4"] });
  expect(invalid.response).toMatchObject({ ok: false, error: "format_unavailable" });
  expect((await a.execute("create_deliverable", { ...piece("video"), kind: "motion" })).response).toMatchObject({ ok: false, error: "format_unavailable" });
});

// The 23/10 trial in production (project 25b92e46): every Write of a piece's file makes a revision and nothing
// said which; Len rendered revisions 1 and 0 of a piece at 6, the check ran on those, and «dashboard.json is not
// JSON» came back twice about a file only a later revision had. Sealing takes the current revision anyway.
it("refuses a revision that is not the current one before checking it, and says which one is", async () => {
  const a = agent();
  const created = await a.execute("create_deliverable", { kind: "slides", item_key: "deck", title: "Presentación", brief: "Mi app" });
  const id = String(created.response.artifactId);
  await a.workspace.write(`/.len/artifacts/${id}/slides/cover.html`, '<section id="cover" style="background:#fff"><h1>Turnia</h1></section>', null);
  await a.workspace.write(`/.len/artifacts/${id}/deck.json`, JSON.stringify({ version: 3, title: "Turnia", order: ["cover"] }), null);
  for (const revision of [1, 0, 7]) {
    const stale = await a.execute("render_deliverable", { deliverable_id: id, revision, formats: ["pdf"] });
    expect(stale.response).toEqual({ ok: false, error: "revision_conflict", message: expect.stringMatching(new RegExp(`revision ${revision} .*current revision is 2`)) });
  }
  expect(await f.database.query(`select "id" from "artifactJobs" where "artifactId"=$1`, [id])).toEqual([]);
  expect((await a.execute("render_deliverable", { deliverable_id: id, revision: 2, formats: ["pdf"] })).response).toMatchObject({ ok: true, status: "queued", revision: 2 });
});

it("a manifest that does not exist yet says so, not «is not JSON»", async () => {
  const a = createArtifactAgent({ database: f.database, store: f.store, jobs: createArtifactJobs(f.database, f.store), data: createArtifactData(f.database, f.store, async () => null), captureContext: async () => ({ files: {}, settingsHash: "a".repeat(64), capturedAt: new Date().toISOString(), resourceRefs: [] }) }, f.owner, () => "human-message", ["slides", "dashboard"]);
  const board = String((await a.execute("create_deliverable", { kind: "dashboard", item_key: "board", title: "Escenario", brief: "Mi app" })).response.artifactId);
  await a.workspace.write(`/.len/artifacts/${board}/index.html`, "<html><head></head><body></body></html>", null);
  expect((await a.execute("render_deliverable", { deliverable_id: board, revision: 1, formats: ["html"] })).response).toEqual({ ok: false, error: "invalid_dashboard_manifest", message: "dashboard.json does not exist yet: write it before rendering" });
  const deck = String((await a.execute("create_deliverable", { kind: "slides", item_key: "deck", title: "Presentación", brief: "Mi app" })).response.artifactId);
  await a.workspace.write(`/.len/artifacts/${deck}/slides/cover.html`, '<section id="cover" style="background:#fff"><h1>Turnia</h1></section>', null);
  expect((await a.execute("render_deliverable", { deliverable_id: deck, revision: 1, formats: ["pdf"] })).response).toEqual({ ok: false, error: "invalid_slide_deck", message: "deck.json does not exist yet: write it before rendering" });
});

// The same trial: `formats` left out once and ["web","png","csv"] once, each answered with a bare code.
it("an unavailable format says what the piece exports", async () => {
  const a = agent();
  const { id } = await queuedDeck(a);
  expect((await a.execute("render_deliverable", { deliverable_id: id, revision: 2, formats: ["web", "pdf"] })).response).toEqual({ ok: false, error: "format_unavailable", message: '"formats" is ["web","pdf"]; for slides use html, pdf, pptx (one or more)' });
  expect((await a.execute("render_deliverable", { deliverable_id: id, revision: 2 })).response).toEqual({ ok: false, error: "format_unavailable", message: '"formats" is missing; for slides use html, pdf, pptx (one or more)' });
  expect((await a.execute("render_deliverable", { deliverable_id: id, revision: 2, formats: [] })).response).toMatchObject({ ok: false, error: "format_unavailable", message: expect.stringContaining('"formats" is []') });
});

it("declares only wired formats when enabled and exposes manuals by Read path", () => {
  expect(artifactToolDeclarations([])).toEqual([]);
  const off = buildFunctionDeclarations({ OPENLEN_ARTIFACTS: "0" }, { artifactKinds: ["slides"] });
  expect(off.some((t) => t.name === "create_deliverable")).toBe(false);
  const on = buildFunctionDeclarations({ OPENLEN_ARTIFACTS: "1" }, { artifactKinds: ["slides"] });
  const create = on.find((t) => t.name === "create_deliverable")!;
  expect(JSON.stringify(create)).toContain('"enum":["slides"]');
  expect(on.some((t) => t.name === "ToolSearch")).toBe(false);
  // With skills on, each manual is its artifact-<kind> skill (spec local 2026-10-27-len-five-skills),
  // for a kind the server can render; off, at its old path.
  const docs = documentosDeLaPlataforma(null, { OPENLEN_ARTIFACTS: "1", OPENLEN_ARTIFACT_RENDERER_IMAGE: "openlen/artifact-renderer:2", OPENLEN_ARTIFACT_MOTION_VERIFIED: "1" });
  expect(docs["/.openlen/skills/artifact-slides/SKILL.md"]).toContain("deck.json");
  expect(docs["/.openlen/skills/artifact-motion/SKILL.md"]).toContain("without voice");
  const docsOff = documentosDeLaPlataforma(null, { OPENLEN_ARTIFACTS: "1", OPENLEN_SKILLS: "0" });
  expect(docsOff["/.openlen/docs/deliverables/slides.md"]).toContain("deck.json");
  expect(buildManualDeLaPlataforma({ OPENLEN_ARTIFACTS: "1" })).toContain("create_deliverable");
  expect(isConcurrencySafe("list_deliverables", {})).toBe(true);
  expect(isConcurrencySafe("query_deliverable_data", {})).toBe(false);
});

it("retains durable-mutation evidence if later metadata validation fails", async () => {
  const out = await agent().execute("create_deliverable", { ...piece("broken-dependency"), dependencies: [{ artifactId: "missing", revision: 1 }] });
  expect(out.response.ok).toBe(false);
  expect(out.mutoDurable).toBe(true);
});

it("freezes selected project source once for a motion item and keeps it on request retries",async()=>{
  const source={files:{"/index.html":"<html><head></head><body>My original app</body></html>"},settings:{}};
  const load=async()=>source;
  const a=createArtifactAgent({database:f.database,store:f.store,jobs:createArtifactJobs(f.database,f.store),data:createArtifactData(f.database,f.store,async()=>null),captureContext:createArtifactContextCapture(f.database,load),freezeSource:createArtifactSourceFreeze(f.database,load)},f.owner,()=>"freeze-message",["motion"]);
  const args={kind:"motion",item_key:"app-video",title:"Video",brief:"Show my app",source_paths:["/index.html"],freeze_source:true};
  const created=await a.execute("create_deliverable",args);expect(created.response.ok).toBe(true);
  const id=String(created.response.artifactId),saved=await f.store.getRevision(f.owner,id,1);
  expect(saved.files["project-source/index.html"]).toContain("My original app");
  expect(saved.sourceRef?.frozenSourcePrefix).toBe("project-source/");
  source.files["/index.html"]="The app changed later";
  const retry=await a.execute("create_deliverable",args);expect(retry.response.artifactId).toBe(id);
  expect((await f.store.getRevision(f.owner,id,1)).files).toEqual(saved.files);
  // A composition to render (render_deliverable checks it before queuing).
  await f.store.writeArtifactFiles(f.owner,id,1,{"motion.json":JSON.stringify({version:1,entry:"index.html",runtime:"gsap-3.15.0",width:1280,height:720,fps:30,durationSeconds:1,datasetIds:[]}),"index.html":'<html><head></head><body><h1>Video</h1><script src="main.ts"></script></body></html>',"main.ts":"window.lenMotion={durationSeconds:1,ready:async()=>{},seek:async()=>{}};"});
  const refreshed=await a.execute("render_deliverable",{deliverable_id:id,revision:2,formats:["html"],refresh_source_paths:["/index.html"]});
  expect(refreshed.response).toMatchObject({ok:true,artifactId:id,revision:3,status:"queued"});
  expect((await f.store.getRevision(f.owner,id,3)).files["project-source/index.html"]).toBe("The app changed later");
  expect((await f.store.getRevision(f.owner,id,1)).files).toEqual(saved.files);
  expect((await a.execute("render_deliverable",{deliverable_id:id,revision:2,formats:["html"],refresh_source_paths:["/index.html"]})).response).toMatchObject({ok:false,error:"revision_conflict"});
  expect((await f.store.getArtifact(f.owner,id)).currentRevision).toBe(3);
});

it("checks a piece before queuing it, as Claude Code validates a tool's input before running it: nothing is sealed or queued", async () => {
  const a = createArtifactAgent({ database: f.database, store: f.store, jobs: createArtifactJobs(f.database, f.store), data: createArtifactData(f.database, f.store, async () => null), captureContext: async () => ({ files: {}, settingsHash: "a".repeat(64), capturedAt: new Date().toISOString(), resourceRefs: [] }) }, f.owner, () => "human-message", ["slides", "dashboard"]);
  const deck = await a.execute("create_deliverable", { kind: "slides", item_key: "deck", title: "Presentación", brief: "Mi app" });
  const id = String(deck.response.artifactId);
  const files = { "deck.json": JSON.stringify({ version: 3, title: "Turnia", order: ["cover"] }), "slides/cover.html": '<section id="cover" style="background:#fff">\n<button>Reservar</button>\n</section>' };
  const written = await f.store.writeArtifactFiles(f.owner, id, 0, files);
  const refused = await a.execute("render_deliverable", { deliverable_id: id, revision: written.revision, formats: ["pptx"] });
  expect(refused.response).toMatchObject({ ok: false, error: "slide_format_invalid", message: expect.stringContaining("slides/cover.html 2:1 <button>") });
  expect((await f.store.getRevision(f.owner, id, written.revision)).sealedAt).toBeNull();
  expect(await f.database.query(`select "id" from "artifactJobs" where "artifactId"=$1`, [id])).toEqual([]);
  // A retired format says what to write instead.
  const old = await f.store.writeArtifactFiles(f.owner, id, written.revision, { "deck.json": JSON.stringify({ version: 2, title: "x", width: 1280, height: 720, slides: [{ id: "cover", source: "slides/cover.html" }] }) });
  expect((await a.execute("render_deliverable", { deliverable_id: id, revision: old.revision, formats: ["pptx"] })).response).toMatchObject({ ok: false, error: "invalid_slide_deck", message: expect.stringMatching(/version 2.*retired.*version 3/) });
  // A dashboard without data, the same way.
  const board = await a.execute("create_deliverable", { kind: "dashboard", item_key: "board", title: "Escenario", brief: "Mi app" });
  const boardId = String(board.response.artifactId);
  const boardRev = await f.store.writeArtifactFiles(f.owner, boardId, 0, { "dashboard.json": JSON.stringify({ entry: "index.html", datasetIds: [], width: 1280, height: 720 }), "index.html": "<html><head></head><body></body></html>" });
  expect((await a.execute("render_deliverable", { deliverable_id: boardId, revision: boardRev.revision, formats: ["html"] })).response).toMatchObject({ ok: false, error: "dashboard_dataset_missing" });
});

it("never answers an unexpected failure with a bare code: Len gets its message, as Claude Code returns a tool's error", async () => {
  const data = { ...createArtifactData(f.database, f.store, async () => null), queryArtifactData: async () => { throw new TypeError("Cannot find module 'gsap/dist/gsap.min.js'"); } };
  const a = createArtifactAgent({ database: f.database, store: f.store, jobs: createArtifactJobs(f.database, f.store), data, captureContext: async () => ({ files: {}, settingsHash: "a".repeat(64), capturedAt: new Date().toISOString(), resourceRefs: [] }) }, f.owner, () => "human-message", ["dashboard"]);
  const created = await a.execute("create_deliverable", { kind: "dashboard", item_key: "board", title: "Escenario", brief: "Mi app" });
  const failed = await a.execute("query_deliverable_data", { deliverable_id: created.response.artifactId, source: "scenario", columns: ["mes"], rows_json: "[[\"Mes 1\"]]" });
  expect(failed.response).toEqual({ ok: false, error: "artifact_unavailable", message: "internal error (TypeError): Cannot find module 'gsap/dist/gsap.min.js'; this is OpenLen's fault, not yours: tell the user it failed and why" });
});

it("🔴 declares the seven *deliverable* tools with deliverable_id and manuals at /.openlen/docs/deliverables/", async () => {
  const { ARTIFACT_TOOLS } = await import("./tools");
  const { ARTIFACT_MANUAL_INDEX, artifactManuals } = await import("@/lib/agent/artifact-manuals");
  expect([...ARTIFACT_TOOLS]).toEqual([
    "create_deliverable",
    "list_deliverables",
    "inspect_deliverable",
    "render_deliverable",
    "cancel_deliverable_job",
    "query_deliverable_data",
    "list_deliverable_audio",
  ]);
  const decls = artifactToolDeclarations(["dashboard", "slides", "image", "motion", "audio"]);
  expect(decls.map((d) => d.name).sort()).toEqual([...ARTIFACT_TOOLS].sort());
  for (const d of decls) {
    const props = (d.parameters as { properties?: Record<string, unknown> }).properties ?? {};
    expect(props, String(d.name)).not.toHaveProperty("artifact_id");
    if (["inspect_deliverable", "render_deliverable", "cancel_deliverable_job", "query_deliverable_data"].includes(String(d.name))) {
      expect(props, String(d.name)).toHaveProperty("deliverable_id");
    }
  }
  expect(ARTIFACT_MANUAL_INDEX).toContain("/.openlen/docs/deliverables/<kind>.md");
  expect(ARTIFACT_MANUAL_INDEX).not.toContain("/.openlen/docs/artifacts/");
  expect(Object.keys(artifactManuals).sort()).toEqual([
    "/.openlen/docs/deliverables/audio.md",
    "/.openlen/docs/deliverables/dashboard.md",
    "/.openlen/docs/deliverables/image.md",
    "/.openlen/docs/deliverables/motion.md",
    "/.openlen/docs/deliverables/slides.md",
  ]);
});

it("🔴 no model-facing source in lib/artifacts or lib/agent still says create_artifact or the old deliverable tool names", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const OLD_NAMES = /\b(create_artifact|list_artifacts|inspect_artifact|render_artifact|cancel_artifact_job|query_artifact_data|list_artifact_audio)\b|\/\.openlen\/docs\/artifacts\//;
  // Legacy path redirect for old conversations that read /.openlen/docs/artifacts/<kind>.md.
  const ALLOWED = new Set(["lib/agent/ficheros/manual.ts"]);
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|md)$/.test(entry.name) || /\.test\.ts$|\.spec\.ts$/.test(entry.name)) continue;
      if (ALLOWED.has(full)) continue;
      if (OLD_NAMES.test(readFileSync(full, "utf8"))) offenders.push(full);
    }
  };
  walk("lib/artifacts");
  walk("lib/agent");
  expect(offenders).toEqual([]);
});
