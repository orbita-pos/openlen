// @vitest-environment node
//
// A BUILT CASE, KEPT AND PUT BACK (spec local 2026-11-13-conversar-todo-el-mes, §8.2): every run of every arm
// starts from the conversation exactly as its building left it. Against Postgres (PGlite).
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

import { ageConversation, fingerprint, hasSnapshot, projectScope, restoreSnapshot, saveSnapshot, snapshotSchema, type Sql } from "./snapshot";

const P = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
let pg: PGlite;
let sql: Sql;

const rows = async <T = Record<string, unknown>>(text: string): Promise<T[]> => (await pg.query<T>(text)).rows;

beforeEach(async () => {
  pg = new PGlite();
  sql = { query: async (text, params) => (await pg.query(text, params as unknown[] | undefined)).rows as never };
  await pg.exec(`
    create table "users" ("id" text primary key, "agentMemory" text, "credits" integer not null default 0);
    create table "projects" ("id" text primary key, "userId" text not null references "users"("id"), "title" text not null);
    create table "projectFiles" ("projectId" text not null references "projects"("id") on delete cascade, "path" text not null, "content" text not null, primary key ("projectId", "path"));
    create table "projectChatMessages" ("id" text primary key, "projectId" text not null references "projects"("id") on delete cascade,
      "userText" text not null, "createdAt" timestamp not null, "durationMs" integer, "transcript" jsonb);
    -- No foreign key to projects, like the ledger: only the column says whose it is.
    create table "agentRequestSteps" ("id" text primary key, "projectId" text not null, "inputTokens" integer);
    -- A table that hangs off a project's table without naming the project.
    create table "codeThreads" ("id" text primary key, "projectId" text not null references "projects"("id") on delete cascade);
    create table "codeThreadMessages" ("id" text primary key, "threadId" text not null references "codeThreads"("id") on delete cascade, "body" text not null);
    -- The assistant names her project in another column, and has a table of her own.
    create table "assistants" ("id" text primary key, "homeProjectId" text not null references "projects"("id") on delete cascade, "memory" text);
    create table "assistantSlugAliases" ("slug" text primary key, "assistantId" text not null references "assistants"("id") on delete cascade);
    -- Nothing to do with a project.
    create table "templates" ("id" text primary key, "name" text not null);

    insert into "users" values ('u1', 'be brief', 500);
    insert into "projects" values ('${P}', 'u1', 'the case'), ('${OTHER}', 'u1', 'someone else''s');
    insert into "projectFiles" values ('${P}', '/index.html', '<h1>v1</h1>'), ('${P}', '/data/prices.csv', 'bread,38'), ('${OTHER}', '/index.html', '<h1>other</h1>');
    insert into "projectChatMessages" values
      ('t1', '${P}', 'first', '2026-11-13 09:00:00', 60000, '{"mensajes":[{"role":"assistant","content":"one"}]}'),
      ('t2', '${P}', 'second', '2026-11-13 09:10:00', 120000, '{"mensajes":[{"role":"assistant","content":"two"}],"provider":{"id":"deepinfra","at":"2026-11-13T09:12:00.000Z"}}'),
      ('o1', '${OTHER}', 'theirs', '2026-11-13 09:00:00', 1000, null);
    insert into "agentRequestSteps" values ('s1', '${P}', 1000), ('s9', '${OTHER}', 5);
    insert into "codeThreads" values ('th1', '${P}'), ('th9', '${OTHER}');
    insert into "codeThreadMessages" values ('m1', 'th1', 'look here'), ('m9', 'th9', 'theirs');
    insert into "assistants" values ('a1', '${P}', 'she likes tea');
    insert into "assistantSlugAliases" values ('lucia', 'a1');
    insert into "templates" values ('mirror', 'Mirror');
  `);
});

describe("what belongs to a project", () => {
  it("is every table that names it, the project's own row, her assistant, and what hangs off those", async () => {
    const scope = await projectScope(sql, P);
    expect(scope.map((t) => t.table).sort()).toEqual(
      ["agentRequestSteps", "assistantSlugAliases", "assistants", "codeThreadMessages", "codeThreads", "projectChatMessages", "projectFiles", "projects"].sort(),
    );
    // Parents before what hangs off them.
    const at = (table: string) => scope.findIndex((t) => t.table === table);
    expect(at("codeThreads")).toBeLessThan(at("codeThreadMessages"));
    expect(at("assistants")).toBeLessThan(at("assistantSlugAliases"));
  });

  it("a project id that is not an id is refused: it goes into the statements as text", async () => {
    await expect(projectScope(sql, "x'; drop table users; --")).rejects.toThrow(/project id/);
  });
});

