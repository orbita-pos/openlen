import assert from "node:assert/strict";
import { test } from "node:test";
import { artifactFixture } from "@/lib/artifacts/testing/fixture";
import { createArtifactWorkspace } from "@/lib/artifacts/workspace";
import { isVersionable } from "@/lib/git/worktree";
import { toolRead, toolWrite, toolEdit, cargarFicherosDeLaTerminal, guardarLoDeLaTerminal } from "./herramientas-de-ficheros";
import type { AgentDeps, AgentSession } from "./tools";
import { runAgentTool } from "./tools";
import { createArtifactAgent } from "@/lib/artifacts/tools";
import { createArtifactJobs } from "@/lib/artifacts/jobs";
import { createArtifactData } from "@/lib/artifacts/data";
import { textoDeLaPlataforma } from "./manual-de-la-plataforma";
test("native agent dispatch lists project audio without changing app files",async()=>{
  const f=await artifactFixture();
  try{
    const filename=`${"a".repeat(64)}.mp3`;
    const artifactAgent=createArtifactAgent({database:f.database,store:f.store,jobs:createArtifactJobs(f.database,f.store),data:createArtifactData(f.database,f.store,async()=>null),captureContext:async()=>{throw Error("not requested");},audioUploads:{listAudio:async id=>{assert.equal(id,"project");return [{filename,contentType:"audio/mpeg",size:100,url:"not exposed",uploadedAt:0}];},get:async()=>{throw Error("listing must not read bytes");}}},f.owner,()=>"audio-message",["audio"]);
    const deps={artifactAgent,loadProject:async()=>({data:{html:"original"},userBrief:null}),projectFiles:async()=>({}),saveProjectData:async()=>{throw Error("must not change app");}} as unknown as AgentDeps;
    const session={projectId:"project",userId:"owner",page:null,ownerEmail:null,imageEditsThisTurn:0,photoSearchesThisTurn:0,busquedasVaciasSeguidas:0} as AgentSession;
    const result=await runAgentTool(session,deps,"list_artifact_audio",{projectId:"other"});
    assert.equal(result.response.ok,true,JSON.stringify(result.response));assert.deepEqual(result.response.assets,[{id:`upload:${filename}`,filename,mime:"audio/mpeg",bytes:100}]);assert.equal(result.mutoDurable,undefined);
  }finally{await f.pg.close();}
});

test("Read/Write/Edit and terminal saves share private artifact sources without changing the app", async () => {
  const f = await artifactFixture();
  try {
    const { ctx, artifact } = await f.create();
    const artifacts = createArtifactWorkspace(f.store, ctx);
    const path = `/.len/artifacts/${artifact.id}/deck.json`;
    const data = { html: "<h1>App stays here</h1>" };
    const deps = {
      artifacts,
      loadProject: async () => ({ data, userBrief: null, title: "My app", subdomain: null, publishedAt: null }),
      projectFiles: async () => ({}),
      saveProjectData: async () => { throw new Error("must not write the app"); },
      saveProjectFile: async () => { throw new Error("must not write publishable files"); },
    } as unknown as AgentDeps;
    const session: AgentSession = { projectId: "project", userId: "owner", page: null, ownerEmail: null, imageEditsThisTurn: 0, photoSearchesThisTurn: 0, busquedasVaciasSeguidas: 0 };
    const created = await toolWrite(session, deps, { file_path: path, content: '{"title":"Old"}' });
    assert.equal(created.response.ok, true, JSON.stringify(created.response));
    assert.equal((await toolRead(session, deps, { file_path: path })).response.ok, true);
    assert.equal((await toolEdit(session, deps, { file_path: path, old_string: "Old", new_string: "New" })).response.ok, true);
    const files = await cargarFicherosDeLaTerminal(session, deps);
    assert.equal(files[path], '{"title":"New"}');
    assert.equal(isVersionable(path), false, "private sources must not enter the app repository");
    const saved = await guardarLoDeLaTerminal(session, deps, [{ tipo: "escrito", ruta: path, contenido: '{"title":"Terminal"}', crea: false }], files);
    assert.equal(saved.rechazado, false);
    assert.equal(await artifacts.read(path), '{"title":"Terminal"}');
    assert.equal(data.html, "<h1>App stays here</h1>");
  } finally { await f.pg.close(); }
});

