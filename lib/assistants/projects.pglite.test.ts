// @vitest-environment node
//
// ONE ASSISTANT, SEVERAL PROJECTS (spec local 2026-11-06-asistente-propio, §4.5): she is her person's and serves one or
// more of their projects — one assistant per project —; she can be taken off one; and her home (where her conversation
// with her owner lives) moves with her when it goes. Against real Postgres (PGlite), with the tables as
// `npm run assistants:migrate` creates them, and the real deleteProject.
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
// What deleteProject touches outside the database: the page's own databases, the box, the published folder.
vi.mock("@/lib/backend/teardown", () => ({ pageDatabaseScopes: async () => null, dropPageDatabases: async () => {} }));
vi.mock("@/lib/agent/sandbox/reaper", () => ({ sandboxOfProject: async () => null, killSandboxOfDeletedProject: async () => {} }));
vi.mock("@/lib/publish/filesystem", async (orig) => ({ ...(await orig<object>()), unpublishDir: async () => {} }));
vi.mock("@/lib/publish/cache-purge", () => ({ purgeSubdomain: async () => {} }));

const { CREATE_ASSISTANTS } = await import("@/scripts/assistants-migrate-sql");
const { createAssistant, assistantById } = await import("./store");
const projects = await import("./projects");
const { deleteProject, unpublishProject } = await import("@/lib/projects");
const { saveKnowledge, setOnPage } = await import("./visitor/store");
const { saveVisit } = await import("./visitor/store");
const { noteRequest } = await import("./requests/store");

const NOW = new Date("2026-11-09T12:00:00Z");
let pg: PGlite;
let lucia: string;

const herRows = async (projectId: string) =>
  (await pg.query<{ id: string }>(`select "id" from "projectChatMessages" where "projectId" = $1 and "conversation" = $2 order by "id"`, [projectId, `assistant:${lucia}`])).rows.map((r) => r.id);

beforeEach(async () => {
  pg = new PGlite();
  await pg.query(`create table "users" ("id" text primary key)`);
  await pg.query(
    `create table "projects" ("id" text primary key, "userId" text, "title" text, "subdomain" text, "data" jsonb, "updatedAt" timestamp, "status" text, "publishedAt" timestamp, "publishedHtml" text, "publishedPagesHash" text, "publishedFilesHash" text, "publishedEnvHash" text, "publishedReleaseSha" text, "deployUrl" text)`,
  );
  await pg.query(`create table "projectChatMessages" ("id" text primary key, "projectId" text not null references "projects"("id") on delete cascade, "conversation" text, "status" text)`);
  await pg.query(`insert into "users" values ('u1'), ('u2')`);
  await pg.query(
    `insert into "projects" ("id", "userId", "title", "subdomain") values ('p1', 'u1', 'Pastelería Canela', 'canela'), ('p2', 'u1', 'Canela Tienda', 'canela-tienda'), ('p3', 'u1', 'Canela Reservas', null), ('p4', 'u1', 'Otra', 'otra')`,
  );
  for (const statement of CREATE_ASSISTANTS) await pg.query(statement);
  base.db = drizzle(pg, { schema });
  const r = await createAssistant({ personId: "u1", projectId: "p1", input: { name: "Lucía", look: { v: 1, shape: "drop", color: "#f4a48b", eyes: "oval", eyewear: "none", accessory: "none" }, tone: "friendly" } });
  if (!r.ok) throw new Error("setup");
  lucia = r.assistant.id;
  // Her conversation with her owner, and one of Len's rows in the same project.
  await pg.query(`insert into "projectChatMessages" values ('m1', 'p1', $1), ('m2', 'p1', $1), ('len1', 'p1', null)`, [`assistant:${lucia}`]);
});

