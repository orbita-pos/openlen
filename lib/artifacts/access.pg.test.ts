// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { artifactFixture } from "./testing/fixture";
import { readableArtifacts, requireArtifactAccess } from "./access";
import { ArtifactError, type ArtifactContext, type ArtifactSql } from "./types";

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

describe("many artifacts at once", () => {
  // A cycle or a chain past the dependency limit cannot be saved through the
  // store; only a direct write to the current revision can leave one behind.
  async function setDependencies(id: string, dependencies: string[]) {
    await f.pg.query(`update "artifactRevisions" r set "dependencies"=$2::jsonb from "artifacts" a where a."id"=r."artifactId" and r."revision"=a."currentRevision" and a."id"=$1`, [id, JSON.stringify(dependencies.map((artifactId) => ({ artifactId, revision: 0 })))]);
  }
  async function oneByOne(ctx: ArtifactContext, ids: readonly string[]) {
    const readable: string[] = [];
    for (const id of ids) {
      try { readable.push((await requireArtifactAccess(f.database, ctx, id, "read")).id); }
      catch (error) { if (!(error instanceof ArtifactError)) throw error; }
    }
    return readable;
  }
  const actors: ArtifactContext[] = [
    { actorId: "owner", ownerId: "owner", projectId: "project", requestId: "", role: "dueno" },
    { actorId: "editor", ownerId: "owner", projectId: "project", requestId: "", role: "editor" },
    { actorId: "reader", ownerId: "owner", projectId: "project", requestId: "", role: "lector" },
  ];

  it("answers exactly like one-by-one access, at the dependency limit too", async () => {
    const shared = await f.create("project");
    const hidden = await f.create("owner");
    const usesHidden = await f.create("project");
    await f.store.writeArtifactFiles(usesHidden.ctx, usesHidden.artifact.id, 0, { "deck.json": "{}" }, { dependencies: [{ artifactId: hidden.artifact.id, revision: 0 }] });
    const usesShared = await f.create("project");
    await f.store.writeArtifactFiles(usesShared.ctx, usesShared.artifact.id, 0, { "deck.json": "{}" }, { dependencies: [{ artifactId: shared.artifact.id, revision: 0 }] });
    const loopA = await f.create(), loopB = await f.create(), intoLoop = await f.create();
    await setDependencies(loopA.artifact.id, [loopB.artifact.id]);
    await setDependencies(loopB.artifact.id, [loopA.artifact.id]);
    await setDependencies(intoLoop.artifact.id, [loopA.artifact.id]);
    const missing = await f.create();
    await setDependencies(missing.artifact.id, ["not-an-artifact"]);
    // 101 artifacts in a row: the first is one past the limit, the second is at it.
    const chain: string[] = [];
    for (let i = 0; i < 101; i++) chain.push((await f.create()).artifact.id);
    for (let i = 0; i < chain.length - 1; i++) await setDependencies(chain[i]!, [chain[i + 1]!]);
    const ids = [shared, hidden, usesHidden, usesShared, loopA, loopB, intoLoop, missing].map((x) => x.artifact.id).concat(chain[0]!, chain[1]!, chain[50]!, "not-an-artifact");
    for (const ctx of actors) {
      const expected = await oneByOne(ctx, ids);
      expect((await readableArtifacts(f.database, ctx, ids)).map((a) => a.id)).toEqual(expected);
    }
    expect(await oneByOne(actors[0]!, [chain[0]!, chain[1]!])).toEqual([chain[1]]);
  }, 60_000);

  it("checks many artifacts in a handful of queries", async () => {
    const base = await f.create("project");
    const ids: string[] = [];
    for (let i = 0; i < 40; i++) {
      const item = await f.create("project");
      if (i % 2) await f.store.writeArtifactFiles(item.ctx, item.artifact.id, 0, { "deck.json": "{}" }, { dependencies: [{ artifactId: base.artifact.id, revision: 0 }] });
      ids.push(item.artifact.id);
    }
    let queries = 0;
    const counted: ArtifactSql = { query: (text, values) => { queries++; return f.database.query(text, values); } };
    expect(await readableArtifacts(counted, actors[1]!, ids)).toHaveLength(40);
    expect(queries).toBeLessThanOrEqual(6);
  }, 60_000);
});
