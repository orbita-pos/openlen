// @vitest-environment node
//
// LEN WATCH AGAINST REAL POSTGRES: a visitor's report opens ONE incident (the partial unique index
// is the lock), the owner hears it in their language through notificationJobs, «Fix with Len» runs a
// turn whose reply moves the incident to fix_ready with the content's fingerprint, an edit made after
// it makes Approve ask, and an approved publish that loads resolves it. Only the turn, the browser
// check and the publish are faked — the rows are real.
//
// 🔴 It runs ONLY with LEN_WATCH_TEST_DATABASE_URL, a throwaway database (see the memory
// `turnos-reales-en-local-con-base-de-usar-y-tirar`): `@/lib/db` is replaced by a client on that URL,
// so the DATABASE_URL of .env.local (production's) is never touched.
//   LEN_WATCH_TEST_DATABASE_URL=postgresql://openlen@127.0.0.1:5660/openlen_lw npx vitest run lib/len-watch/flow.pg.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

const URL = process.env.LEN_WATCH_TEST_DATABASE_URL;

vi.hoisted(() => {
  process.env.VAPID_PUBLIC_KEY = "BFakePublicKeyForTestingOnly12345678901234567890123456789012";
  process.env.VAPID_PRIVATE_KEY = "fake-private-key-for-testing-only";
  process.env.VAPID_SUBJECT = "mailto:test@test.invalid";
});
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn(async () => ({})) } }));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return holder.db;
    },
  };
});

describe.skipIf(!URL)("Len Watch against real Postgres", () => {
  const RUN = Math.random().toString(36).slice(2, 8);
  const OWNER = `lw-owner-${RUN}`;
  const PROJECT = `lw-project-${RUN}`;
  let pool: import("pg").Pool;

  beforeAll(async () => {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    pool = new Pool({ connectionString: URL });
    holder.db = drizzle(pool, { schema });
    await pool.query(`INSERT INTO "users" ("id", "email") VALUES ($1, $2)`, [OWNER, `${OWNER}@test.invalid`]);
    await pool.query(
      `INSERT INTO "projects" ("id", "userId", "title", "brief", "data", "subdomain", "publishedAt") VALUES ($1, $2, 'Holi', '', $3, $4, now())`,
      [PROJECT, OWNER, JSON.stringify({ html: '<!doctype html><html lang="es"><body><div id="root"></div></body></html>' }), `holi-${RUN}`],
    );
  });

  afterAll(async () => {
    await pool?.query(`DELETE FROM "notificationJobs" WHERE "payload"->>'projectId' = $1`, [PROJECT]);
    await pool?.query(`DELETE FROM "projects" WHERE "id" = $1`, [PROJECT]);
    await pool?.query(`DELETE FROM "users" WHERE "id" = $1`, [OWNER]);
    await pool?.end();
  });

  const jobs = async () =>
    (await pool.query<{ payload: { phase: string; title: string } }>(`SELECT "payload" FROM "notificationJobs" WHERE "payload"->>'projectId' = $1 ORDER BY "createdAt"`, [PROJECT])).rows.map((r) => r.payload);

  it("report → one incident → the owner hears it → fix → ready → an edit after it makes Approve ask → approved → fixed", async () => {
    const store = await import("./store");
    const owner = await import("./owner");
    const orchestrate = await import("./orchestrate");
    const { createIngester } = await import("./ingest");
    const { scheduleNotification } = await import("@/lib/notifications/dispatch");

    const launched: { reply: (t: string, c: []) => Promise<void>; userId: string }[] = [];
    const checks = [{ loads: false, reason: "blank" as const, errors: ["kaput"] }];
    const deps: import("./orchestrate").OrchestratorDeps = {
      store,
      project: owner.projectForWatch,
      check: async () => checks.shift() ?? { loads: true, reason: "ok", errors: [] },
      notify: (e, key) => scheduleNotification(e, key),
      launch: (p) => void launched.push(p as never),
      publish: async () => ({ status: 200, body: {} }),
      hasUnpublished: async () => false,
      contentStamp: orchestrate.contentStamp,
      failPhrase: () => "x",
      turnPrompt: () => "Tu sitio publicado no carga.",
      interruptedPhrase: () => "x",
      liveTurn: () => false,
      now: Date.now,
      newId: () => `row-${RUN}`,
    };
    const ingest = createIngester({
      store,
      project: owner.projectForWatch,
      check: async () => ({ loads: false, reason: "blank", errors: ["kaput"] }),
      onOpened: (i, p, c) => orchestrate.onIncidentOpened(i, p, c, deps),
      now: Date.now,
    });

    // Two visitors at once: one incident (the real partial unique index), the second report counted.
    await Promise.all([ingest(PROJECT, { message: "boom", file: null, line: null, col: null, page: null }), ingest(PROJECT, { message: "boom", file: null, line: null, col: null, page: null })]);
    await ingest(PROJECT, { message: "boom", file: null, line: null, col: null, page: null });
    const opened = await store.activeIncident(PROJECT);
    expect(opened).toMatchObject({ status: "open" });
    expect((await pool.query(`SELECT count(*)::int AS n FROM "lenWatchIncidents" WHERE "projectId" = $1`, [PROJECT])).rows[0].n).toBe(1);
    expect(opened!.reports).toBeGreaterThanOrEqual(2);
    // «Fix on its own» is off: the owner hears it's down, in the page's language.
    expect(await jobs()).toEqual([expect.objectContaining({ phase: "down", title: "Holi no carga" })]);

    // «Fix with Len», pressed by the owner: the turn runs; its reply comes after Len edited the page.
    // Checks in order: before the turn (down) and at Len's reply (still down: the fix isn't published);
    // after the approved publish none is left, so it loads.
    checks.push({ loads: false, reason: "blank", errors: ["kaput"] });
    await orchestrate.startFix(opened!, (await owner.projectForWatch(PROJECT))!, deps, { actorId: OWNER });
    expect(launched[0]!.userId).toBe(OWNER);
    expect((await store.activeIncident(PROJECT))!.status).toBe("fixing");
    await pool.query(`UPDATE "projects" SET "data" = $2 WHERE "id" = $1`, [PROJECT, JSON.stringify({ html: '<!doctype html><html lang="es"><body><div id="root"><h1>Hola</h1></div></body></html>' })]);
    await launched[0]!.reply("Arreglado: el root estaba vacío.", []);
    const ready = await store.activeIncident(PROJECT);
    expect(ready).toMatchObject({ status: "fix_ready", summary: "Arreglado: el root estaba vacío." });
    expect(ready!.fixStamp).toBe(await orchestrate.contentStamp(PROJECT));

    // Someone edits after the fix: Approve asks before publishing that too.
    await pool.query(`UPDATE "projects" SET "data" = $2 WHERE "id" = $1`, [PROJECT, JSON.stringify({ html: '<!doctype html><html lang="es"><body><div id="root"><h1>Hola!</h1></div></body></html>' })]);
    const p = (await owner.projectForWatch(PROJECT))!;
    expect(await orchestrate.approveFix(ready!, p, deps)).toEqual({ status: 409, body: { error: "changed_since_fix" } });
    expect((await orchestrate.approveFix(ready!, p, deps, { confirmChanged: true })).status).toBe(200);
    expect(await store.activeIncident(PROJECT)).toBeNull();
    expect((await store.incidentById(ready!.id))).toMatchObject({ status: "resolved", resolution: "fixed" });
    expect((await jobs()).map((j) => j.phase)).toEqual(["down", "fixing", "fix_ready", "fixed"]);
  }, 60_000);
});
