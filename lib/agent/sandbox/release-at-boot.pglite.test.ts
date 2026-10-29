// @vitest-environment node
//
// The holds a dead process left, against Postgres semantics (PGlite): store.pg.test.ts needs the local
// database, and what matters here is the SQL — the reaper's prefix, the database's own clock, the boot's own
// hold while it pauses the box, and the seconds and owner of the charge.
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

const { REAPER_HOLD_PREFIX, getProjectSandbox, holdProjectSandbox, releasePausedBox, takeOverHoldsFromBeforeBoot } = await import("./store");

let pg: PGlite;

beforeEach(async () => {
  pg = new PGlite();
  // The columns of scripts/sandbox-migrate.ts (without the reference to "projects"), and of "projects" only its owner.
  await pg.exec(`
    create table "projects" ("id" text primary key, "userId" text not null);
    create table "projectSandboxes" (
      "projectId" text primary key, "sandboxId" text, "template" text, "state" text not null default 'none',
      "syncedManifest" jsonb not null default '{}'::jsonb, "heldBy" text, "pausedAt" timestamp with time zone,
      "updatedAt" timestamp with time zone not null default now());
  `);
  base.db = drizzle(pg, { schema });
});

async function box(projectId: string, heldBy: string | null, minutesAgo: number, o: { state?: string; owner?: string | null } = {}) {
  if (o.owner !== null) await pg.query(`insert into "projects" ("id", "userId") values ($1, $2)`, [projectId, o.owner ?? `owner-${projectId}`]);
  await pg.query(
    `insert into "projectSandboxes" ("projectId", "sandboxId", "state", "heldBy", "updatedAt")
     values ($1, $2, $3, $4, now() - ($5::int * interval '1 minute'))`,
    [projectId, `sbx-${projectId}`, o.state ?? "running", heldBy, minutesAgo],
  );
}

describe("taking over at boot the boxes a dead process held", () => {
  it("🔴 a dead turn's hold passes to the boot's at once; the reaper's, a hold from after boot and a free box are not touched", async () => {
    await box("dead", "turn-of-the-old-process", 10);
    await box("reaper", `${REAPER_HOLD_PREFIX}1234`, 10);
    await box("alive", "turn-after-boot", 0);
    await box("free", null, 10);
    // This process booted 60 s ago.
    const dead = await takeOverHoldsFromBeforeBoot(60, "boot-1");
    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({ projectId: "dead", sandboxId: "sbx-dead", turnId: "turn-of-the-old-process", ownerId: "owner-dead" });
    // It ran from when the turn opened it (10 min ago) until this boot (1 min ago): 9 minutes.
    expect(dead[0]!.secondsRun).toBeGreaterThan(9 * 60 - 2);
    expect(dead[0]!.secondsRun).toBeLessThan(9 * 60 + 2);
    expect((await getProjectSandbox("dead"))?.heldBy).toBe("boot-1");
    expect((await getProjectSandbox("reaper"))?.heldBy).toBe(`${REAPER_HOLD_PREFIX}1234`);
    expect((await getProjectSandbox("alive"))?.heldBy).toBe("turn-after-boot");
    expect((await getProjectSandbox("free"))?.heldBy).toBeNull();
    // While the boot pauses it, no turn resumes it...
    expect(await holdProjectSandbox("dead", "next-turn")).toBe(false);
    // ...and once paused and let go, the project's next turn gets it now, not in two hours (STALE_HOLD).
    await releasePausedBox("dead", "boot-1");
    expect(await getProjectSandbox("dead")).toMatchObject({ sandboxId: "sbx-dead", state: "paused", heldBy: null });
    expect((await getProjectSandbox("dead"))?.pausedAt).toBeInstanceOf(Date);
    expect(await holdProjectSandbox("dead", "next-turn")).toBe(true);
  });

  it("a turn that died before its box ran charges nothing; a project that is gone has no owner", async () => {
    await box("opening", "turn-a", 10, { state: "paused" });
    await box("deleted", "turn-b", 10, { owner: null });
    const dead = await takeOverHoldsFromBeforeBoot(60, "boot-1");
    const by = new Map(dead.map((d) => [d.projectId, d]));
    expect(by.get("opening")).toMatchObject({ secondsRun: 0, ownerId: "owner-opening" });
    expect(by.get("deleted")).toMatchObject({ ownerId: null });
    expect(by.get("deleted")!.secondsRun).toBeGreaterThan(0);
  });

  it("releasePausedBox only lets go while the boot's own hold has it", async () => {
    await box("p", "next-turn", 0);
    await releasePausedBox("p", "boot-1");
    expect(await getProjectSandbox("p")).toMatchObject({ state: "running", heldBy: "next-turn" });
  });

  it("control arm: without the takeover, the dead turn's hold keeps the next turn out", async () => {
    await box("dead", "turn-of-the-old-process", 10);
    expect(await holdProjectSandbox("dead", "next-turn")).toBe(false);
  });
});
