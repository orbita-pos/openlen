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

const { CREATE_SUBAGENTS } = await import("@/scripts/subagents-migrate-sql");
const store = await import("./store");

const RUN = { projectId: "p1", chatRowId: "row1", turnId: "t1", personId: "u1", preset: "Explore", description: "Find the menu", prompt: "Where is it?" };
const SETTLED = { finalText: "In /menu/index.html:12.", diagnostic: null, transcript: [{ role: "user", content: "Where is it?" }], actions: [], usage: { inputTokens: 10, outputTokens: 2, cachedTokens: 0, thinkingTokens: 0 }, toolUses: 3, durationMs: 4200, chargedCenticredits: 7 };

beforeEach(async () => {
  const pg = new PGlite();
  await pg.query(`CREATE TABLE "projects" ("id" text PRIMARY KEY)`);
  await pg.query(`INSERT INTO "projects" VALUES ('p1')`);
  for (const statement of CREATE_SUBAGENTS) await pg.query(statement);
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
    await store.saveProgress("r1", { transcript: [{ role: "user", content: "x" }], actions: [{ tool: "Read" }], toolUses: 1 });
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
  });
});
