// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { artifactFixture } from "./testing/fixture";
import { createArtifactData, datasetsFromRevision } from "./data";
import { queryReadOnlyTransaction } from "../backend/sql-query";

let f: Awaited<ReturnType<typeof artifactFixture>>;
beforeAll(async () => { f = await artifactFixture(); await f.pg.exec("create table sales (total int); insert into sales values (10),(20)"); }, 30_000);
beforeEach(async () => { await f.pg.exec(`truncate "artifactRequests" cascade`); });
afterAll(async () => { await f.pg.close(); });
const noSource = async () => null;
const readSql = (text: string) => queryReadOnlyTransaction({ query: async (arg: string | { text: string }) => {
  const res = await f.pg.query(typeof arg === "string" ? arg : arg.text);
  return { ...res, command: "SELECT", rows: typeof arg === "string" ? res.rows : res.rows.map((r) => res.fields.map((field) => (r as Record<string, unknown>)[field.name])) };
} }, text);

it("creates a labeled scenario without touching a project database", async () => {
  const { ctx, artifact } = await f.create();
  const data = createArtifactData(f.database, f.store, async () => { throw new Error("no backend call allowed"); });
  const result = await data.queryArtifactData(ctx, artifact.id, { source: "scenario", columns: ["Mes", "Ventas"], rows: [["Octubre", 120]] });
  expect(result).toMatchObject({ mode: "scenario", environment: null, visibility: "project", rows: [["Octubre", 120]], query: null });
  const revision = await f.store.getRevision(ctx, artifact.id, 1);
  expect(datasetsFromRevision(revision)).toEqual([result]);
  expect((await f.store.getArtifact(ctx, artifact.id)).visibility).toBe("project");
});

it("denies editors before reading real data, even if they claim to be owner", async () => {
  const { ctx, artifact } = await f.create();
  const data = createArtifactData(f.database, f.store, async () => { throw new Error("data leaked"); });
  await expect(data.queryArtifactData({ ...ctx, actorId: "editor" }, artifact.id, { source: "backend", environment: "draft", mode: "snapshot", query: "select * from sales" })).rejects.toMatchObject({ code: "forbidden" });
  await expect(data.queryArtifactData({ ...ctx, projectId: "other" }, artifact.id, { source: "scenario", columns: ["x"], rows: [[1]] })).rejects.toMatchObject({ code: "artifact_not_found" });
});

it("does not invent metrics for a project without that data source", async () => {
  const { ctx, artifact } = await f.create();
  await expect(createArtifactData(f.database, f.store, noSource).queryArtifactData(ctx, artifact.id, { source: "backend", environment: "live", mode: "snapshot", query: "select 1" })).rejects.toMatchObject({ code: "data_source_unavailable" });
  expect((await f.store.getArtifact(ctx, artifact.id)).currentRevision).toBe(0);
});

it("reads real SQL in a read-only transaction and preserves a private frozen snapshot", async () => {
  const { ctx, artifact } = await f.create();
  const query = async (_ctx: unknown, input: { source: string; query?: string }) => {
    if (input.source !== "backend") return null;
    return readSql(input.query!);
  };
  const data = createArtifactData(f.database, f.store, query);
  const input = { source: "backend" as const, environment: "draft" as const, mode: "live" as const, query: "select sum(total)::int as total from sales" };
  const first = await data.queryArtifactData(ctx, artifact.id, input);
  expect(first).toMatchObject({ rows: [[30]], visibility: "owner", mode: "live", environment: "draft" });
  expect((await f.store.getArtifact(ctx, artifact.id)).visibility).toBe("owner");
  await expect(f.store.getRevision({ ...ctx, actorId: "editor" }, artifact.id, 1)).rejects.toMatchObject({ code: "artifact_not_found" });
  await f.store.sealArtifactRevision(ctx, artifact.id, 1);
  await f.pg.exec("insert into sales values (5)");
  const second = await data.queryArtifactData(ctx, artifact.id, input);
  expect(second.rows).toEqual([[35]]);
  expect(second.id).not.toBe(first.id);
  expect(datasetsFromRevision(await f.store.getRevision(ctx, artifact.id, 1))[0]!.rows).toEqual([[30]]);
  await expect(data.queryArtifactData(ctx, artifact.id, { ...input, query: "delete from sales" })).rejects.toMatchObject({ code: "read_only_query_required" });
  await expect(data.queryArtifactData(ctx, artifact.id, { ...input, query: "with removed as (delete from sales returning *) select * from removed" })).rejects.toMatchObject({ code: "data_query_failed" });
  expect((await f.pg.query("select count(*)::int as n from sales")).rows).toEqual([{ n: 3 }]);
});

it("applies the 10s statement limit and caps a real SQL result at 500 rows", async () => {
  expect(await readSql("select current_setting('statement_timeout') as timeout")).toMatchObject({ kind: "rows", rows: [["10s"]] });
  const result = await readSql("select n from generate_series(1,600) n");
  expect(result.kind).toBe("rows");
  if (result.kind === "rows") { expect(result.rows).toHaveLength(500); expect(result.truncated).toBe(true); }
  expect((await readSql("commit; delete from sales")).kind).toBe("error");
});

it("caps rows and rejects oversized or nonrectangular datasets", async () => {
  const { ctx, artifact } = await f.create();
  const data = createArtifactData(f.database, f.store, async () => ({ kind: "rows", columns: ["n"], rows: Array.from({ length: 600 }, (_, n) => [n]), truncated: false }));
  const result = await data.queryArtifactData(ctx, artifact.id, { source: "backend", environment: "draft", mode: "snapshot", query: "select n from numbers" });
  expect(result.rows).toHaveLength(500); expect(result.truncated).toBe(true);
  await expect(data.queryArtifactData(ctx, artifact.id, { source: "scenario", columns: ["n"], rows: [[1, 2]] })).rejects.toMatchObject({ code: "invalid_dataset" });
});
