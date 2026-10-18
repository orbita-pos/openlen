// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { artifactFixture } from "./testing/fixture";
import { requireArtifactAccess } from "./access";

let f: Awaited<ReturnType<typeof artifactFixture>>;
beforeAll(async () => { f = await artifactFixture(); }, 30_000);
afterAll(async () => { await f.pg.close(); });

describe("artifact access uses current membership, not a supplied role", () => {
  it("reader can read project outputs but cannot write even with a forged owner role", async () => {
    const { ctx, artifact } = await f.create();
    const reader = { ...ctx, actorId: "reader", role: "dueno" as const };
    expect((await f.store.getArtifact(reader, artifact.id)).id).toBe(artifact.id);
    await expect(f.store.writeArtifactFiles(reader, artifact.id, 0, { "deck.json": "{}" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("owner-only data stays private from an editor with a forged owner role", async () => {
    const { ctx, artifact } = await f.create("owner");
    const editor = { ...ctx, actorId: "editor", role: "dueno" as const };
    await expect(f.store.getArtifact(editor, artifact.id)).rejects.toMatchObject({ code: "artifact_not_found" });
    await expect(requireArtifactAccess(f.database, editor, artifact.id, "data")).rejects.toMatchObject({ code: "artifact_not_found" });
    expect((await requireArtifactAccess(f.database, ctx, artifact.id, "data")).id).toBe(artifact.id);
  });

  it("rechecks revoked membership and refuses access from another project", async () => {
    const { ctx, artifact } = await f.create();
    const editor = { ...ctx, actorId: "editor", role: "editor" as const };
    expect((await f.store.getArtifact(editor, artifact.id)).id).toBe(artifact.id);
    await f.pg.query(`delete from "projectMembers" where "userId"='editor'`);
    await expect(f.store.getArtifact(editor, artifact.id)).rejects.toMatchObject({ code: "project_not_found" });
    await expect(f.store.getArtifact({ ...ctx, projectId: "other" }, artifact.id)).rejects.toMatchObject({ code: "artifact_not_found" });
    await f.pg.query(`insert into "projectMembers" values ('project','editor','editor')`);
  });

  it("a private dependency cannot widen its audience through a public project artifact", async () => {
    const privateArtifact = await f.create("owner");
    const outer = await f.create("project");
    await f.store.writeArtifactFiles(outer.ctx, outer.artifact.id, 0, { "deck.json": "{}" }, { dependencies: [{ artifactId: privateArtifact.artifact.id, revision: 0 }] });
    expect((await f.store.getArtifact(outer.ctx, outer.artifact.id)).visibility).toBe("owner");
    await expect(f.store.getArtifact({ ...outer.ctx, actorId: "editor", role: "editor" }, outer.artifact.id)).rejects.toMatchObject({ code: "artifact_not_found" });
  });

  it("rejects dependencies from another project and self-dependencies before saving files", async () => {
    const outer = await f.create();
    await expect(f.store.writeArtifactFiles(outer.ctx, outer.artifact.id, 0, { "deck.json": "{}" }, { dependencies: [{ artifactId: outer.artifact.id, revision: 0 }] })).rejects.toMatchObject({ code: "invalid_dependency" });
    expect((await f.store.getArtifact(outer.ctx, outer.artifact.id)).currentRevision).toBe(0);
  });
});
