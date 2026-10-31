// @vitest-environment node
//
// THE WORKTREE FLOW ON A PROJECT WITH A DATABASE, FOR REAL (spec local 2026-10-30-len-watch, §5.5): the site and its
// table are published; the owner goes on with a migration that isn't published (applied to the draft database only);
// it crashes; Len fixes a worktree of what is published — whose terminal reaches the project's draft database — and
// the branch goes out WITHOUT the owner's migration (production keeps its columns); «Traer el arreglo» brings the fix
// in; the owner's publish then carries both, and the migration reaches production. Only Len's turn, the browser check
// and the notices are faked: the app database, git, the worktree, the backend cluster and publishing are the real ones.
//
// 🔴 Runs ONLY when DATABASE_URL is a throwaway database, LEN_WATCH_TEST_DATABASE_URL names the same one, and
// PAGES_E2E_DATABASE_URL names a throwaway cluster for the project backends (its admin), like lib/backend's e2e tests.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

const ROOT = mkdtempSync(path.join(tmpdir(), "ol-len-watch-db-flow-"));
process.env.PUBLISH_ROOT = ROOT;
process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
process.env.OPENLEN_LOCALIZE = "0";
process.env.OPENLEN_IMAGERY = "0";
// The model review is OpenLen's, paid and slow; this flow is about what reaches production's database.
process.env.OPENLEN_SECURITY_REVIEW = "0";
process.env.NEXTAUTH_SECRET ??= "test-secret-for-len-watch-db-flow";

const URL = process.env.LEN_WATCH_TEST_DATABASE_URL;
const PAGES = process.env.PAGES_E2E_DATABASE_URL;
const RUN_IT = !!URL && process.env.DATABASE_URL === URL && !!PAGES;

