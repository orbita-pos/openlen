// Borrar un proyecto se lleva los ficheros de su Storage, como ya se lleva su
// base (lib/backend/teardown.ts, que llama a esto DESPUÉS de borrar el
// proyecto). Todo lo del proyecto vive bajo `<ref>/` en el almacén.

import type { BlobStore } from "./blob-store";
import { pageBlobStore } from "./r2-blob-store";

const REF_RE = /^[a-z]{20}$/;

/** Nunca lanza: el proyecto ya no existe, y lo que quede se ve en el bucket
 *  bajo su `ref`. Sin R2 configurado no toca la red (por aquí pasan también
 *  los proyectos de usar y tirar de Len-Bench y las pruebas). */
export async function purgeProjectStorage(ref: string, store: BlobStore | null = pageBlobStore()): Promise<void> {
  if (!store || !REF_RE.test(ref)) return;
  try {
    await store.deletePrefix(`${ref}/`);
  } catch (err) {
    console.error("[storage] no se pudieron borrar los ficheros del proyecto", ref, err);
  }
}
