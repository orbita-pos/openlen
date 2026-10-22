// @vitest-environment node
// The sandbox row in Postgres (LOCAL database only), with `npm run sandbox:migrate` applied.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";

import { spentTodayMicroUsd } from "./budget";
import { SANDBOX_USD_PER_SECOND } from "./size";
import {
  forgetProjectSandbox,
  getProjectSandbox,
  holdProjectSandbox,
  idleBefore,
  releaseProjectSandbox,
  saveProjectSandbox,
} from "./store";

const OWNER = "test-sandbox-owner";
const PROJECT = "test-sandbox-project";
const OTHER = "test-sandbox-project-2";

async function insertProject(id: string) {
  await db.execute(sql`insert into "projects" ("id", "userId", "title", "brief", "data") values (${id}, ${OWNER}, ${"box"}, ${""}, ${JSON.stringify({ html: "<h1>x</h1>" })}::jsonb)`);
}

beforeAll(async () => {
  await exigirBaseLocal();
  await db.execute(sql`insert into "users" ("id", "email", "name") values (${OWNER}, ${`${OWNER}@example.invalid`}, ${"Owner"}) on conflict do nothing`);
});
beforeEach(async () => {
  await db.delete(schema.projects).where(eq(schema.projects.id, PROJECT));
  await db.delete(schema.projects).where(eq(schema.projects.id, OTHER));
  await insertProject(PROJECT);
  await insertProject(OTHER);
});
afterAll(async () => {
  await db.delete(schema.projects).where(eq(schema.projects.id, PROJECT));
  await db.delete(schema.projects).where(eq(schema.projects.id, OTHER));
  await db.execute(sql`delete from "creditLedger" where "userId" = ${OWNER}`);
  await db.delete(schema.users).where(eq(schema.users.id, OWNER));
});

const row = (projectId: string, over: Partial<Parameters<typeof saveProjectSandbox>[0]> = {}) => ({
  projectId,
  sandboxId: `sbx-${projectId}`,
  template: "openlen-terminal-v1",
  state: "paused" as const,
  syncedManifest: { "/index.html": "abc" },
  pausedAt: new Date("2026-10-21T10:00:00Z"),
  ...over,
});

