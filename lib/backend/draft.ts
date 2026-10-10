// LA VIDA DEL BORRADOR (spec local 2026-10-09, sección 7): nace con las
// migraciones que ya tiene producción —con sus sentencias guardadas, como una
// rama de Supabase— y el `supabase/seed.sql`; `db reset` lo tira y lo rehace
// igual, más las migraciones locales que producción aún no tiene. Los datos
// reales no viajan nunca hacia aquí.

import "server-only";

import { localMigrations } from "./cli-core";
import type { ScopeCreds } from "./environments";
import { dropProjectDatabase, provisionDatabase } from "./provision";
import { ensureRealtimeProvisioned, forgetRealtimeProvisioned } from "./realtime/provision";
import { applyMigrationAs, migrationLabel, readRecordedMigrations, runStatementsAs, type RecordedMigration } from "./recorded-migrations";
import { splitSqlStatements } from "./sql-split";
import { ensureStorageProvisioned, forgetStorageProvisioned } from "./storage/provision";

export const SEED_PATH = "/supabase/seed.sql";

export type BuildDraftResult =
  | { readonly ok: true; readonly applied: string[]; readonly seeded: boolean }
  | {
      readonly ok: false;
      readonly step: "migration" | "seed";
      readonly name: string;
      readonly failedAt: number;
      readonly error: { readonly message: string; readonly code?: string };
    };

export interface BuildDraftOptions {
  readonly draft: ScopeCreds;
  readonly live: ScopeCreds | null;
  readonly files: Readonly<Record<string, string>>;
  readonly includeLocal: boolean;
}

export async function buildDraftDatabase(o: BuildDraftOptions): Promise<BuildDraftResult> {
  const fromLive = o.live ? await readRecordedMigrations(o.live.scope) : [];
  const known = new Set(fromLive.map((m) => m.version));
  const local: RecordedMigration[] = o.includeLocal
    ? localMigrations(o.files)
        .migrations.filter((m) => !known.has(m.version))
        .map((m) => ({ version: m.version, name: m.name, statements: splitSqlStatements(o.files[m.path] ?? "") }))
    : [];
  const applied: string[] = [];
  for (const m of [...fromLive, ...local]) {
    const r = await applyMigrationAs(o.draft, m);
    if (!r.ok) return { ok: false, step: "migration", name: migrationLabel(m), failedAt: r.failedAt, error: r.error };
    applied.push(m.version);
  }
  const seed = o.files[SEED_PATH] ?? "";
  if (!seed.trim()) return { ok: true, applied, seeded: false };
  const r = await runStatementsAs(o.draft, splitSqlStatements(seed));
  if (!r.ok) return { ok: false, step: "seed", name: "supabase/seed.sql", failedAt: r.failedAt, error: r.error };
  return { ok: true, applied, seeded: true };
}

export async function resetDraftDatabase(o: BuildDraftOptions): Promise<BuildDraftResult> {
  const scoped = { scope: o.draft.scope, ref: o.draft.ref };
  await dropProjectDatabase(o.draft.scope);
  forgetStorageProvisioned(o.draft.scope);
  forgetRealtimeProvisioned(o.draft.scope);
  await provisionDatabase({ ...scoped, dbPassword: o.draft.password });
  // Antes de las migraciones: una puede crear buckets (`storage.buckets`).
  await ensureStorageProvisioned(scoped);
  await ensureRealtimeProvisioned(scoped);
  return buildDraftDatabase(o);
}
