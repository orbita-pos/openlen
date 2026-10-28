// @vitest-environment node
//
// The holds a dead process left, against Postgres semantics (PGlite): store.pg.test.ts needs the local
// database, and what matters here is the SQL — the reaper's prefix and the database's own clock.
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

const { REAPER_HOLD_PREFIX, getProjectSandbox, holdProjectSandbox, releaseHoldsFromBeforeBoot } = await import("./store");

let pg: PGlite;

beforeEach(async () => {
  pg = new PGlite();
  // The columns of scripts/sandbox-migrate.ts (without the reference to "projects").
  await pg.exec(`
    create table "projectSandboxes" (
      "projectId" text primary key, "sandboxId" text, "template" text, "state" text not null default 'none',
      "syncedManifest" jsonb not null default '{}'::jsonb, "heldBy" text, "pausedAt" timestamp with time zone,
      "updatedAt" timestamp with time zone not null default now());
  `);
  base.db = drizzle(pg, { schema });
});

async function box(projectId: string, heldBy: string | null, minutesAgo: number) {
  await pg.query(
    `insert into "projectSandboxes" ("projectId", "sandboxId", "state", "heldBy", "updatedAt")
     values ($1, $2, 'running', $3, now() - ($4::int * interval '1 minute'))`,
    [projectId, `sbx-${projectId}`, heldBy, minutesAgo],
  );
}

describe("releasing at boot the boxes a dead process held", () => {
  it("🔴 a dead turn's hold is released at once; the reaper's, a hold from after boot and a free box are not touched", async () => {
    await box("dead", "turn-of-the-old-process", 10);
    await box("reaper", `${REAPER_HOLD_PREFIX}1234`, 10);
    await box("alive", "turn-after-boot", 0);
    await box("free", null, 10);
    // This process booted 60 s ago.
    expect(await releaseHoldsFromBeforeBoot(60)).toBe(1);
    expect((await getProjectSandbox("dead"))?.heldBy).toBeNull();
    expect((await getProjectSandbox("reaper"))?.heldBy).toBe(`${REAPER_HOLD_PREFIX}1234`);
    expect((await getProjectSandbox("alive"))?.heldBy).toBe("turn-after-boot");
    expect((await getProjectSandbox("free"))?.heldBy).toBeNull();
    // What matters: the project's next turn gets its box now, not in two hours (STALE_HOLD).
    expect(await holdProjectSandbox("dead", "next-turn")).toBe(true);
    // The box itself is kept: the next turn resumes it like after a stale hold.
    expect(await getProjectSandbox("dead")).toMatchObject({ sandboxId: "sbx-dead", state: "running", heldBy: "next-turn" });
  });

  it("control arm: without the release, the dead turn's hold keeps the next turn out", async () => {
    await box("dead", "turn-of-the-old-process", 10);
    expect(await holdProjectSandbox("dead", "next-turn")).toBe(false);
  });
});
