// PRODUCCIÓN NACE AL PUBLICAR (spec local 2026-10-09, 6.3): vacía —las tablas
// las ponen después las migraciones del borrador, por el camino de siempre— o,
// si el dueño marcó «Copiar también los datos de prueba», como copia EXACTA del
// borrador (`CREATE DATABASE … TEMPLATE`), con usuarios y ficheros. El rol de
// desarrollador es el mismo en las dos (uno por proyecto), así que la copia
// conserva dueños y permisos.

import "server-only";

import { dbNameOf, type ScopeCreds } from "./environments";
import { closePools, withAdmin } from "./pg";
import { devRoleOf, dropProjectDatabase, provisionDatabase } from "./provision";
import { ensureRealtimeProvisioned, forgetRealtimeProvisioned } from "./realtime/provision";
import { blobKey, type BlobStore } from "./storage/blob-store";
import { purgeProjectStorage } from "./storage/purge";
import { ensureStorageProvisioned, forgetStorageProvisioned } from "./storage/provision";

export async function createLiveDatabase(o: { live: ScopeCreds; draft: ScopeCreds; copyData: boolean; store: BlobStore | null }): Promise<void> {
  const scoped = { scope: o.live.scope, ref: o.live.ref };
  if (!o.copyData) {
    await provisionDatabase({ ...scoped, dbPassword: o.live.password });
    await ensureStorageProvisioned(scoped);
    await ensureRealtimeProvisioned(scoped);
    return;
  }
  const liveDb = dbNameOf(o.live.scope);
  const draftDb = dbNameOf(o.draft.scope);
  const dev = devRoleOf(o.live.ref);
  // TEMPLATE exige que nadie esté conectado al borrador: los pools de este
  // proceso se cierran y las conexiones de los demás se cortan (es el borrador;
  // se reconectan solas).
  await closePools(draftDb);
  await withAdmin("postgres", async (r) => {
    await r.query(`select pg_advisory_lock(hashtext($1))`, [`pages-backend:${o.live.scope}`]);
    try {
      await r.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [draftDb]);
      await r.exec(`create database ${liveDb} template ${draftDb};`);
      // Los permisos de la BASE no viajan con TEMPLATE (los de dentro, sí).
      await r.exec(
        `revoke connect on database ${liveDb} from public; grant connect on database ${liveDb} to ${dev}, authenticator; grant create on database ${liveDb} to ${dev};`,
      );
    } finally {
      await r.query(`select pg_advisory_unlock(hashtext($1))`, [`pages-backend:${o.live.scope}`]);
    }
  });
  // Las sesiones de prueba no pasan a producción.
  await withAdmin(liveDb, (r) => r.exec(`delete from auth.refresh_tokens; delete from auth.sessions;`));
  forgetStorageProvisioned(o.live.scope);
  forgetRealtimeProvisioned(o.live.scope);
  await ensureStorageProvisioned(scoped);
  await ensureRealtimeProvisioned(scoped);
  if (o.store) {
    const { rows } = await withAdmin(liveDb, (r) => r.query(`select bucket_id, name, version from storage.objects where version is not null`));
    for (const row of rows) {
      const [b, n, v] = [String(row.bucket_id), String(row.name), String(row.version)];
      await o.store.copy(blobKey(o.draft.scope, b, n, v), blobKey(o.live.scope, b, n, v));
    }
  }
}

/** Deshacer un nacimiento que no llegó a publicarse: la base y sus ficheros.
 *  Sin `store`, el almacén del entorno; con `null`, ninguno (no toca la red). */
export async function dropLiveDatabase(scope: string, store?: BlobStore | null): Promise<void> {
  await dropProjectDatabase(scope);
  forgetStorageProvisioned(scope);
  forgetRealtimeProvisioned(scope);
  if (store === undefined) await purgeProjectStorage(scope);
  else await purgeProjectStorage(scope, store);
}
