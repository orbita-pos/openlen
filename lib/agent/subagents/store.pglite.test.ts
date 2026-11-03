// @vitest-environment node
//
// Len's subagents as `subagentRuns` keeps them, against real Postgres (PGlite), with the table as
// `scripts/subagents-migrate.ts` creates it.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

const base = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return base.db;
    },
  };
});

const { ALTER_AGENT_REQUEST_STEPS, ALTER_SUBAGENT_RUNS, CREATE_SUBAGENTS } = await import("@/scripts/subagents-migrate-sql");
const store = await import("./store");

const RUN = { projectId: "p1", chatRowId: "row1", turnId: "t1", personId: "u1", preset: "Explore", description: "Find the menu", prompt: "Where is it?", forked: false, planMode: false };
const SETTLED = { finalText: "In /menu/index.html:12.", diagnostic: null, transcript: [{ role: "user", content: "Where is it?" }], actions: [], usage: { inputTokens: 10, outputTokens: 2, cachedTokens: 0, thinkingTokens: 0 }, toolUses: 3, durationMs: 4200, chargedCenticredits: 7 };

beforeEach(async () => {
  const pg = new PGlite();
  await pg.query(`CREATE TABLE "projects" ("id" text PRIMARY KEY)`);
  await pg.query(`INSERT INTO "projects" VALUES ('p1')`);
  for (const statement of [...CREATE_SUBAGENTS, ...ALTER_SUBAGENT_RUNS]) await pg.query(statement);
  // The chat rows a run hangs from, with only what the conversation filter reads.
  await pg.query(`CREATE TABLE "projectChatMessages" ("id" text PRIMARY KEY, "projectId" text NOT NULL, "conversation" text)`);
  await pg.query(`INSERT INTO "projectChatMessages" VALUES ('row1', 'p1', NULL), ('row-old', 'p1', 'archived-1')`);
  base.db = drizzle(pg, { schema });
});

