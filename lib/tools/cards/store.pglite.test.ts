// @vitest-environment node
//
// «CREAR» CARDS (spec local 2026-11-04-herramientas-hechas-por-len, §4.10) against real Postgres (PGlite), with the
// tables exactly as `npm run tools:migrate` creates them. DeepSeek's action cards: a newer card replaces every
// unstarted one; a card is decided once; the model hears only what the person or the background work changed.
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

const pg = () => base.pg as PGlite;

const propose = (over: Partial<Parameters<typeof store.insertCard>[0]> = {}) =>
  store.insertCard({
    projectId: "p1",
    chatRowId: "row-1",
    personId: "u1",
    title: "Reservas de hoy",
    brief: "Ver las reservas del día y marcarlas al llegar.",
    initialContent: null,
    placement: "rail",
    ...over,
  });

beforeEach(async () => {
  const db = new PGlite();
  await db.query(`CREATE TABLE "users" ("id" text PRIMARY KEY);`);
  await db.query(`CREATE TABLE "projects" ("id" text PRIMARY KEY);`);
  await db.query(`INSERT INTO "users" VALUES ('u1'), ('u2');`);
  await db.query(`INSERT INTO "projects" VALUES ('p1'), ('p2'), ('tool');`);
  // Twice: the migration is idempotent.
  for (const statement of [...CREATE_TOOLS, ...CREATE_TOOLS]) await db.query(statement);
  base.pg = db;
  base.db = drizzle(db, { schema });
});

describe("«Crear» cards", () => {
  it("a new card is proposed; a newer one replaces the unstarted one, not one already creating", async () => {
    const first = await propose();
    expect(first.phase).toBe("proposed");
    const started = await propose({ chatRowId: "row-2" });
    await store.casPhase(started.id, ["proposed"], "creating");
    const third = await propose({ chatRowId: "row-3" });
    expect((await store.cardById(first.id))?.phase).toBe("replaced");
    expect((await store.cardById(started.id))?.phase).toBe("creating");
    expect((await store.cardById(third.id))?.phase).toBe("proposed");
  });

  it("replacement stays within the person's chat of that project", async () => {
    const mine = await propose();
    await propose({ personId: "u2", chatRowId: "row-9" });
    await propose({ projectId: "p2", chatRowId: "row-8" });
    expect((await store.cardById(mine.id))?.phase).toBe("proposed");
  });

  it("a card is decided once (compare-and-swap on its phase)", async () => {
    const card = await propose();
    const won = await store.casPhase(card.id, ["proposed"], "creating", { toolProjectId: "tool", hostRowId: "host-1" });
    expect(won?.phase).toBe("creating");
    expect(won?.toolProjectId).toBe("tool");
    expect(await store.casPhase(card.id, ["proposed"], "creating")).toBeNull();
  });

  it("the users column «Sugerencias de herramientas» exists and starts off", async () => {
    const r = await pg().query<{ toolSuggestions: boolean }>(`SELECT "toolSuggestions" FROM "users" WHERE id = 'u1'`);
    expect(r.rows[0]?.toolSuggestions).toBe(false);
  });

  it("Len hears only what changed after it was proposed, and only once", async () => {
    const card = await propose();
    expect(await store.undeliveredCards("p1", "u1")).toEqual([]);
    await store.casPhase(card.id, ["proposed"], "creating");
    const pending = await store.undeliveredCards("p1", "u1");
    expect(pending.map((c) => c.id)).toEqual([card.id]);
    await store.markDelivered([card.id], new Date(Date.now() + 1000));
    expect(await store.undeliveredCards("p1", "u1")).toEqual([]);
  });

  it("a replaced card is not news to Len (the model made that choice)", async () => {
    await propose();
    await propose({ chatRowId: "row-2" });
    expect(await store.undeliveredCards("p1", "u1")).toEqual([]);
  });

  it("the view Len and the client read", async () => {
    const card = await propose({ initialContent: "Mesa 4, 20:00" });
    expect(store.toCardView(card)).toEqual({
      id: card.id,
      chatRowId: "row-1",
      title: "Reservas de hoy",
      brief: "Ver las reservas del día y marcarlas al llegar.",
      initialContent: "Mesa 4, 20:00",
      placement: "rail",
      customLocation: null,
      phase: "proposed",
      toolProjectId: null,
      installationId: null,
      error: null,
      review: null,
    });
    expect((await store.cardsOfProject("p1", "u1")).map((c) => c.id)).toEqual([card.id]);
  });
});
