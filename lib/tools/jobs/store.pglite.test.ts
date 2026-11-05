// @vitest-environment node
//
// A TOOL'S JOBS (spec local 2026-11-04-herramientas-hechas-por-len, §4.6) against real Postgres (PGlite), with the
// tables exactly as `npm run tools:migrate` creates them. DeepSeek's job registry (packages/jobs/jobs, at fcc0ad4621,
// MIT): a `job-<16 hex>` id, an owner, `running → stopping → completed | killed | failed` decided once — first wins.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

const base = vi.hoisted(() => ({ db: null as unknown, pg: null as unknown }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return base.db;
    },
  };
});

const { CREATE_TOOLS } = await import("@/scripts/tools-migrate-sql");
const store = await import("./store");
const { newJobId } = await import("./types");

const start = (over: Partial<Parameters<typeof store.insertJob>[0]> = {}) =>
  store.insertJob({
    id: newJobId(),
    personId: "u1",
    toolProjectId: "p1",
    installationId: "inst-1",
    releaseSha: "sha-1",
    name: "pdf",
    title: "Hacer el PDF",
    input: { photos: 2 },
    uploads: [{ id: "up-1", name: "a.jpg", size: 10 }],
    ...over,
  });

beforeEach(async () => {
  const db = new PGlite();
  await db.query(`CREATE TABLE "users" ("id" text PRIMARY KEY);`);
  await db.query(`CREATE TABLE "projects" ("id" text PRIMARY KEY);`);
  await db.query(`INSERT INTO "users" VALUES ('u1'), ('u2');`);
  await db.query(`INSERT INTO "projects" VALUES ('p1'), ('p2');`);
  for (const statement of [...CREATE_TOOLS, ...CREATE_TOOLS]) await db.query(statement);
  base.pg = db;
  base.db = drizzle(db, { schema });
});

describe("tool jobs", () => {
  it("an id is DeepSeek's: job- and 16 lowercase hex", () => {
    expect(newJobId()).toMatch(/^job-[0-9a-f]{16}$/);
    expect(newJobId()).not.toBe(newJobId());
  });

  it("a job starts running, and settles once: the second settlement changes nothing", async () => {
    const job = await start();
    expect(job.status).toBe("running");
    const first = await store.settleJob(job.id, "completed", { result: { pages: 2 }, seconds: 12, chargedCentis: 6 });
    expect(first).toMatchObject({ status: "completed", seconds: 12, chargedCentis: 6 });
    expect(first?.finishedAt).toBeInstanceOf(Date);
    expect(await store.settleJob(job.id, "failed", { detail: "late" })).toBeNull();
    expect(await store.jobById(job.id)).toMatchObject({ status: "completed", detail: null, result: { pages: 2 } });
  });

  it("cancel asks a running job to stop, only from running; a stopping job still settles", async () => {
    const job = await start();
    expect((await store.requestCancel(job.id))?.status).toBe("stopping");
    expect(await store.requestCancel(job.id)).toBeNull();
    expect((await store.settleJob(job.id, "killed", { detail: "cancelled" }))?.status).toBe("killed");
    expect(await store.requestCancel(job.id)).toBeNull();
  });

  it("progress moves while it works, and not after it settled", async () => {
    const job = await start();
    await store.setProgress(job.id, "2 of 5 photos");
    expect((await store.jobById(job.id))?.progress).toBe("2 of 5 photos");
    await store.settleJob(job.id, "completed", {});
    await store.setProgress(job.id, "late");
    expect((await store.jobById(job.id))?.progress).toBe("2 of 5 photos");
  });

  it("a person's jobs of one tool, newest first; never another person's", async () => {
    const a = await start();
    const b = await start({ name: "zip", title: "Comprimir" });
    await start({ personId: "u2" });
    await start({ toolProjectId: "p2" });
    await base.pg && (base.pg as PGlite).query(`UPDATE "toolJobs" SET "startedAt" = now() - interval '1 minute' WHERE "id" = '${a.id}'`);
    expect((await store.jobsOf("u1", "p1", 10)).map((j) => j.id)).toEqual([b.id, a.id]);
  });

  it("the running ones, for a restart", async () => {
    const a = await start();
    const b = await start();
    const c = await start();
    await store.requestCancel(b.id);
    await store.settleJob(c.id, "failed", { detail: "x" });
    expect((await store.runningJobs()).map((j) => j.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("the view the tool reads carries no input, no uploads and no owner", async () => {
    const job = await start();
    const view = store.toJobView((await store.settleJob(job.id, "completed", { delivered: [{ name: "fotos.pdf", url: "/x", size: 99 }] }))!);
    expect(view).toMatchObject({ id: job.id, name: "pdf", title: "Hacer el PDF", status: "completed", delivered: [{ name: "fotos.pdf", url: "/x", size: 99 }] });
    expect(view).not.toHaveProperty("input");
    expect(view).not.toHaveProperty("uploads");
    expect(view).not.toHaveProperty("personId");
    expect(typeof view.startedAt).toBe("string");
  });
});