describe("a case is kept and put back", () => {
  it("after a run changed, added and removed things, the project is exactly as it was kept", async () => {
    await saveSnapshot(sql, "case-one", P);
    expect(await hasSnapshot(sql, "case-one")).toBe(true);
    const kept = await fingerprint(sql, P);

    await pg.exec(`
      update "projectFiles" set "content" = '<h1>v2</h1>' where "projectId" = '${P}' and "path" = '/index.html';
      delete from "projectFiles" where "projectId" = '${P}' and "path" = '/data/prices.csv';
      insert into "projectFiles" values ('${P}', '/new.txt', 'made by the run');
      insert into "projectChatMessages" values ('t3', '${P}', 'the question', '2026-11-13 19:00:00', 5000, '{"mensajes":[],"coldTrim":{"v":1}}');
      insert into "agentRequestSteps" values ('s2', '${P}', 90000);
      delete from "codeThreads" where "id" = 'th1';
      insert into "codeThreads" values ('th2', '${P}');
      insert into "codeThreadMessages" values ('m2', 'th2', 'new');
      update "assistants" set "memory" = 'she likes coffee now' where "id" = 'a1';
      update "users" set "agentMemory" = 'changed by a turn', "credits" = 120 where "id" = 'u1';
    `);
    expect(await fingerprint(sql, P)).not.toEqual(kept);

    await restoreSnapshot(sql, "case-one", P);
    expect(await fingerprint(sql, P)).toEqual(kept);
    expect(await rows(`select "path", "content" from "projectFiles" where "projectId" = '${P}' order by "path"`)).toEqual([
      { path: "/data/prices.csv", content: "bread,38" },
      { path: "/index.html", content: "<h1>v1</h1>" },
    ]);
    expect(await rows(`select "id" from "codeThreadMessages" order by "id"`)).toEqual([{ id: "m1" }, { id: "m9" }]);
    expect(await rows(`select "memory" from "assistants"`)).toEqual([{ memory: "she likes tea" }]);
    // The owner's memory goes back too (a turn may write it); the balance is the bench's, not the case's.
    expect(await rows(`select "agentMemory", "credits" from "users"`)).toEqual([{ agentMemory: "be brief", credits: 120 }]);
  });

  it("another project's rows are never touched, nor a table that belongs to no project", async () => {
    await saveSnapshot(sql, "case-one", P);
    await pg.exec(`update "projectFiles" set "content" = 'theirs, changed meanwhile' where "projectId" = '${OTHER}'`);
    await restoreSnapshot(sql, "case-one", P);
    expect(await rows(`select "content" from "projectFiles" where "projectId" = '${OTHER}'`)).toEqual([{ content: "theirs, changed meanwhile" }]);
    expect(await rows(`select count(*)::int as n from "projectChatMessages" where "projectId" = '${OTHER}'`)).toEqual([{ n: 1 }]);
    expect(await rows(`select count(*)::int as n from "templates"`)).toEqual([{ n: 1 }]);
    expect(await rows(`select "id" from "codeThreadMessages" where "threadId" = 'th9'`)).toEqual([{ id: "m9" }]);
  });

  it("it can be put back any number of times, and keeping it again replaces what was kept", async () => {
    await saveSnapshot(sql, "case-one", P);
    const kept = await fingerprint(sql, P);
    for (let i = 0; i < 3; i++) {
      await pg.exec(`insert into "projectChatMessages" values ('run${i}', '${P}', 'q', '2026-11-13 20:00:00', 1, null)`);
      await restoreSnapshot(sql, "case-one", P);
      expect(await fingerprint(sql, P)).toEqual(kept);
    }
    await pg.exec(`insert into "projectFiles" values ('${P}', '/kept-later.txt', 'x')`);
    await saveSnapshot(sql, "case-one", P);
    await pg.exec(`delete from "projectFiles" where "projectId" = '${P}'`);
    await restoreSnapshot(sql, "case-one", P);
    expect(await rows(`select count(*)::int as n from "projectFiles" where "projectId" = '${P}'`)).toEqual([{ n: 3 }]);
  });

  it("a case that was never kept, or kept for another project, is refused before anything is deleted", async () => {
    await expect(restoreSnapshot(sql, "never-kept", P)).rejects.toThrow(/no snapshot/);
    await saveSnapshot(sql, "case-one", P);
    await expect(restoreSnapshot(sql, "case-one", OTHER)).rejects.toThrow(/belongs to project/);
    expect(await rows(`select count(*)::int as n from "projectFiles" where "projectId" = '${OTHER}'`)).toEqual([{ n: 1 }]);
  });

  it("its name becomes a schema of its own, never one of the app's", () => {
    expect(snapshotSchema("Chat-Pumps 40k")).toBe("lb_chat_pumps_40k");
    expect(snapshotSchema("public")).toBe("lb_public");
  });
});

// THE PAUSE: nothing waits. The conversation is moved into the past, and the route — which reads when the
// last model turn ended off its rows — sees a person coming back ten hours later.
describe("the pause", () => {
  const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
  const ended = async () =>
    (await rows<{ ms: string }>(`select (extract(epoch from max("createdAt") )*1000 + max("durationMs"))::bigint::text as ms from "projectChatMessages" where "projectId" = '${P}' and "id" = 't2'`))[0]!.ms;

  it("the last turn ends exactly that long before now, and every row keeps its distance to the others", async () => {
    await ageConversation(sql, P, 10 * 3_600_000, NOW);
    expect(Number(await ended())).toBe(NOW - 10 * 3_600_000);
    const [gap] = await rows<{ s: number }>(`select extract(epoch from (select "createdAt" from "projectChatMessages" where "id" = 't2') - (select "createdAt" from "projectChatMessages" where "id" = 't1'))::int as s`);
    expect(gap!.s).toBe(600);
    // The provider that answered is remembered ten minutes: it is moved with its turn.
    const [row] = await rows<{ at: string }>(`select "transcript"->'provider'->>'at' as at from "projectChatMessages" where "id" = 't2'`);
    expect(Date.parse(row!.at)).toBe(NOW - 10 * 3_600_000);
  });

  it("is the same wherever it starts from: aged twice, the conversation ends in the same place", async () => {
    await ageConversation(sql, P, 10 * 3_600_000, NOW);
    await ageConversation(sql, P, 10 * 3_600_000, NOW + 5 * 60_000);
    expect(Number(await ended())).toBe(NOW + 5 * 60_000 - 10 * 3_600_000);
  });

  it("another project's conversation stays where it was", async () => {
    await ageConversation(sql, P, 10 * 3_600_000, NOW);
    expect(await rows(`select "createdAt"::text as at from "projectChatMessages" where "id" = 'o1'`)).toEqual([{ at: "2026-11-13 09:00:00" }]);
  });
});