describe("subagentRuns", () => {
  it("a new run is running, and a turn's row lists it", async () => {
    await store.createRun({ id: "r1", ...RUN });
    const runs = await store.runsOfRow("p1", "row1");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: "r1", status: "running", preset: "Explore", toolUses: 0, settledAt: null, noticeDeliveredAt: null });
  });

  it("progress is kept while it runs", async () => {
    await store.createRun({ id: "r1", ...RUN });
    await store.saveProgress("r1", { transcript: [{ role: "user", content: "x" }], actions: [{ tool: "Read" }], toolUses: 1, durationMs: 10 });
    expect((await store.runsOfRow("p1", "row1"))[0]).toMatchObject({ status: "running", actions: [{ tool: "Read" }], toolUses: 1 });
  });

  it("settling records how it ended and when", async () => {
    await store.createRun({ id: "r1", ...RUN });
    await store.settleRun("r1", { status: "completed", ...SETTLED });
    const [r] = await store.runsOfRow("p1", "row1");
    expect(r).toMatchObject({ status: "completed", finalText: "In /menu/index.html:12.", toolUses: 3, durationMs: 4200, chargedCenticredits: 7 });
    expect(r!.settledAt).toBeInstanceOf(Date);
  });

  it("a notice is marked delivered once", async () => {
    await store.createRun({ id: "r1", ...RUN });
    await store.settleRun("r1", { status: "completed", ...SETTLED });
    expect(await store.markNoticeDelivered("r1")).toBe(true);
    expect(await store.markNoticeDelivered("r1")).toBe(false);
  });

  it("the running ones, and the settled ones whose notice never went, are found", async () => {
    await store.createRun({ id: "r1", ...RUN });
    await store.createRun({ id: "r2", ...RUN });
    await store.createRun({ id: "r3", ...RUN });
    await store.settleRun("r2", { status: "aborted", ...SETTLED });
    await store.settleRun("r3", { status: "completed", ...SETTLED });
    await store.markNoticeDelivered("r3");
    expect((await store.runningRuns()).map((r) => r.id)).toEqual(["r1"]);
    expect((await store.undeliveredSettledRuns("p1")).map((r) => r.id)).toEqual(["r2"]);
    // Without a project, every project's (the boot cleanup).
    expect((await store.undeliveredSettledRuns()).map((r) => r.id)).toEqual(["r2"]);
    expect(await store.undeliveredSettledRuns("other")).toEqual([]);
  });

  it("one run is found by its id, and an unknown id is null", async () => {
    await store.createRun({ id: "r1", ...RUN });
    expect(await store.runById("r1")).toMatchObject({ id: "r1", projectId: "p1", personId: RUN.personId });
    expect(await store.runById("nope")).toBeNull();
  });

  it("`npm run subagents:migrate` runs twice on the same database without failing", async () => {
    const pg = new PGlite();
    await pg.query(`CREATE TABLE "projects" ("id" text PRIMARY KEY)`);
    await pg.query(`CREATE TABLE "agentRequestSteps" ("id" text PRIMARY KEY)`);
    for (let i = 0; i < 2; i++) for (const statement of [...CREATE_SUBAGENTS, ...ALTER_SUBAGENT_RUNS, ...ALTER_AGENT_REQUEST_STEPS]) await pg.query(statement);
    const runCols = await pg.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'subagentRuns' and column_name = 'forked'`);
    expect(runCols.rows).toHaveLength(1);
    const cols = await pg.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'agentRequestSteps'`);
    expect(cols.rows.map((r) => r.column_name).sort()).toEqual(["id", "subagentId"]);
  });

  it("the worktree columns", async () => {
    await store.createRun({ id: "r1", ...RUN });
    expect(await store.runById("r1")).toMatchObject({ worktreeCopyId: null, worktreeBranch: null, worktreeBase: null, worktreeOutcome: null });
    await store.setWorktree("r1", { copyId: "copy-1", branch: "worktree-agent-r1", base: "a".repeat(40) });
    await store.setWorktreeOutcome("r1", { state: "conflict", files: ["/src/a.ts"], branch: "worktree-agent-r1" });
    expect(await store.runById("r1")).toMatchObject({ worktreeCopyId: "copy-1", worktreeBranch: "worktree-agent-r1", worktreeBase: "a".repeat(40), worktreeOutcome: { state: "conflict", files: ["/src/a.ts"], branch: "worktree-agent-r1" } });
    expect((await store.runsOfRow("p1", "row1"))[0]).toMatchObject({ worktreeBranch: "worktree-agent-r1", worktreeOutcome: { state: "conflict" } });
    const pg = new PGlite();
    await pg.query(`CREATE TABLE "projects" ("id" text PRIMARY KEY)`);
    for (let i = 0; i < 2; i++) for (const statement of [...CREATE_SUBAGENTS, ...ALTER_SUBAGENT_RUNS]) await pg.query(statement);
    const cols = await pg.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'subagentRuns' and column_name like 'worktree%'`);
    expect(cols.rows.map((r) => r.column_name).sort()).toEqual(["worktreeBase", "worktreeBranch", "worktreeCopyId", "worktreeOutcome"]);
  });

  it("lists only the current conversation's runs, oldest first", async () => {
    await store.createRun({ id: "r1", ...RUN });
    await store.createRun({ id: "r2", ...RUN, chatRowId: "row-old" });
    await store.createRun({ id: "r3", ...RUN });
    expect((await store.runsOfCurrentConversation("p1")).map((r) => r.id)).toEqual(["r1", "r3"]);
  });

  it("reopens a settled run once; a running or unknown one stays as it is", async () => {
    await store.createRun({ id: "r1", ...RUN });
    expect(await store.reopenRun("r1", "u1")).toBe(false);
    await store.settleRun("r1", { status: "completed", ...SETTLED });
    await store.markNoticeDelivered("r1");
    expect(await store.reopenRun("r1", "u1")).toBe(true);
    expect(await store.runById("r1")).toMatchObject({ status: "running", settledAt: null, noticeDeliveredAt: null, toolUses: 3, chargedCenticredits: 7 });
    expect(await store.reopenRun("r1", "u1")).toBe(false);
    expect(await store.reopenRun("nope", "u1")).toBe(false);
  });

  it("a reopened run is recorded for whoever woke it", async () => {
    await store.createRun({ id: "r1", ...RUN });
    await store.settleRun("r1", { status: "completed", ...SETTLED });
    expect(await store.reopenRun("r1", "m2")).toBe(true);
    expect((await store.runById("r1"))!.personId).toBe("m2");
  });

  it("the conversation's list and the cards' reads leave the transcript out; one child of the conversation is read whole", async () => {
    await store.createRun({ id: "r1", ...RUN });
    await store.settleRun("r1", { status: "completed", ...SETTLED });
    await store.createRun({ id: "r2", ...RUN, chatRowId: "row-old" });
    const light = [...(await store.runsOfCurrentConversation("p1")), ...(await store.runsOfRow("p1", "row1")), ...(await store.runsByIds("p1", ["r1", "r2"]))];
    expect(light).toHaveLength(4);
    for (const r of light) {
      expect(r).not.toHaveProperty("transcript");
      expect(r).not.toHaveProperty("prompt");
    }
    expect(await store.runsOfCurrentConversation("p1")).toEqual([{ id: "r1", description: "Find the menu", preset: "Explore" }]);
    expect(await store.runOfCurrentConversation("p1", "r1")).toMatchObject({ id: "r1", transcript: SETTLED.transcript, prompt: "Where is it?", forked: false });
    expect(await store.runOfCurrentConversation("p1", "r2")).toBeNull();
    expect(await store.runOfCurrentConversation("p2", "r1")).toBeNull();
  });

  it("runs are found by their ids, only in their project", async () => {
    await store.createRun({ id: "r1", ...RUN });
    await store.createRun({ id: "r2", ...RUN, chatRowId: "row-old" });
    expect((await store.runsByIds("p1", ["r2", "r1", "nope"])).map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(await store.runsByIds("p2", ["r1"])).toEqual([]);
    expect(await store.runsByIds("p1", [])).toEqual([]);
  });

  it("a reopened run is not marked delivered by an earlier settlement's notice", async () => {
    await store.createRun({ id: "r1", ...RUN });
    await store.settleRun("r1", { status: "completed", ...SETTLED });
    expect(await store.reopenRun("r1", "u1")).toBe(true);
    expect(await store.markNoticeDelivered("r1")).toBe(false);
    expect((await store.runById("r1"))!.noticeDeliveredAt).toBeNull();
  });

  it("the settled runs of an archived conversation are never told to Len again", async () => {
    await store.createRun({ id: "r1", ...RUN });
    await store.createRun({ id: "r2", ...RUN, chatRowId: "row-old" });
    for (const id of ["r1", "r2"]) await store.settleRun(id, { status: "completed", ...SETTLED });
    expect((await store.undeliveredSettledRuns()).map((r) => r.id)).toEqual(["r1"]);
    expect((await store.undeliveredSettledRuns("p1")).map((r) => r.id)).toEqual(["r1"]);
  });

  it("the scope it started with (plan mode) is recorded, and progress keeps its duration", async () => {
    await store.createRun({ id: "r1", ...RUN, planMode: true });
    await store.saveProgress("r1", { transcript: [], actions: [], toolUses: 1, durationMs: 1234 });
    expect(await store.runOfCurrentConversation("p1", "r1")).toMatchObject({ planMode: true, durationMs: 1234, toolUses: 1 });
  });

  it("a fork is recorded as forked", async () => {
    await store.createRun({ id: "r1", ...RUN, preset: "general-purpose", forked: true });
    await store.createRun({ id: "r2", ...RUN });
    expect((await store.runById("r1"))!.forked).toBe(true);
    expect((await store.runById("r2"))!.forked).toBe(false);
  });
});
