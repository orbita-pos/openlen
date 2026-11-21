// @vitest-environment node
//
// WHAT A SPACE CAN NEVER DO (spec local 2026-11-19-agentes-para-todos, §6.2): it is never published, never converted
// into an app, never shared with members or through a preview link, never copied as a space, and never deleted while
// an agent lives in it. Against real Postgres (PGlite), with the real functions behind each door.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

const base = vi.hoisted(() => ({ db: null as unknown, userId: "u1" }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return base.db;
    },
  };
});
// What deleteProject touches outside the database: the page's own databases, the box, the published folder.
vi.mock("@/lib/backend/teardown", () => ({ pageDatabaseScopes: async () => null, dropPageDatabases: async () => {} }));
vi.mock("@/lib/agent/sandbox/reaper", () => ({ sandboxOfProject: async () => null, killSandboxOfDeletedProject: async () => {} }));
vi.mock("@/lib/publish/filesystem", async (orig) => ({ ...(await orig<object>()), unpublishDir: async () => {} }));
vi.mock("@/lib/publish/cache-purge", () => ({ purgeSubdomain: async () => {} }));
// The preview route's caller and access: the owner.
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: async () => base.userId }));
vi.mock("@/lib/projects/acceso", async (orig) => ({ ...(await orig<object>()), exigirAcceso: async () => ({ rol: "dueno", duenoId: base.userId }) }));
// A step deleteProject takes between its first look and the delete: where a test puts what happens meanwhile.
const meanwhile = vi.hoisted(() => ({ run: null as null | (() => Promise<void>) }));
vi.mock("@/lib/assistants/projects", async (orig) => {
  const real = await orig<typeof import("@/lib/assistants/projects")>();
  return { ...real, rehomeAssistantsOf: async (id: string) => (await meanwhile.run?.(), real.rehomeAssistantsOf(id)) };
});

const { CREATE_ASSISTANTS, CREATE_SPACE } = await import("@/scripts/assistants-migrate-sql");
const { ensureSpace } = await import("./store");
const { tableSql } = await import("./test-helpers");
const { ProjectIsSpaceError, SpaceHasAgentsError } = await import("./errors");
const { publishProject, duplicateProject, deleteProject } = await import("@/lib/projects");
const { invitar } = await import("@/lib/projects/miembros");
const { toolConvertirEnApp } = await import("@/lib/agent/convertir-en-app");
const preview = await import("@/app/api/projects/[id]/preview/route");

let pg: PGlite;
let space: string;

beforeEach(async () => {
  pg = new PGlite();
  for (const t of [schema.users, schema.projects, schema.projectChatMessages, schema.projectMembers, schema.projectInvites, schema.projectEnvVars, schema.projectFiles])
    await pg.query(tableSql(t));
  await pg.query(`insert into "users" ("id", "email") values ('u1', 'ana@example.com')`);
  for (const statement of [...CREATE_ASSISTANTS, ...CREATE_SPACE]) await pg.query(statement);
  base.db = drizzle(pg, { schema });
  space = await ensureSpace("u1");
});

const row = async (id: string) => (await pg.query<{ subdomain: string | null; data: Record<string, unknown> }>(`select "subdomain", "data" from "projects" where "id" = $1`, [id])).rows[0];

describe("a space never publishes", () => {
  it("publishProject on the space throws ProjectIsSpaceError before claiming an address", async () => {
    await expect(publishProject({ projectId: space, userId: "u1", subdomain: "ana" } as Parameters<typeof publishProject>[0])).rejects.toBeInstanceOf(ProjectIsSpaceError);
    expect((await row(space))?.subdomain).toBeNull();
  });
});

describe("a space never becomes an app", () => {
  it("convert_to_app in the space is refused and writes nothing", async () => {
    const projectFiles = vi.fn(async () => ({}));
    const out = await toolConvertirEnApp(
      { projectId: space, userId: "u1" } as Parameters<typeof toolConvertirEnApp>[0],
      { loadProject: async () => ({ data: { html: "", space: { bornAt: "2026-11-19T00:00:00.000Z" } } }), projectFiles } as unknown as Parameters<typeof toolConvertirEnApp>[1],
    );
    expect(out.response).toMatchObject({ ok: false });
    expect(String((out.response as { error?: string }).error)).toMatch(/space/i);
    expect(projectFiles).not.toHaveBeenCalled();
  });
});

describe("a space is never shared", () => {
  it("invitar on the space is refused and no invite is stored", async () => {
    expect(await invitar(space, "u1", "bea@example.com", "editor")).toEqual({ ok: false, motivo: "space_is_private" });
    expect((await pg.query(`select 1 from "projectInvites"`)).rows).toHaveLength(0);
  });

  it("a preview link for the space is refused with 409 space_is_private", async () => {
    const res = await preview.POST(new Request("http://x/api/projects/x/preview", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: space }) });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "space_is_private" });
    expect((await row(space))?.data.preview).toBeUndefined();
  });
});

describe("copying and deleting a space", () => {
  it("duplicating the space copies no space marker", async () => {
    const copy = await duplicateProject(space, "u1");
    expect(copy).toBeTruthy();
    expect((await row(copy!))?.data.space).toBeUndefined();
  });

  it("deleting the space while an assistant lives there is refused and nothing is deleted", async () => {
    await pg.query(
      `insert into "assistants" ("id", "personId", "name", "slug", "shape", "color", "tone", "homeProjectId") values ('a1', 'u1', 'Mr. Smith', 'mr-smith', 'drop', '#3366ff', 'friendly', $1)`,
      [space],
    );
    await expect(deleteProject(space, "u1")).rejects.toBeInstanceOf(SpaceHasAgentsError);
    expect(await row(space)).toBeTruthy();
    expect((await pg.query(`select 1 from "assistants"`)).rows).toHaveLength(1);
  });

  // Delivery 1 deferred it: the agents were looked for before the delete, not with it — one created in between went
  // with the space in the cascade.
  it("🔴 an agent created while the space is being deleted stops the delete, and lives", async () => {
    meanwhile.run = async () => {
      await pg.query(
        `insert into "assistants" ("id", "personId", "name", "slug", "shape", "color", "tone", "homeProjectId") values ('a2', 'u1', 'Chef Rosa', 'chef-rosa', 'drop', '#3366ff', 'friendly', $1)`,
        [space],
      );
    };
    try {
      await expect(deleteProject(space, "u1")).rejects.toBeInstanceOf(SpaceHasAgentsError);
    } finally {
      meanwhile.run = null;
    }
    expect(await row(space)).toBeTruthy();
    expect((await pg.query(`select "id" from "assistants"`)).rows).toEqual([{ id: "a2" }]);
  });

  it("deleting an empty space is allowed", async () => {
    expect(await deleteProject(space, "u1")).toBe(true);
    expect(await row(space)).toBeUndefined();
  });
});
