// @vitest-environment node
//
// A TOOL IS INSTALLED, NOT PUBLISHED (spec local 2026-11-04-herramientas-hechas-por-len, §4.2), at the bottom door:
// `publishProject` reads the project and refuses one born as a tool before it claims an address or writes anything —
// whoever calls it (the route, MCP, Len Watch).
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

vi.mock("server-only", () => ({}));
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

const { publishProject } = await import("@/lib/projects");
const { ProjectIsToolError } = await import("@/lib/tools/errors");

beforeEach(async () => {
  const db = new PGlite();
  await db.query(`CREATE TABLE "projects" ("id" text PRIMARY KEY, "userId" text NOT NULL, "title" text, "data" jsonb, "subdomain" text, "logoUrl" text);`);
  await db.query(`INSERT INTO "projects" VALUES ('t1', 'u1', 'Reservas', '{"html": "<div id=\\"root\\"></div>", "tool": {"bornAt": "2026-11-04T00:00:00Z"}}', null, null);`);
  base.db = drizzle(db, { schema });
});

describe("publishProject", () => {
  it("refuses a tool project, and nothing is claimed", async () => {
    await expect(publishProject({ projectId: "t1", userId: "u1", subdomain: "reservas" })).rejects.toBeInstanceOf(ProjectIsToolError);
    const [row] = await (base.db as ReturnType<typeof drizzle>).select({ subdomain: schema.projects.subdomain }).from(schema.projects);
    expect(row?.subdomain).toBeNull();
  });
});
