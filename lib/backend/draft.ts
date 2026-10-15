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
import { splitSqlOffThread } from "./split-off-thread";
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
  /** El del comando que lo pidió (`supabase db reset`): si se corta, se corta
   *  también lo que parte el SQL (14/10). */
  readonly signal?: AbortSignal;
}

/** El SQL partido en el hilo del separador (`split-off-thread.ts`, 14/10): un
 *  borrador puede nacer de la petición de un visitante, y aquí no se puede
 *  parar el hilo de la app. `null` = no acabó a tiempo o se canceló. */
const splitOf = (sql: string, o: BuildDraftOptions) => splitSqlOffThread(sql, o.signal ? { signal: o.signal } : {});
const tooSlow = (name: string) => ({ message: `could not split ${name} into statements in time` });

export async function buildDraftDatabase(o: BuildDraftOptions): Promise<BuildDraftResult> {
  const fromLive = o.live ? await readRecordedMigrations(o.live.scope) : [];
  const known = new Set(fromLive.map((m) => m.version));
  const local: RecordedMigration[] = [];
  if (o.includeLocal) {
    for (const m of localMigrations(o.files).migrations.filter((x) => !known.has(x.version))) {
      const statements = await splitOf(o.files[m.path] ?? "", o);
      if (!statements) {
        return { ok: false, step: "migration", name: migrationLabel(m), failedAt: 0, error: tooSlow(m.path.slice(1)) };
      }
      local.push({ version: m.version, name: m.name, statements });
    }
  }
  const applied: string[] = [];
  for (const m of [...fromLive, ...local]) {
    const r = await applyMigrationAs(o.draft, m);
    if (!r.ok) return { ok: false, step: "migration", name: migrationLabel(m), failedAt: r.failedAt, error: r.error };
    applied.push(m.version);
  }
  const seed = o.files[SEED_PATH] ?? "";
  if (!seed.trim()) return { ok: true, applied, seeded: false };
  const seedStatements = await splitOf(seed, o);
  if (!seedStatements) return { ok: false, step: "seed", name: "supabase/seed.sql", failedAt: 0, error: tooSlow("supabase/seed.sql") };
  const r = await runStatementsAs(o.draft, seedStatements);
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
