// lib/apps/entorno.ts — lo que vale `import.meta.env` en una app, por entorno:
// las variables del dueño («Variables de entorno», lib/apps/env/) y, ENCIMA, la
// URL de su backend y su clave PUBLICABLE, con los nombres que escribe por
// reflejo cualquier modelo que haya visto un proyecto de Vite + Supabase. Lo de
// `/.env` no está aquí: lo mezcla el compilador, que tiene los ficheros, por
// DEBAJO de esto (el orden de Vite: el entorno del proceso gana al fichero).
//
// 🔴 SÓLO LO PÚBLICO. Esto acaba DENTRO del JavaScript que se sirve a cada
// visitante. La clave publicable está hecha para ir en la página (la dice el
// manual de Len); la secreta, el JWT y la contraseña de la base, nunca. Las del
// dueño también son públicas, y el diálogo y la ruta lo dicen.
//
// `production` es SÓLO publicar (`publishProject`); el lienzo, los ojos de Len,
// la terminal y la miniatura son `draft`.
//
// No CREA el backend: si el proyecto aún no tiene, no hay URL ni clave y el
// código que las necesite lo dirá.

import "server-only";

import { getBackendByProject, projectUrl } from "@/lib/backend/registry";
import type { EnvTarget } from "@/lib/apps/env/rules";
import { envVarsFor } from "@/lib/apps/env/store";

/** Lo que pone OpenLen (los nombres de `PLATFORM_ENV_NAMES`). Vacío sin backend. */
export async function platformEnv(projectId: string): Promise<Record<string, string>> {
  const backend = await getBackendByProject(projectId).catch(() => null);
  if (!backend) return {};
  const url = projectUrl(backend.ref);
  return {
    VITE_SUPABASE_URL: url,
    VITE_SUPABASE_PUBLISHABLE_KEY: backend.publishableKey,
    // El nombre de antes de las claves publicables, que los modelos siguen
    // escribiendo: es la MISMA clave pública.
    VITE_SUPABASE_ANON_KEY: backend.publishableKey,
  };
}

/** `own`: las del dueño ya leídas. La publicación las lee una vez para apuntar
 *  su huella, y lo que va al paquete es exactamente eso. */
export async function entornoPublicoDeLaApp(
  projectId: string,
  target: EnvTarget,
  own?: Readonly<Record<string, string>>,
): Promise<Record<string, string>> {
  const [mine, platform] = await Promise.all([own ?? envVarsFor(projectId, target), platformEnv(projectId)]);
  return { ...mine, ...platform };
}