test("saving a slide answers with what is outside the slide format, anchored to its line", async () => {
  const f = await artifactFixture();
  try {
    const { ctx, artifact } = await f.create();
    const deps = { artifacts: createArtifactWorkspace(f.store, ctx), loadProject: async () => ({ data: { html: "" }, userBrief: null, title: "App", subdomain: null, publishedAt: null }), projectFiles: async () => ({}) } as unknown as AgentDeps;
    const session: AgentSession = { projectId: "project", userId: "owner", page: null, ownerEmail: null, imageEditsThisTurn: 0, photoSearchesThisTurn: 0, busquedasVaciasSeguidas: 0 };
    const path = `/.len/artifacts/${artifact.id}/slides/cover.html`;
    const saved = await toolWrite(session, deps, { file_path: path, content: '<section id="cover" style="background:#fff">\n<h1>Hola</h1>\n<button>Reservar</button>\n</section>' });
    assert.equal(saved.response.ok, true, JSON.stringify(saved.response));
    assert.deepEqual(saved.diagnosticos, [{ ruta: path, linea: 3, columna: 1, gravedad: "Error", mensaje: "<button>: not in the slide format — a <p> with background, padding and border-radius is a pill", fuente: "slides" }]);
    const clean = await toolWrite(session, deps, { file_path: path, content: '<section id="cover" style="background:#fff">\n<h1>Hola</h1>\n</section>' });
    assert.equal(clean.diagnosticos, undefined);
    // A manifest answers its save too: a retired deck format says what to write instead.
    const index = `/.len/artifacts/${artifact.id}/deck.json`;
    const old = await toolWrite(session, deps, { file_path: index, content: JSON.stringify({ version: 2, title: "x", slides: [] }) });
    assert.match(old.diagnosticos?.[0]?.mensaje ?? "", /version 2.*retired.*version 3/);
  } finally { await f.pg.close(); }
});

test("agent dispatch creates and queues sources without saving or compiling the app", async () => {
  const f = await artifactFixture();
  try {
    const artifactAgent = createArtifactAgent({ database: f.database, store: f.store, jobs: createArtifactJobs(f.database, f.store), data: createArtifactData(f.database, f.store, async () => null), captureContext: async () => { throw new Error("not requested"); } }, f.owner, () => "message", ["slides"]);
    const deps = { artifacts: artifactAgent.workspace, artifactAgent, loadProject: async () => ({ data: { html: "original" }, userBrief: null }), projectFiles: async () => ({}), saveProjectData: async () => { throw new Error("must not change the app"); } } as unknown as AgentDeps;
    const session = { projectId: "project", userId: "owner", page: null, ownerEmail: null, imageEditsThisTurn: 0, photoSearchesThisTurn: 0, busquedasVaciasSeguidas: 0 } as AgentSession;
    const result = await runAgentTool(session, deps, "create_artifact", { kind: "slides", item_key: "deck", title: "Deck", brief: "App" });
    assert.equal(result.response.ok, true);
    const id = result.response.artifactId;
    assert.equal((await runAgentTool(session, deps, "Write", { file_path: `/.len/artifacts/${id}/deck.json`, content: JSON.stringify({ version: 3, title: "Deck", order: ["cover"] }) })).response.ok, true);
    assert.equal((await runAgentTool(session, deps, "Write", { file_path: `/.len/artifacts/${id}/slides/cover.html`, content: '<section id="cover" style="background:#fff"><h1>App</h1></section>' })).response.ok, true);
    const queued = await runAgentTool(session, deps, "render_artifact", { artifact_id: id, revision: 2, formats: ["pdf"] });
    assert.equal(queued.response.status, "queued");
    assert.equal(queued.updatedHtml, undefined);
    assert.equal(queued.appCambiada, undefined);
    assert.equal(queued.mutoDurable, true);
    const previous = process.env.OPENLEN_ARTIFACTS;
    try {
      process.env.OPENLEN_ARTIFACTS = "1";
      assert.match(textoDeLaPlataforma("/.openlen/docs/artifacts/slides.md")!, /deck.json/);
      const read = await runAgentTool(session, deps, "Read", { file_path: "/.openlen/docs/artifacts/slides.md" });
      assert.equal(read.response.ok, true);
    } finally { if (previous === undefined) delete process.env.OPENLEN_ARTIFACTS; else process.env.OPENLEN_ARTIFACTS = previous; }
  } finally { await f.pg.close(); }
});