describe("the sandbox row", () => {
  it("is saved and read back with its manifest", async () => {
    await saveProjectSandbox(row(PROJECT));
    const got = await getProjectSandbox(PROJECT);
    expect(got).toMatchObject({ sandboxId: `sbx-${PROJECT}`, state: "paused", syncedManifest: { "/index.html": "abc" }, heldBy: null });
  });

  it("only one turn holds a project's box", async () => {
    await saveProjectSandbox(row(PROJECT));
    expect(await holdProjectSandbox(PROJECT, "turn-1")).toBe(true);
    expect(await holdProjectSandbox(PROJECT, "turn-2")).toBe(false);
    await releaseProjectSandbox(PROJECT, "turn-2");
    expect((await getProjectSandbox(PROJECT))?.heldBy).toBe("turn-1");
    await releaseProjectSandbox(PROJECT, "turn-1");
    expect(await holdProjectSandbox(PROJECT, "turn-2")).toBe(true);
  });

  it("a project with no box yet can be held (the row is born held)", async () => {
    expect(await holdProjectSandbox(PROJECT, "turn-1")).toBe(true);
    expect(await holdProjectSandbox(PROJECT, "turn-2")).toBe(false);
    expect((await getProjectSandbox(PROJECT))?.sandboxId).toBeNull();
  });

  it("saving keeps who holds it", async () => {
    expect(await holdProjectSandbox(PROJECT, "turn-1")).toBe(true);
    await saveProjectSandbox(row(PROJECT, { state: "running", pausedAt: null }));
    expect((await getProjectSandbox(PROJECT))?.heldBy).toBe("turn-1");
  });

  it("deleting the project deletes its row", async () => {
    await saveProjectSandbox(row(PROJECT));
    await db.delete(schema.projects).where(eq(schema.projects.id, PROJECT));
    expect(await getProjectSandbox(PROJECT)).toBeNull();
  });

  it("lists only the boxes paused before a cutoff, and forgets one", async () => {
    await saveProjectSandbox(row(PROJECT, { pausedAt: new Date("2026-10-10T00:00:00Z") }));
    await saveProjectSandbox(row(OTHER, { pausedAt: new Date("2026-10-20T00:00:00Z") }));
    const old = await idleBefore(new Date("2026-10-14T00:00:00Z"));
    expect(old.filter((b) => b.projectId.startsWith("test-sandbox"))).toEqual([{ projectId: PROJECT, sandboxId: `sbx-${PROJECT}`, pausedAt: new Date("2026-10-10T00:00:00Z") }]);
    await forgetProjectSandbox(PROJECT);
    expect(await getProjectSandbox(PROJECT)).toBeNull();
  });

  it("a hold older than 2 hours is taken: its turn died with the app (a deploy, a crash)", async () => {
    await saveProjectSandbox(row(PROJECT));
    expect(await holdProjectSandbox(PROJECT, "dead-turn")).toBe(true);
    expect(await holdProjectSandbox(PROJECT, "turn-2")).toBe(false);
    await db.execute(sql`update "projectSandboxes" set "updatedAt" = now() - interval '3 hours' where "projectId" = ${PROJECT}`);
    expect(await holdProjectSandbox(PROJECT, "turn-2")).toBe(true);
    expect(await getProjectSandbox(PROJECT)).toMatchObject({ heldBy: "turn-2" });
  });

  it("the reaper's list also has the boxes a dead turn left running, once they are old", async () => {
    await saveProjectSandbox(row(PROJECT, { state: "running", pausedAt: null }));
    await holdProjectSandbox(PROJECT, "dead-turn");
    await db.execute(sql`update "projectSandboxes" set "updatedAt" = now() - interval '10 days' where "projectId" = ${PROJECT}`);
    await saveProjectSandbox(row(OTHER, { state: "running", pausedAt: null }));
    await holdProjectSandbox(OTHER, "live-turn");
    const old = await idleBefore(new Date(Date.now() - 7 * 86_400_000));
    expect(old.filter((b) => b.projectId.startsWith("test-sandbox"))).toEqual([{ projectId: PROJECT, sandboxId: `sbx-${PROJECT}`, pausedAt: null }]);
  });

  it("with heldBy, forgets the row only while that one holds it", async () => {
    await saveProjectSandbox(row(PROJECT, { pausedAt: new Date("2026-10-10T00:00:00Z") }));
    expect(await holdProjectSandbox(PROJECT, "turn-1")).toBe(true);
    await forgetProjectSandbox(PROJECT, "reaper-1");
    expect(await getProjectSandbox(PROJECT)).toMatchObject({ heldBy: "turn-1" });
    await releaseProjectSandbox(PROJECT, "turn-1");
    expect(await holdProjectSandbox(PROJECT, "reaper-1")).toBe(true);
    await forgetProjectSandbox(PROJECT, "reaper-1");
    expect(await getProjectSandbox(PROJECT)).toBeNull();
  });
});

describe("spentTodayMicroUsd", () => {
  it("sums today's sandbox cost from the ledger and nothing else", async () => {
    const from = new Date(Date.UTC(2030, 0, 1));
    await db.execute(sql`insert into "creditLedger" ("id","userId","plan","surface","centicredits","costMicroUsd","createdAt") values
      ('l1', ${OWNER}, 'pro', 'sandbox', 28, 2760, ${new Date(Date.UTC(2030, 0, 1, 5))}),
      ('l2', ${OWNER}, 'pro', 'sandbox', 28, 2760, ${new Date(Date.UTC(2029, 11, 31, 23))}),
      ('l3', ${OWNER}, 'pro', 'agent_turn', 300, 9000, ${new Date(Date.UTC(2030, 0, 1, 6))})`);
    expect(await spentTodayMicroUsd(from)).toBe(2760);
  });

  it("adds what the boxes running right now have spent since their turn took them (a dead turn's doesn't count)", async () => {
    const from = new Date(Date.now() - 3_600_000);
    const ledgerOnly = await spentTodayMicroUsd(from);
    await saveProjectSandbox(row(PROJECT, { state: "running", pausedAt: null }));
    await holdProjectSandbox(PROJECT, "live-turn");
    await db.execute(sql`update "projectSandboxes" set "updatedAt" = now() - interval '100 seconds' where "projectId" = ${PROJECT}`);
    await saveProjectSandbox(row(OTHER, { state: "running", pausedAt: null }));
    await holdProjectSandbox(OTHER, "dead-turn");
    await db.execute(sql`update "projectSandboxes" set "updatedAt" = now() - interval '3 hours' where "projectId" = ${OTHER}`);
    const spent = (await spentTodayMicroUsd(from)) - ledgerOnly;
    expect(spent).toBeGreaterThanOrEqual(Math.floor(100 * SANDBOX_USD_PER_SECOND * 1e6));
    expect(spent).toBeLessThan(Math.ceil(110 * SANDBOX_USD_PER_SECOND * 1e6));
  });
});