describe("her projects", () => {
  it("🔴 a project has one assistant: connecting another is refused, also two at once", async () => {
    const bruno = await createAssistant({ personId: "u1", projectId: "p4", input: { name: "Bruno", look: { v: 1, shape: "drop", color: "#88aaff", eyes: "oval", eyewear: "none", accessory: "none" }, tone: "formal" } });
    if (!bruno.ok) throw new Error("setup");
    const both = await Promise.all([projects.connectProject({ assistantId: lucia, projectId: "p3" }), projects.connectProject({ assistantId: bruno.assistant.id, projectId: "p3" })]);
    expect([...both].sort()).toEqual(["connected", "project_has_assistant"]);
    expect(await projects.connectProject({ assistantId: lucia, projectId: "p4" })).toBe("project_has_assistant");
  });

  it("her projects: home first, then in the order she joined them, with title and address", async () => {
    expect(await projects.connectProject({ assistantId: lucia, projectId: "p3" })).toBe("connected");
    expect(await projects.connectProject({ assistantId: lucia, projectId: "p2" })).toBe("connected");
    const served = await projects.projectsOfAssistant(lucia);
    expect(served.map((p) => [p.projectId, p.title, p.subdomain, p.isHome, p.onPage])).toEqual([
      ["p1", "Pastelería Canela", "canela", true, false],
      ["p3", "Canela Reservas", null, false, false],
      ["p2", "Canela Tienda", "canela-tienda", false, false],
    ]);
    expect(served[0]).toMatchObject({ knowledge: null, knowledgeAt: null, publicData: [] });
  });

  it("🔴 disconnecting her home moves her home and her conversation to her oldest other project", async () => {
    await projects.connectProject({ assistantId: lucia, projectId: "p3" });
    await projects.connectProject({ assistantId: lucia, projectId: "p2" });
    expect(await projects.disconnectProject(lucia, "p1")).toBe("disconnected");
    expect((await assistantById(lucia))!.homeProjectId).toBe("p3");
    expect(await herRows("p3")).toEqual(["m1", "m2"]);
    expect(await herRows("p1")).toEqual([]);
    // Len's rows never move.
    expect((await pg.query(`select "projectId" from "projectChatMessages" where "id" = 'len1'`)).rows).toEqual([{ projectId: "p1" }]);
    expect((await projects.projectsOfAssistant(lucia)).map((p) => [p.projectId, p.isHome])).toEqual([["p3", true], ["p2", false]]);
  });

  // Final review M1 (re-graded): the turn closes its row by the project it started in; moved mid-turn, it stayed
  // «en curso» for good in her new home.
  it("🔴 while she is answering, her home can't be taken from her; once she is done, it can", async () => {
    await projects.connectProject({ assistantId: lucia, projectId: "p2" });
    await pg.query(`update "projectChatMessages" set "status" = 'en_curso' where "id" = 'm2'`);
    expect(await projects.disconnectProject(lucia, "p1")).toBe("busy");
    expect((await assistantById(lucia))!.homeProjectId).toBe("p1");
    // Len's own turn running in the project is not hers: it doesn't hold her.
    await pg.query(`update "projectChatMessages" set "status" = 'done' where "id" = 'm2'`);
    await pg.query(`update "projectChatMessages" set "status" = 'en_curso' where "id" = 'len1'`);
    expect(await projects.disconnectProject(lucia, "p1")).toBe("disconnected");
  });

  it("her only project can't be disconnected", async () => {
    expect(await projects.disconnectProject(lucia, "p1")).toBe("only_project");
    expect(await projects.disconnectProject(lucia, "p2")).toBe("not_connected");
    expect((await projects.projectsOfAssistant(lucia)).map((p) => p.projectId)).toEqual(["p1"]);
  });

  it("disconnecting keeps her visits and requests of that project", async () => {
    await projects.connectProject({ assistantId: lucia, projectId: "p2" });
    await saveVisit({ assistantId: lucia, projectId: "p2", visitorId: "vid-aaaaaaaaaaaaaaaa", transcript: [], newLines: [{ role: "visitor", text: "hola", at: NOW.toISOString() }], centicredits: 1, handedOff: false, at: NOW });
    await noteRequest({ assistantId: lucia, projectId: "p2", visitorId: "vid-aaaaaaaaaaaaaaaa", text: "¿envíos?", locale: "es", at: NOW });
    expect(await projects.disconnectProject(lucia, "p2")).toBe("disconnected");
    expect((await pg.query(`select 1 from "assistantVisits" where "projectId" = 'p2'`)).rows).toHaveLength(1);
    expect((await pg.query(`select 1 from "assistantRequests" where "projectId" = 'p2'`)).rows).toHaveLength(1);
  });
});

// Final review I1: an unpublished project kept feeding her — to other pages' visitors and to her owner.
describe("when a project she serves is unpublished", () => {
  it("🔴 she forgets what it published, and her bubble there", async () => {
    await projects.connectProject({ assistantId: lucia, projectId: "p2" });
    await setOnPage("p2", lucia, true);
    await saveKnowledge("p2", "Envíos a domicilio.", NOW, [{ name: "huecos", columns: [] }], { baked: true });
    await unpublishProject({ projectId: "p2", userId: "u1" });
    const shop = (await projects.projectsOfAssistant(lucia)).find((p) => p.projectId === "p2")!;
    expect(shop).toMatchObject({ knowledge: null, knowledgeAt: null, bakedAt: null, publicData: [] });
    // Still hers, still on: the next publish bakes her bubble again.
    expect(shop.onPage).toBe(true);
  });
});

describe("when her home project is deleted", () => {
  it("🔴 deleting her home project keeps her, with her conversation, in her other project", async () => {
    await projects.connectProject({ assistantId: lucia, projectId: "p2" });
    expect(await deleteProject("p1", "u1")).toBe(true);
    const her = await assistantById(lucia);
    expect(her?.homeProjectId).toBe("p2");
    expect(await herRows("p2")).toEqual(["m1", "m2"]);
    expect((await projects.projectsOfAssistant(lucia)).map((p) => p.projectId)).toEqual(["p2"]);
  });

  it("deleting her only project deletes her, as before", async () => {
    expect(await projects.rehomeAssistantsOf("p1")).toBe(0);
    expect(await deleteProject("p1", "u1")).toBe(true);
    expect(await assistantById(lucia)).toBeNull();
  });

  it("someone else deleting nothing moves nothing", async () => {
    await projects.connectProject({ assistantId: lucia, projectId: "p2" });
    expect(await deleteProject("p1", "u2")).toBe(false);
    expect((await assistantById(lucia))!.homeProjectId).toBe("p1");
    expect(await herRows("p1")).toEqual(["m1", "m2"]);
  });
});
