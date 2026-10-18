import assert from "node:assert/strict";
import { test } from "node:test";
import { artifactFixture } from "@/lib/artifacts/testing/fixture";
import { createArtifactWorkspace } from "@/lib/artifacts/workspace";
import { isVersionable } from "@/lib/git/worktree";
import { toolRead, toolWrite, toolEdit, cargarFicherosDeLaTerminal, guardarLoDeLaTerminal } from "./herramientas-de-ficheros";
import type { AgentDeps, AgentSession } from "./tools";

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
