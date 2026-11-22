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
const { deleteProject, findOrCreateBlankProject, unpublishProject } = await import("@/lib/projects");
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
  // What moving her home touches of the scheduled tasks (spec local 2026-11-19-agentes-para-todos, §6.4).
  await pg.query(`create table "scheduledTasks" ("id" text primary key, "projectId" text not null references "projects"("id") on delete cascade, "assistantId" text)`);
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
  // 11/11/2026, Jesús («encendido de una»): she comes from Len's card, where the owner asked for an assistant for that
  // page — so she is born on it, and the next publish shows her. Creating her and «Usar a Lucía aquí» are the card's two
  // buttons, and its only ones. On is not baked: her bubble is there only after a publish with her.
  it("🔴 from Len's card she is on the page at once: created there, or used there", async () => {
    expect(await projects.connectProject({ assistantId: lucia, projectId: "p3" })).toBe("connected");
    const mine = await projects.projectsOfAssistant(lucia);
    expect(mine.map((p) => [p.projectId, p.onPage, p.bakedAt])).toEqual([
      ["p1", true, null],
      ["p3", true, null],
    ]);
  });

  // 16/11/2026, Jesús: from the phone she takes a project to pass its requests to Len, not to answer its visitors —
  // her bubble stays off (spec local 2026-11-16-movil-es-tu-asistente, §5.6). The web's rule above is unchanged.
  it("🔴 connected from the phone, her bubble stays off", async () => {
    expect(await projects.connectProject({ assistantId: lucia, projectId: "p3", onPage: false })).toBe("connected");
    const mine = await projects.projectsOfAssistant(lucia);
    expect(mine.map((p) => [p.projectId, p.onPage])).toEqual([
      ["p1", true],
      ["p3", false],
    ]);
  });

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
      ["p1", "Pastelería Canela", "canela", true, true],
      ["p3", "Canela Reservas", null, false, true],
      ["p2", "Canela Tienda", "canela-tienda", false, true],
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

  // Agents for everyone, final review M2 (re-graded): a task of hers runs only at her home, so left behind it stopped.
  it("🔴 her scheduled tasks move home with her; Len's stay", async () => {
    await pg.query(`insert into "scheduledTasks" values ('t-hers', 'p1', $1), ('t-len', 'p1', null)`, [lucia]);
    await projects.connectProject({ assistantId: lucia, projectId: "p3" });
    expect(await projects.disconnectProject(lucia, "p1")).toBe("disconnected");
    expect((await pg.query(`select "id", "projectId" from "scheduledTasks" order by "id"`)).rows).toEqual([
      { id: "t-hers", projectId: "p3" },
      { id: "t-len", projectId: "p1" },
    ]);
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
// AGENTS FOR EVERYONE (spec local 2026-11-19-agentes-para-todos, §6.7): an agent lives in the person's space and
// attends a page only because the person put it there — one agent per page.
describe("an agent of the space and the pages it attends", () => {
  let smith: string;
  beforeEach(async () => {
    await pg.query(`insert into "projects" ("id", "userId", "title", "data") values ('space', 'u1', null, '{"space":{"bornAt":"2026-11-19T00:00:00.000Z"}}')`);
    const r = await createAssistant({
      personId: "u1",
      homeProjectId: "space",
      served: null,
      input: { name: "Mr. Smith", look: { v: 1, shape: "round", color: "#19c3b1", eyes: "oval", eyewear: "none", accessory: "none" }, tone: "friendly" },
      agentType: "english-teacher",
    });
    if (!r.ok) throw new Error("setup");
    smith = r.assistant.id;
  });
  const served = async (id: string) => (await projects.projectsOfAssistant(id)).map((p) => [p.projectId, p.onPage]);

  it("🔴 the space is never a page to attend", async () => {
    expect(await projects.connectProject({ assistantId: smith, projectId: "space" })).toBe("space_not_a_page");
    expect(await projects.replaceOnProject({ assistantId: smith, projectId: "space", onPage: true, spaceId: "space" })).toBe("space_not_a_page");
    expect(await served(smith)).toEqual([]);
  });

  it("🔴 it can stop attending its only page: its home is the space, not that page", async () => {
    expect(await projects.connectProject({ assistantId: smith, projectId: "p3" })).toBe("connected");
    expect(await projects.disconnectProject(smith, "p3")).toBe("disconnected");
    expect((await assistantById(smith))!.homeProjectId).toBe("space");
    expect(await served(smith)).toEqual([]);
  });

  it("🔴 put on a page an old assistant lives on, that one goes home to the space with her conversation", async () => {
    expect(await projects.replaceOnProject({ assistantId: smith, projectId: "p1", onPage: true, spaceId: "space" })).toBe("connected");
    expect(await served(smith)).toEqual([["p1", true]]);
    expect((await assistantById(lucia))!.homeProjectId).toBe("space");
    expect(await herRows("space")).toEqual(["m1", "m2"]);
    expect(await served(lucia)).toEqual([]);
    // Len's rows never move.
    expect((await pg.query(`select "projectId" from "projectChatMessages" where "id" = 'len1'`)).rows).toEqual([{ projectId: "p1" }]);
  });

  it("put on a page another one only attends, that one just leaves it", async () => {
    await projects.connectProject({ assistantId: lucia, projectId: "p3" });
    expect(await projects.replaceOnProject({ assistantId: smith, projectId: "p3", onPage: false, spaceId: "space" })).toBe("connected");
    expect(await served(smith)).toEqual([["p3", false]]);
    expect((await assistantById(lucia))!.homeProjectId).toBe("p1");
    expect(await served(lucia)).toEqual([["p1", true]]);
  });

  it("🔴 while the old one is answering at home, the page waits", async () => {
    await pg.query(`update "projectChatMessages" set "status" = 'en_curso' where "id" = 'm2'`);
    expect(await projects.replaceOnProject({ assistantId: smith, projectId: "p1", onPage: true, spaceId: "space" })).toBe("busy");
    expect(await served(smith)).toEqual([]);
    expect((await assistantById(lucia))!.homeProjectId).toBe("p1");
  });

  it("a free page is simply taken, and its own page stays its own", async () => {
    expect(await projects.replaceOnProject({ assistantId: smith, projectId: "p2", onPage: true, spaceId: "space" })).toBe("connected");
    expect(await projects.replaceOnProject({ assistantId: smith, projectId: "p2", onPage: true, spaceId: "space" })).toBe("connected");
    expect(await served(smith)).toEqual([["p2", true]]);
  });
});

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

// THE PROJECTS AN AGENT STARTED (spec local 2026-11-21-agente-sigue-su-proyecto): a link, not «serving» — as Claude Code's
// linked sessions and DeepSeek's subagent catalog. Gone with the project or the agent.
describe("the projects an agent started", () => {
  it("🔴 a project it started is listed with its current title and address", async () => {
    await projects.linkStartedProject(lucia, "p4");
    await pg.query(`update "projects" set "title" = 'Presupuesto mensual' where "id" = 'p4'`);
    const started = await projects.startedProjectsOf(lucia);
    expect(started.map((p) => [p.projectId, p.title, p.subdomain])).toEqual([["p4", "Presupuesto mensual", "otra"]]);
    expect(started[0]!.startedAt).toBeInstanceOf(Date);
  });

  it("linking twice is one link", async () => {
    await projects.linkStartedProject(lucia, "p4");
    await projects.linkStartedProject(lucia, "p4");
    expect((await projects.startedProjectsOf(lucia)).map((p) => p.projectId)).toEqual(["p4"]);
  });

  it("🔴 deleting the project or the agent removes the link", async () => {
    await projects.linkStartedProject(lucia, "p3");
    await projects.linkStartedProject(lucia, "p4");
    await pg.query(`delete from "projects" where "id" = 'p4'`);
    expect((await projects.startedProjectsOf(lucia)).map((p) => p.projectId)).toEqual(["p3"]);
    await pg.query(`delete from "assistants" where "id" = $1`, [lucia]);
    expect((await pg.query(`select 1 from "assistantStartedProjects"`)).rows).toEqual([]);
  });

  // Final review, finding 1: a project started for a request is empty until Len's turn writes — and may stay so (no
  // credits, a restart). It is never the person's blank project, which /new and create_project would take over.
  it("🔴 a project an agent started is never taken as the person's blank project", async () => {
    // The setup's other projects have pages: only these two are empty.
    await pg.query(`update "projects" set "data" = '{"html":"<p>Hola</p>"}' where "id" in ('p2', 'p3', 'p4')`);
    await pg.query(`insert into "projects" ("id", "userId", "title", "data", "updatedAt") values ('b-old', 'u1', 'Sin título', '{"html":""}', '2026-11-20T10:00:00Z'), ('b-started', 'u1', 'Presupuesto', '{"html":""}', '2026-11-21T10:00:00Z')`);
    await projects.linkStartedProject(lucia, "b-started");
    expect(await findOrCreateBlankProject("u1")).toBe("b-old");
  });

  it("🔴 the live check says whether it started a project, with its title", async () => {
    await projects.linkStartedProject(lucia, "p4");
    expect(await projects.startedTitleOf(lucia, "p4")).toBe("Otra");
    expect(await projects.startedTitleOf(lucia, "p3")).toBeNull();
    await pg.query(`update "projects" set "title" = '' where "id" = 'p4'`);
    expect(await projects.startedTitleOf(lucia, "p4")).toBe("p4");
  });

  it("only the 30 most recent, oldest first", async () => {
    for (let i = 1; i <= 31; i++) {
      await pg.query(`insert into "projects" ("id", "userId", "title") values ($1, 'u1', $1)`, [`s${i}`]);
      await pg.query(`insert into "assistantStartedProjects" ("assistantId", "projectId", "startedAt") values ($1, $2, $3)`, [lucia, `s${i}`, new Date(NOW.getTime() + i * 60_000)]);
    }
    const started = await projects.startedProjectsOf(lucia);
    expect(started).toHaveLength(projects.STARTED_LISTED);
    expect(projects.STARTED_LISTED).toBe(30);
    expect(started[0]!.projectId).toBe("s2");
    expect(started.at(-1)!.projectId).toBe("s31");
  });
});
