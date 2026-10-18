// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { artifactFixture } from "./testing/fixture";
import { createArtifactWorkspace, parseArtifactPath } from "./workspace";

let f: Awaited<ReturnType<typeof artifactFixture>>;
beforeAll(async () => { f = await artifactFixture(); }, 30_000);
afterAll(async () => { await f.pg.close(); });
describe("artifact source workspace", () => {
  it("keeps sources outside projectFiles and rejects cross-artifact traversal", async () => {
    const { ctx, artifact } = await f.create();
    const workspace = createArtifactWorkspace(f.store, ctx);
    const path = `/.len/artifacts/${artifact.id}/deck.json`;
    expect(parseArtifactPath(path)).toEqual({ artifactId: artifact.id, path: "deck.json" });
    for (const bad of [`/.len/artifacts/${artifact.id}/../other/x`, `/.len/artifacts/${artifact.id}/a/../../x`, `/.len/artifacts/${artifact.id}\\x`]) expect(() => parseArtifactPath(bad)).toThrow();
    await workspace.read(path);
    await workspace.write(path, "{}", null);
    expect(await workspace.read(path)).toBe("{}");
    expect(await workspace.files()).toEqual({ [path]: "{}" });
    expect((await f.pg.query(`select "files" from "artifactRevisions" where "artifactId"=$1 and "revision"=1`, [artifact.id])).rows[0]).toEqual({ files: { "deck.json": "{}" } });
  });
  it("read-before-write detects changed content and preserves the newer edit", async () => {
    const { ctx, artifact } = await f.create();
    const path = `/.len/artifacts/${artifact.id}/deck.json`;
    const first = createArtifactWorkspace(f.store, ctx), other = createArtifactWorkspace(f.store, ctx);
    await first.read(path); await first.write(path, "old", null);
    expect(await first.read(path)).toBe("old");
    await other.read(path); await other.write(path, "newer", "old");
    await expect(first.write(path, "lost update", "old")).rejects.toMatchObject({ code: "revision_conflict" });
    expect(await first.read(path)).toBe("newer");
  });
});
