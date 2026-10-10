// Borrar un proyecto se lleva los ficheros de su Storage, como ya se lleva su
// base (lib/backend/teardown.ts, que llama a esto DESPUÉS de borrar el
// proyecto). Lo de cada entorno vive bajo `<scope>/` en el almacén (el de
// antes, bajo `<ref>/`: su scope es el ref).

import type { BlobStore } from "./blob-store";
import { pageBlobStore } from "./r2-blob-store";

// El scope de un entorno (lib/backend/environments.ts).
const SCOPE_RE = /^[a-z]{20}(_[dl])?$/;

/** Nunca lanza: el proyecto ya no existe, y lo que quede se ve en el bucket
 *  bajo su `scope`. Sin R2 configurado no toca la red (por aquí pasan también
 *  los proyectos de usar y tirar de Len-Bench y las pruebas). */
export async function purgeProjectStorage(scope: string, store: BlobStore | null = pageBlobStore()): Promise<void> {
  if (!store || !SCOPE_RE.test(scope)) return;
  try {
    await store.deletePrefix(`${scope}/`);
  } catch (err) {
    console.error("[storage] no se pudieron borrar los ficheros del proyecto", scope, err);
  }
}
