// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { AgentDeps, AgentSession } from "@/lib/agent/tools";
import * as schema from "@/lib/db/schema";
import { transactionScope } from "@/lib/db/transaction-scope";

const state = vi.hoisted(() => ({ scope: null as unknown, open: 0 }));
vi.mock("@/lib/db", () => ({ schema, get db() { return (state.scope as ReturnType<typeof transactionScope>).db; },
  inTransaction: async (f: () => Promise<unknown>) => {
    state.open++;
    try { return await (state.scope as ReturnType<typeof transactionScope>).run(f); }
    finally { state.open--; }
  } }));
const { saveWorktreeIntoDraft } = await import("./worktree-save");
const database = await import("@/lib/db");
let pg: PGlite;
let deps: AgentDeps;
const session = (): AgentSession => ({ projectId: "p", userId: "u", turnId: "t", page: null, ownerEmail: null, imageEditsThisTurn: 0, photoSearchesThisTurn: 0, busquedasVaciasSeguidas: 0 });
beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(`create table "projects" (id text primary key, data jsonb);
    create table "projectFiles" ("projectId" text, path text, content text, "updatedAt" timestamp default now(), primary key ("projectId", path));
    create table versions (path text, content text);
    insert into "projects" values ('p', '{"html":"<p>Home</p>"}');
    insert into "projectFiles" ("projectId",path,content) values ('p', '/src/a.ts', 'old');`);
  state.scope = transactionScope(drizzle(pg, { schema }) as unknown as typeof database.db);
  deps = ({
    loadProject: async () => ({ data: { html: "<p>Home</p>" }, title: "", userBrief: null, publishedAt: null, subdomain: null }),
    projectFiles: async () => Object.fromEntries((await database.db.select({ path: schema.projectFiles.path, content: schema.projectFiles.content }).from(schema.projectFiles)).map(r => [r.path, r.content])),
    saveProjectFile: async (projectId, path, content, version) => {
      await database.db.execute((await import("drizzle-orm")).sql`insert into versions values (${path}, ${version.before})`);
      await database.db.insert(schema.projectFiles).values({ projectId, path, content }).onConflictDoUpdate({ target: [schema.projectFiles.projectId, schema.projectFiles.path], set: { content } });
      return { versionPrevia: "v" };
    },
  } satisfies Partial<AgentDeps>) as unknown as AgentDeps;
});
const a = { tipo: "escrito", ruta: "/src/a.ts", contenido: "child", crea: false } as const;
const draft = { "/index.html": "<p>Home</p>", "/src/a.ts": "old" };
const content = async () => (await pg.query<{ content: string }>(`select content from "projectFiles" where path='/src/a.ts'`)).rows[0]!.content;

it("the real guard's refusal rolls back the accepted file and its version", async () => {
  const changes = [a, { tipo: "borrado", ruta: "/index.html" } as const];
  const r = await saveWorktreeIntoDraft(session(), deps, changes, draft);
  expect(r.rechazado).toBe(true);
  expect(await content()).toBe("old");
  expect((await pg.query(`select * from versions`)).rows).toHaveLength(0);
});
it("a late parent edit is retried instead of overwritten", async () => {
  await database.db.update(schema.projectFiles).set({ content: "parent" }).where(eq(schema.projectFiles.path, a.ruta));
  expect(await saveWorktreeIntoDraft(session(), deps, [a], draft)).toEqual({ rechazado: false, retry: true });
  expect(await content()).toBe("parent");
});
it("two overlapping atomic saves cannot overwrite each other's expected draft", async () => {
  const results = await Promise.all([saveWorktreeIntoDraft(session(), deps, [a], draft), saveWorktreeIntoDraft(session(), deps, [{ ...a, contenido: "second" }], draft)]);
  expect(results.filter(r => r.retry)).toHaveLength(1);
  expect(await content()).toBe("child");
});
it("a valid real guarded save and its version commit together", async () => {
  expect(await saveWorktreeIntoDraft(session(), deps, [a], draft)).toEqual({ rechazado: false });
  expect(await content()).toBe("child");
  expect((await pg.query(`select * from versions`)).rows).toEqual([{ path: a.ruta, content: "old" }]);
});
it("a failed second save rolls back the first", async () => {
  const original = deps.saveProjectFile!;
  deps.saveProjectFile = async (...args) => { if (args[1] === "/src/b.ts") throw new Error("disk failed"); return original(...args); };
  await expect(saveWorktreeIntoDraft(session(), deps, [a, { ...a, ruta: "/src/b.ts", crea: true }], draft)).rejects.toThrow("disk failed");
  expect(await content()).toBe("old");
});
// In an app, what the child imports is installed from esm.sh (network, seconds). Inside the serializable
// transaction it held the connection and collided with everything Len wrote meanwhile; it goes after the commit.
const APP = { catalogo: "2026-11", entrada: "/src/main.tsx" };
const importsTiny = { ...a, contenido: `import tiny from "tiny";\nexport default tiny;\n` };
const recordInstalls = () => {
  const seen: string[] = [];
  deps.installPackages = (async () => {
    seen.push(state.open > 0 ? "inside the transaction" : "after the commit");
    return { files: {}, notes: [], installed: [] };
  }) as unknown as AgentDeps["installPackages"];
  return seen;
};
it("in an app, what the child imports is installed after the merge commits, never inside its transaction", async () => {
  const seen = recordInstalls();
  expect(await saveWorktreeIntoDraft({ ...session(), app: APP }, deps, [importsTiny], draft)).toEqual({ rechazado: false });
  expect(seen).toEqual(["after the commit"]);
});
it("in an app, a refused merge installs nothing", async () => {
  const seen = recordInstalls();
  const r = await saveWorktreeIntoDraft({ ...session(), app: APP }, deps, [importsTiny, { tipo: "borrado", ruta: "/index.html" }], draft);
  expect(r.rechazado).toBe(true);
  expect(seen).toEqual([]);
});

it("transaction scopes isolate parallel callers and defer side effects until commit", async () => {
  const scope = state.scope as ReturnType<typeof transactionScope>;
  const called: string[] = [];
  await expect(scope.run(async () => { scope.afterCommit(() => { called.push("rolled back"); }); throw new Error("no"); })).rejects.toThrow("no");
  await scope.run(async () => { scope.afterCommit(() => { called.push("committed"); }); expect(called).toEqual([]); });
  expect(called).toEqual(["committed"]);
});
