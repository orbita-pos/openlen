// @vitest-environment node
//
// WHO LEN MAY WRITE TO IN A PROJECT (spec local 2026-11-21-len-y-el-agente-conversan, §1 and decision 11): the agents of
// the project's OWNER related to it — the one that asked for the turn, the one that serves it, the ones that started it —
// each once, with the home its turn runs in. Against real Postgres (PGlite), with the tables as `npm run
// assistants:migrate` creates them over minimal users and projects.
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

const { CREATE_ASSISTANTS } = await import("@/scripts/assistants-migrate-sql");
const { createAssistant } = await import("../store");
const { linkStartedProject } = await import("../projects");
const { relatedAgentsOf } = await import("./related");

const look = (color: string) => ({ v: 1, shape: "drop", color, eyes: "oval", eyewear: "none", accessory: "none" }) as const;

let pg: PGlite;
let finanzas: string;
let lucia: string;
let ventas: string;
let ajeno: string;

async function agent(personId: string, projectId: string, name: string): Promise<string> {
  const r = await createAssistant({ personId, projectId, input: { name, look: look("#19c3b1"), tone: "friendly" } });
  if (!r.ok) throw new Error(`setup: ${name}`);
  return r.assistant.id;
}

/** When a project was started: the order the started ones are listed in. */
async function startedAt(assistantId: string, projectId: string, at: string) {
  await linkStartedProject(assistantId, projectId);
  await pg.query(`update "assistantStartedProjects" set "startedAt" = $1 where "assistantId" = $2 and "projectId" = $3`, [at, assistantId, projectId]);
}

beforeEach(async () => {
  pg = new PGlite();
  await pg.query(`create table "users" ("id" text primary key)`);
  await pg.query(`create table "projects" ("id" text primary key, "userId" text)`);
  await pg.query(`insert into "users" values ('u1'), ('u2')`);
  await pg.query(`insert into "projects" values ('home', 'u1'), ('budget', 'u1'), ('shop', 'u1'), ('blog', 'u1'), ('theirs', 'u2')`);
  for (const statement of CREATE_ASSISTANTS) await pg.query(statement);
  base.db = drizzle(pg, { schema });
  finanzas = await agent("u1", "home", "Finanzas"); // serves its home only
  lucia = await agent("u1", "budget", "Lucía"); // serves the budget, which is her home
  ventas = await agent("u1", "shop", "Ventas"); // serves the shop
  ajeno = await agent("u2", "theirs", "Ajeno"); // another person's
});

describe("relatedAgentsOf", () => {
  it("🔴 the one that asked for the turn, the one serving the project, the ones that started it — in that order, with their homes", async () => {
    await startedAt(ventas, "budget", "2026-11-20T10:00:00Z");
    expect(await relatedAgentsOf("budget", "u1", finanzas)).toEqual([
      { id: finanzas, name: "Finanzas", homeProjectId: "home", why: "asked" },
      { id: lucia, name: "Lucía", homeProjectId: "budget", why: "serves" },
      { id: ventas, name: "Ventas", homeProjectId: "shop", why: "started" },
    ]);
  });

  it("the ones that started it come oldest first", async () => {
    await startedAt(ventas, "blog", "2026-11-20T10:00:00Z");
    await startedAt(finanzas, "blog", "2026-11-19T10:00:00Z");
    expect((await relatedAgentsOf("blog", "u1", null)).map((a) => [a.name, a.why])).toEqual([
      ["Finanzas", "started"],
      ["Ventas", "started"],
    ]);
  });

  it("🔴 no duplicates: one entry per agent, its first reason", async () => {
    // Lucía serves the budget, started it, and asked for this turn.
    await startedAt(lucia, "budget", "2026-11-20T10:00:00Z");
    expect(await relatedAgentsOf("budget", "u1", lucia)).toEqual([{ id: lucia, name: "Lucía", homeProjectId: "budget", why: "asked" }]);
    // Without her asking, she is the one serving it.
    expect(await relatedAgentsOf("budget", "u1", null)).toEqual([{ id: lucia, name: "Lucía", homeProjectId: "budget", why: "serves" }]);
  });

  it("🔴 only the owner's agents: another person's agent is never related, whatever it did", async () => {
    // Another person's agent can't serve the owner's project nor ask for its turn; even a link that says it started it
    // (or a forged origin) names nobody.
    await startedAt(ajeno, "budget", "2026-11-20T10:00:00Z");
    expect((await relatedAgentsOf("budget", "u1", ajeno)).map((a) => a.name)).toEqual(["Lucía"]);
    // And the owner's own agent, read with someone else as the owner (a member who speaks is never the owner): nobody.
    expect(await relatedAgentsOf("budget", "u2", lucia)).toEqual([{ id: ajeno, name: "Ajeno", homeProjectId: "theirs", why: "started" }]);
  });

  it("a project with no agent related, and an origin that doesn't exist: nobody", async () => {
    expect(await relatedAgentsOf("blog", "u1", null)).toEqual([]);
    expect(await relatedAgentsOf("blog", "u1", "nope")).toEqual([]);
  });
});