const page = (body: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reservas</title></head><body>${body}<script src="/js/app.js"></script></body></html>`;
const DOWN = { loads: false, reason: "blank" as const, errors: ["kaput"] };
const UP = { loads: true, reason: "ok" as const, errors: [] };

const RESERVAS = `create table public.reservas (
  id bigint generated always as identity primary key,
  paquete text not null,
  nombre text not null
);
alter table public.reservas enable row level security;
create policy "cualquiera reserva con nombre" on public.reservas for insert to anon with check (length(nombre) between 1 and 120);
`;
const TELEFONO = "alter table public.reservas add column telefono text;\n";

describe.skipIf(!RUN_IT)("the Len Watch worktree on a project with a database", () => {
  const RUN = Math.random().toString(36).slice(2, 8);
  const OWNER = `lw-db-owner-${RUN}`;
  const PROJECT = `lw-db-project-${RUN}`;
  const SUB = `lwdb${RUN}`;
  vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 });

  const served = (file: string) => {
    const base = path.join(ROOT, SUB);
    const sha = readFileSync(path.join(base, "current"), "utf8").trim();
    return readFileSync(path.join(base, "releases", sha, file), "utf8");
  };

  beforeAll(async () => {
    const { exigirBaseLocal } = await import("@/lib/len-bench/entorno");
    await exigirBaseLocal();
    process.env.PAGES_DATABASE_URL = PAGES;
    process.env.PAGES_AUTHENTICATOR_PASSWORD = randomBytes(18).toString("base64url");
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.users).values({ id: OWNER, email: `${OWNER}@test.invalid`, name: "Ana" });
    await db.insert(schema.projects).values({ id: PROJECT, userId: OWNER, title: "Reservas", brief: "", data: { html: page('<p id="m">Reserva tu viaje</p>') } });
    await db.insert(schema.projectFiles).values([
      { projectId: PROJECT, path: "/js/app.js", content: "crash();" },
      { projectId: PROJECT, path: "/supabase/migrations/20261031000001_reservas.sql", content: RESERVAS },
    ]);
  });

  afterAll(async () => {
    if (!RUN_IT) return;
    const { db, schema } = await import("@/lib/db");
    const { eq, or } = await import("drizzle-orm");
    const { dropPageDatabases, pageDatabaseScopes } = await import("@/lib/backend/teardown");
    const databases = await pageDatabaseScopes(PROJECT);
    await db.delete(schema.projects).where(or(eq(schema.projects.id, PROJECT), eq(schema.projects.parentProjectId, PROJECT)));
    await db.delete(schema.users).where(eq(schema.users.id, OWNER));
    if (databases) await dropPageDatabases(databases);
    rmSync(ROOT, { recursive: true, force: true });
  });

  it("the fix goes out without the owner's half-done migration; brought in, the owner's publish carries it", async () => {
    const { db, schema } = await import("@/lib/db");
    const { eq, and } = await import("drizzle-orm");
    const { publishThroughGates } = await import("@/lib/projects/publish-through-gates");
    const { readPublishedSources } = await import("./published-sources");
    const { listProjectFiles } = await import("@/lib/backend/files");
    const { runSupabaseCli } = await import("@/lib/backend/cli");
    const { getEnvironment, dbNameOf } = await import("@/lib/backend/environments");
    const { withAdmin } = await import("@/lib/backend/pg");
    const store = await import("./store");
    const owner = await import("./owner");
    const orchestrate = await import("./orchestrate");
    const wt = await import("./worktree");
    const { bringFix } = await import("./bring");
    const base = { projectId: PROJECT, actorId: OWNER, ownerId: OWNER, subdomain: SUB };
    const file = async (projectId: string, p: string) =>
      (await db.select({ c: schema.projectFiles.content }).from(schema.projectFiles).where(and(eq(schema.projectFiles.projectId, projectId), eq(schema.projectFiles.path, p))))[0]?.c;
    const supabase = async (projectId: string, ...args: string[]) => {
      const r = await runSupabaseCli(projectId, args, await listProjectFiles(projectId));
      expect(r.exitCode, r.stderr).toBe(0);
      return r.stdout;
    };
    const columns = async (env: "draft" | "live") => {
      const e = await getEnvironment(PROJECT, env);
      if (!e) return null;
      const r = await withAdmin(dbNameOf(e.scope), (q) =>
        q.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'reservas' order by ordinal_position"),
      );
      return r.rows.map((row) => String(row.column_name));
    };

    // 1. The table, in the draft database (`supabase db push`, as the owner's terminal), then published: production
    //    is born with it.
    await supabase(PROJECT, "db", "push");
    expect((await publishThroughGates({ ...base, source: "person" })).status).toBe(200);
    await vi.waitFor(async () => expect(await readPublishedSources(PROJECT)).not.toBeNull(), { timeout: 30_000 });
    expect(await columns("live")).toEqual(["id", "paquete", "nombre"]);

    // 2. The owner goes on: a migration they haven't published, applied to the draft database only.
    await db.insert(schema.projectFiles).values({ projectId: PROJECT, path: "/supabase/migrations/20261031000002_telefono.sql", content: TELEFONO });
    await supabase(PROJECT, "db", "push");
    expect(await columns("draft")).toEqual(["id", "paquete", "nombre", "telefono"]);
    expect(await columns("live")).toEqual(["id", "paquete", "nombre"]);

    // 3. It crashes, with «fix» and «publish on its own» on.
    await store.saveSettings(PROJECT, { autoFix: true, autoPublish: true });
    const incident = (await store.openIncident(PROJECT, { message: "boom", file: "/js/app.js", line: 1, col: 1, page: null }))!;
    const launched: { projectId: string; reply: (t: string, c: [], f?: string) => Promise<void> }[] = [];
    const checks = [DOWN, UP, UP];
    const deps: import("./orchestrate").OrchestratorDeps = {
      store,
      worktree: {
        add: wt.addWorktree,
        commitLeftovers: wt.commitLeftovers,
        touches: wt.branchTouches,
        remove: wt.removeWorktree,
        deleteBranch: wt.deleteBranch,
        publishedCommit: async (id) => (await readPublishedSources(id))?.commitOid ?? null,
      },
      project: owner.projectForWatch,
      check: async () => checks.shift() ?? UP,
      notify: async () => undefined,
      launch: (x) => void launched.push(x as never),
      publish: publishThroughGates,
      hasUnpublished: async () => true,
      contentStamp: orchestrate.contentStamp,
      failPhrase: () => "x",
      turnPrompt: () => "Tu sitio publicado no carga.",
      interruptedPhrase: () => "x",
      liveTurn: () => false,
      now: Date.now,
      newId: () => `row-${RUN}`,
    };
    await orchestrate.startFix(incident, (await owner.projectForWatch(PROJECT))!, deps, { check: DOWN });

    // 4. Len works in the worktree: what was published (without the owner's migration file), and its terminal reaches
    //    the project's draft database, as the spec says.
    const copyId = launched[0]!.projectId;
    expect(copyId).not.toBe(PROJECT);
    expect(await file(copyId, "/supabase/migrations/20261031000002_telefono.sql")).toBeUndefined();
    expect(await supabase(copyId, "db", "query", "select column_name from information_schema.columns where table_name = 'reservas'")).toContain("telefono");
    await db.update(schema.projectFiles).set({ content: "ok();" }).where(and(eq(schema.projectFiles.projectId, copyId), eq(schema.projectFiles.path, "/js/app.js")));
    await launched[0]!.reply("Arreglado: app.js llamaba a algo que no existe.", [], "Arreglado: app.js llamaba a algo que no existe.");

    // 5. 🔴 The fix is out, and production's database did NOT get the owner's half-done migration.
    expect(served("js/app.js")).toContain("ok();");
    expect((await store.incidentById(incident.id))!).toMatchObject({ status: "resolved", resolution: "fixed", bringState: "pending", copyProjectId: null });
    expect(await columns("live")).toEqual(["id", "paquete", "nombre"]);
    expect(await columns("draft")).toEqual(["id", "paquete", "nombre", "telefono"]);

    // 6. «Traer el arreglo»: the fix enters the draft; the owner's migration is still there.
    expect(await bringFix({ projectId: PROJECT, incidentId: incident.id, actorId: OWNER })).toEqual({ status: "brought" });
    expect(await file(PROJECT, "/js/app.js")).toBe("ok();");
    expect(await file(PROJECT, "/supabase/migrations/20261031000002_telefono.sql")).toBe(TELEFONO);

    // 7. The owner's publish carries both: the fix, and now their migration reaches production.
    expect((await publishThroughGates({ ...base, source: "person" })).status).toBe(200);
    expect(served("js/app.js")).toContain("ok();");
    expect(await columns("live")).toEqual(["id", "paquete", "nombre", "telefono"]);
  });
});
