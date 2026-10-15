// @vitest-environment node
//
// The draft database splits its migrations and seed off the app's thread too
// (14/10): a draft can be born from a visitor's request to the published
// backend (`serve.ts` → `ensureEnvironmentReady`), so a slow split there would
// freeze the server for everyone, not only for Len's command.
import { beforeEach, describe, expect, it, vi } from "vitest";

const splitCalls: { sql: string; signal?: AbortSignal }[] = [];
let splitResult: (sql: string) => readonly string[] | null = () => [];
const applied: { version: string; statements: readonly string[] }[] = [];
const seedRuns: (readonly string[])[] = [];

vi.mock("./split-off-thread", () => ({
  splitSqlOffThread: async (sql: string, o: { signal?: AbortSignal }) => {
    splitCalls.push({ sql, ...(o.signal ? { signal: o.signal } : {}) });
    return splitResult(sql);
  },
  SPLIT_CAP_MS: 30_000,
}));
vi.mock("./recorded-migrations", () => ({
  readRecordedMigrations: async () => [],
  applyMigrationAs: async (_draft: unknown, m: { version: string; statements: readonly string[] }) => {
    applied.push({ version: m.version, statements: m.statements });
    return { ok: true };
  },
  runStatementsAs: async (_draft: unknown, statements: readonly string[]) => {
    seedRuns.push(statements);
    return { ok: true };
  },
  migrationLabel: (m: { version: string; name: string | null }) => (m.name ? `${m.version}_${m.name}` : m.version),
}));
vi.mock("./provision", () => ({ provisionDatabase: async () => {}, dropProjectDatabase: async () => {} }));
vi.mock("./storage/provision", () => ({ ensureStorageProvisioned: async () => {}, forgetStorageProvisioned: () => {} }));
vi.mock("./realtime/provision", () => ({ ensureRealtimeProvisioned: async () => {}, forgetRealtimeProvisioned: () => {} }));

const { buildDraftDatabase } = await import("./draft");

const DRAFT = { scope: "abcdefghijklmnopqrst_d", ref: "abcdefghijklmnopqrst", password: "pw" };
const FILES = {
  "/supabase/migrations/20261014000000_shop.sql": "create table a (id int);",
  "/supabase/seed.sql": "insert into a values (1);",
};

beforeEach(() => {
  splitCalls.length = 0;
  applied.length = 0;
  seedRuns.length = 0;
  splitResult = (sql) => [sql.replace(/;\s*$/, "")];
});

describe("the draft splits its SQL off the app's thread", () => {
  it("🔴 local migrations and the seed go through splitSqlOffThread, with the command's signal", async () => {
    const signal = new AbortController().signal;
    const r = await buildDraftDatabase({ draft: DRAFT, live: null, files: FILES, includeLocal: true, signal });
    expect(r).toEqual({ ok: true, applied: ["20261014000000"], seeded: true });
    expect(splitCalls.map((c) => c.sql)).toEqual(["create table a (id int);", "insert into a values (1);"]);
    expect(splitCalls.every((c) => c.signal === signal)).toBe(true);
    expect(applied).toEqual([{ version: "20261014000000", statements: ["create table a (id int)"] }]);
    expect(seedRuns).toEqual([["insert into a values (1)"]]);
  });

  it("🔴 a migration that can't be split in time is reported, and nothing of it is applied", async () => {
    splitResult = (sql) => (sql.startsWith("create") ? null : [sql]);
    const r = await buildDraftDatabase({ draft: DRAFT, live: null, files: FILES, includeLocal: true });
    expect(r).toEqual({
      ok: false,
      step: "migration",
      name: "20261014000000_shop",
      failedAt: 0,
      error: { message: "could not split supabase/migrations/20261014000000_shop.sql into statements in time" },
    });
    expect(applied).toEqual([]);
    expect(seedRuns).toEqual([]);
  });

  it("a seed that can't be split in time is reported", async () => {
    splitResult = (sql) => (sql.startsWith("insert") ? null : [sql]);
    const r = await buildDraftDatabase({ draft: DRAFT, live: null, files: FILES, includeLocal: false });
    expect(r).toEqual({
      ok: false,
      step: "seed",
      name: "supabase/seed.sql",
      failedAt: 0,
      error: { message: "could not split supabase/seed.sql into statements in time" },
    });
    expect(seedRuns).toEqual([]);
  });
});
