// LO QUE PUBLICAR HACE CON LOS DATOS (spec local 2026-10-09, sección 6). Lo
// llama `publishToDir` con la release YA construida y justo antes de activarla:
// si algo falla aquí, la release no se activa y producción queda como estaba.
//
//   · el borrador nunca se usó          → nada
//   · producción no existe              → nace (vacía o copia) — sólo el dueño
//   · lo pendiente se ENSAYA en producción (ROLLBACK)
//   · falla                             → DataChangesFailedError, nada aplicado
//   · destruye datos reales sin la huella confirmada → DataChangesNeedConfirmationError
//   · se aplica (con copia de las tablas que pierden datos)
// Las republicaciones de SISTEMA (`mode: "system"`) nunca aplican nada: con algo
// pendiente lanzan DataChangesNeedOwnerError y quien llama salta el proyecto.

import "server-only";

import { decryptToken } from "@/lib/integrations/crypto";

import type { DataChangesPreview, DestructiveChange } from "./data-changes-types";
import {
  createEnvironment,
  deleteEnvironment,
  getEnvironment,
  markEnvironmentProvisioned,
  type Environment,
  type EnvironmentRecord,
  type ScopeCreds,
} from "./environments";
import { createLiveDatabase, dropLiveDatabase } from "./live";
import { withDedicatedAdmin } from "./pg";
import { applyPending, pendingMigrations, rehearse, tablesToBackUp, type ApplyPendingResult, type PendingResult, type Rehearsal } from "./publish-migrations";
import { migrationLabel, readRecordedMigrations, type RecordedMigration } from "./recorded-migrations";

export type { DataChangesPreview, DestructiveChange } from "./data-changes-types";

export class DataChangesFailedError extends Error {
  constructor(
    readonly detail:
      | { kind: "failed"; migration: string; statement: string; message: string; code?: string }
      | { kind: "diverged"; versions: string[] },
  ) {
    super(detail.kind === "failed" ? `la migración ${detail.migration} falló: ${detail.message}` : `producción divergió: ${detail.versions.join(", ")}`);
  }
}

export class DataChangesNeedConfirmationError extends Error {
  constructor(
    readonly destructive: DestructiveChange[],
    readonly fingerprint: string,
  ) {
    super("la publicación destruye datos reales y nadie lo confirmó");
  }
}

export class DataChangesNeedOwnerError extends Error {
  constructor() {
    super("hay cambios de tablas pendientes: los publica el dueño");
  }
}

/** Lo que el orquestador necesita del registro del backend. */
export interface BackendLike {
  readonly projectId: string;
  readonly ref: string;
  readonly dbPasswordEncrypted: string;
}

export interface DataChangesDeps {
  getBackend(projectId: string): Promise<BackendLike | null>;
  getEnvironment(projectId: string, env: Environment): Promise<EnvironmentRecord | null>;
  createEnvironment(projectId: string, ref: string, env: Environment): Promise<EnvironmentRecord>;
  markEnvironmentProvisioned(projectId: string, env: Environment): Promise<void>;
  deleteEnvironment(projectId: string, env: Environment): Promise<void>;
  credsOf(rec: BackendLike, e: EnvironmentRecord): ScopeCreds;
  pendingMigrations(draftScope: string, liveScope: string): Promise<PendingResult>;
  rehearse(live: ScopeCreds, pending: readonly RecordedMigration[]): Promise<Rehearsal>;
  applyPending(live: ScopeCreds, pending: readonly RecordedMigration[], o: { backupTables: readonly string[] }): Promise<ApplyPendingResult>;
  createLiveDatabase(o: { live: ScopeCreds; draft: ScopeCreds; copyData: boolean }): Promise<void>;
  dropLiveDatabase(scope: string): Promise<void>;
  withPublishLock<T>(ref: string, fn: () => Promise<T>): Promise<T>;
}

/** El almacén de Storage del entorno, perezoso: sus dependencias no hacen
 *  falta para decidir nada. */
async function blobStore() {
  const { pageBlobStore } = await import("./storage/r2-blob-store");
  return pageBlobStore();
}

export function realDataChangesDeps(): DataChangesDeps {
  return {
    // Perezoso: el registro arrastra lo de publicar (y sus crates nativos).
    getBackend: async (projectId) => (await import("./registry")).getBackendByProject(projectId),
    getEnvironment,
    createEnvironment,
    markEnvironmentProvisioned,
    deleteEnvironment,
    credsOf: (rec, e) => ({ scope: e.scope, ref: rec.ref, password: decryptToken(rec.dbPasswordEncrypted) }),
    pendingMigrations,
    rehearse,
    applyPending,
    createLiveDatabase: async (o) => createLiveDatabase({ ...o, store: await blobStore() }),
    dropLiveDatabase: async (scope) => dropLiveDatabase(scope, await blobStore()),
    // Una conexión propia: el cerrojo dura lo que dura la publicación.
    withPublishLock: (ref, fn) =>
      withDedicatedAdmin("postgres", async (c) => {
        await c.query(`select pg_advisory_lock(hashtext($1))`, [`pages-publish:${ref}`]);
        try {
          return await fn();
        } finally {
          await c.query(`select pg_advisory_unlock(hashtext($1))`, [`pages-publish:${ref}`]).catch(() => {});
        }
      }),
  };
}

