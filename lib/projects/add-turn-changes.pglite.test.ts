// @vitest-environment node
//
// Len's subagents (spec local 2026-11-01-subagentes-de-len, §4.8): a child's changes join the launching turn's
// undo, against real Postgres (PGlite) with `projectTurnChanges` as scripts/turn-changes-migrate.ts creates it.
// (Not the .pg test: DATABASE_URL in .env.local is production.)
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

const { addChangesToTurn, guardarCambiosDelTurno } = await import("./deshacer-turno");

const rows = async () =>
  ((await (base.pg as PGlite).query(`SELECT "path", "contentBefore", "contentAfter", "undoable" FROM "projectTurnChanges" WHERE "turnId" = 't1' ORDER BY "path"`)).rows) as {
    path: string;
    contentBefore: string | null;
    contentAfter: string | null;
    undoable: boolean;
  }[];

beforeEach(async () => {
  const pg = new PGlite();
  await pg.query(`CREATE TABLE "projects" ("id" text PRIMARY KEY)`);
  await pg.query(`INSERT INTO "projects" VALUES ('p1')`);
  await pg.query(`CREATE TABLE "projectTurnChanges" (
    "id" text PRIMARY KEY, "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE, "turnId" text NOT NULL,
    "path" text NOT NULL, "contentBefore" text, "contentAfter" text, "undoable" boolean NOT NULL, "undoneAt" timestamp,
    "createdAt" timestamp NOT NULL DEFAULT now())`);
  base.pg = pg;
  base.db = drizzle(pg, { schema });
});

describe("addChangesToTurn", () => {
  it("a child's later change joins the turn: before from the turn, after from the child", async () => {
    await guardarCambiosDelTurno("p1", "t1", [{ ruta: "/index.html", antes: "A", despues: "B", deshacible: true }]);
    expect(await addChangesToTurn("p1", "t1", [{ ruta: "/index.html", antes: "B", despues: "C", deshacible: true }, { ruta: "/menu/index.html", antes: null, despues: "M", deshacible: true }])).toBe(true);
    expect(await rows()).toEqual([
      { path: "/index.html", contentBefore: "A", contentAfter: "C", undoable: true },
      { path: "/menu/index.html", contentBefore: null, contentAfter: "M", undoable: true },
    ]);
  });

  it("a turn that saved nothing gets the child's changes", async () => {
    expect(await addChangesToTurn("p1", "t1", [{ ruta: "/index.html", antes: "A", despues: "B", deshacible: true }])).toBe(true);
    expect(await rows()).toEqual([{ path: "/index.html", contentBefore: "A", contentAfter: "B", undoable: true }]);
  });

  it("a child that put everything back leaves nothing to undo", async () => {
    await guardarCambiosDelTurno("p1", "t1", [{ ruta: "/index.html", antes: "A", despues: "B", deshacible: true }]);
    expect(await addChangesToTurn("p1", "t1", [{ ruta: "/index.html", antes: "B", despues: "A", deshacible: true }])).toBe(false);
    expect(await rows()).toEqual([]);
  });
});
