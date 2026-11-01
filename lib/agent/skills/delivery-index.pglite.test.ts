// @vitest-environment node
//
// The index of what Len delivered (spec local 2026-10-31-len-movil, §5.3), against real Postgres
// (PGlite) with the table exactly as `scripts/delivered-files-migrate.ts` creates it.
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

const { CREATE_DELIVERED_FILES } = await import("@/scripts/delivered-files-migrate-sql");
const { deliveriesBetween, indexDeliveries, listDeliveries } = await import("./delivery-index");

const file = (n: string, over: Record<string, unknown> = {}) => ({
  name: `${n}.pdf`,
  url: `/api/projects/p1/deliveries/t1/ab12cd34-${n}.pdf`,
  size: 10,
  ...over,
});

beforeEach(async () => {
  const pg = new PGlite();
  await pg.query(`CREATE TABLE "projects" ("id" text PRIMARY KEY);`);
  await pg.query(`INSERT INTO "projects" VALUES ('p1'), ('p2'), ('p3');`);
  for (const statement of CREATE_DELIVERED_FILES) await pg.query(statement);
  base.pg = pg;
  base.db = drizzle(pg, { schema });
});

describe("delivery index", () => {
  it("lists the asked projects' files, newest first", async () => {
    await indexDeliveries("p1", "t1", [file("a", { description: "Informe", preview: "/api/projects/p1/deliveries/t1/ef56ab78-a.pdf.preview.pdf" })]);
    await new Promise((r) => setTimeout(r, 5));
    await indexDeliveries("p2", "t9", [file("b", { url: "/api/projects/p2/deliveries/t9/ab12cd34-b.pdf" })]);
    await indexDeliveries("p3", "t3", [file("c", { url: "/api/projects/p3/deliveries/t3/ab12cd34-c.pdf" })]);
    const rows = await listDeliveries(["p1", "p2"], 50);
    expect(rows.map((r) => r.name)).toEqual(["b.pdf", "a.pdf"]);
    expect(rows[1]).toMatchObject({ projectId: "p1", turnId: "t1", size: 10, description: "Informe", previewUrl: "/api/projects/p1/deliveries/t1/ef56ab78-a.pdf.preview.pdf", contentType: "application/pdf" });
  });

  it("indexing the same file twice keeps one row", async () => {
    await indexDeliveries("p1", "t1", [file("a")]);
    await indexDeliveries("p1", "t1", [file("a")]);
    expect(await listDeliveries(["p1"], 50)).toHaveLength(1);
  });

  it("respects the limit, and no projects lists nothing", async () => {
    await indexDeliveries("p1", "t1", [file("a"), file("b"), file("c")]);
    expect(await listDeliveries(["p1"], 2)).toHaveLength(2);
    expect(await listDeliveries([], 50)).toEqual([]);
  });

  it("between two instants: only that project's files of that window, oldest first", async () => {
    const before = new Date(Date.now() - 1000);
    await indexDeliveries("p1", "t1", [file("a")]);
    await new Promise((r) => setTimeout(r, 5));
    await indexDeliveries("p1", "t1", [file("b")]);
    await indexDeliveries("p2", "t9", [file("x", { url: "/api/projects/p2/deliveries/t9/ab12cd34-x.pdf" })]);
    const after = new Date(Date.now() + 1000);
    expect((await deliveriesBetween("p1", before, after)).map((r) => r.name)).toEqual(["a.pdf", "b.pdf"]);
    expect(await deliveriesBetween("p1", after, new Date(after.getTime() + 1000))).toEqual([]);
  });

  it("deleting the project deletes its rows", async () => {
    await indexDeliveries("p1", "t1", [file("a")]);
    await (base.pg as PGlite).query(`DELETE FROM "projects" WHERE id = 'p1'`);
    expect(await listDeliveries(["p1"], 50)).toEqual([]);
  });
});