function failed(r: { migration: string; statement: string; error: { message: string; code?: string } }): DataChangesFailedError {
  return new DataChangesFailedError({
    kind: "failed",
    migration: r.migration,
    statement: r.statement,
    message: r.error.message,
    ...(r.error.code ? { code: r.error.code } : {}),
  });
}

export async function publishDataChanges(
  o: { projectId: string; mode: "owner" | "system"; confirmFingerprint?: string; copyDraftData?: boolean },
  deps: DataChangesDeps = realDataChangesDeps(),
): Promise<void> {
  const rec = await deps.getBackend(o.projectId);
  if (!rec) return;
  const draft = await deps.getEnvironment(o.projectId, "draft");
  if (!draft?.provisionedAt) return;
  await deps.withPublishLock(rec.ref, async () => {
    let live = await deps.getEnvironment(o.projectId, "live");
    let createdNow = false;
    if (!live?.provisionedAt) {
      if (o.mode === "system") throw new DataChangesNeedOwnerError();
      live = live ?? (await deps.createEnvironment(o.projectId, rec.ref, "live"));
      await deps.createLiveDatabase({ live: deps.credsOf(rec, live), draft: deps.credsOf(rec, draft), copyData: o.copyDraftData === true });
      createdNow = true;
    }
    const liveRec = live;
    try {
      const p = await deps.pendingMigrations(draft.scope, liveRec.scope);
      if (!p.ok) throw new DataChangesFailedError({ kind: "diverged", versions: p.diverged });
      if (p.pending.length > 0) {
        if (o.mode === "system") throw new DataChangesNeedOwnerError();
        const creds = deps.credsOf(rec, liveRec);
        const r = await deps.rehearse(creds, p.pending);
        if (!r.ok) throw failed(r);
        if (r.destructive.length > 0 && o.confirmFingerprint !== r.fingerprint) throw new DataChangesNeedConfirmationError(r.destructive, r.fingerprint);
        const a = await deps.applyPending(creds, p.pending, { backupTables: tablesToBackUp(r.destructive) });
        if (!a.ok) throw failed(a);
      }
      if (createdNow) await deps.markEnvironmentProvisioned(o.projectId, "live");
    } catch (err) {
      if (createdNow) {
        await deps.dropLiveDatabase(liveRec.scope).catch((e: unknown) => console.error("[publish] no se pudo deshacer producción", liveRec.scope, e));
        await deps.deleteEnvironment(o.projectId, "live").catch((e: unknown) => console.error("[publish] no se pudo borrar el entorno", e));
      }
      throw err;
    }
  });
}

/** Lo que publicar haría con los datos, sin hacerlo. Con `rehearse` ensaya en
 *  producción (lo usa `publish` de Len); sin él sólo nombra lo pendiente (lo
 *  usa el modal, que se abre a menudo y no debe bloquear tablas). */
export async function previewDataChanges(
  projectId: string,
  o: { rehearse: boolean },
  deps: Pick<DataChangesDeps, "getBackend" | "getEnvironment" | "credsOf" | "pendingMigrations" | "rehearse"> & {
    readRecordedMigrations(scope: string): Promise<RecordedMigration[]>;
  } = { ...realDataChangesDeps(), readRecordedMigrations },
): Promise<DataChangesPreview> {
  const rec = await deps.getBackend(projectId);
  if (!rec) return { kind: "none" };
  const draft = await deps.getEnvironment(projectId, "draft");
  if (!draft?.provisionedAt) return { kind: "none" };
  const live = await deps.getEnvironment(projectId, "live");
  if (!live?.provisionedAt) return { kind: "first_publish", migrations: (await deps.readRecordedMigrations(draft.scope)).map(migrationLabel) };
  const p = await deps.pendingMigrations(draft.scope, live.scope);
  if (!p.ok) return { kind: "diverged", versions: p.diverged };
  if (p.pending.length === 0) return { kind: "none" };
  const migrations = p.pending.map(migrationLabel);
  if (!o.rehearse) return { kind: "pending", migrations, destructive: null };
  const r = await deps.rehearse(deps.credsOf(rec, live), p.pending);
  if (!r.ok) return { kind: "failed", migration: r.migration, statement: r.statement, message: r.error.message };
  return { kind: "pending", migrations, destructive: r.destructive };
}

/** El error de publicar los datos, como lo contesta la ruta. */
export function dataChangesErrorBody(err: unknown): { status: number; body: Record<string, unknown> } | null {
  if (err instanceof DataChangesNeedConfirmationError) {
    return { status: 428, body: { error: "confirmation_required", destructive: err.destructive, fingerprint: err.fingerprint } };
  }
  if (err instanceof DataChangesFailedError) {
    return err.detail.kind === "diverged"
      ? { status: 422, body: { error: "migrations_diverged", versions: err.detail.versions } }
      : { status: 422, body: { error: "migration_failed", migration: err.detail.migration, statement: err.detail.statement, message: err.detail.message } };
  }
  return null;
}
