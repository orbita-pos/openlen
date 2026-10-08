// lib/apps/entorno.ts — lo que vale `import.meta.env` en una app: la URL de su
// backend y su clave PUBLICABLE, con los nombres que escribe por reflejo
// cualquier modelo que haya visto un proyecto de Vite + Supabase.
//
// 🔴 SÓLO LO PÚBLICO. Esto acaba DENTRO del JavaScript que se sirve a cada
// visitante. La clave publicable está hecha para ir en la página (la dice el
// manual de Len); la secreta, el JWT y la contraseña de la base, nunca.
//
// No CREA el backend: si el proyecto aún no tiene, `import.meta.env` lleva sólo
// MODE/DEV/PROD (los pone el compilador) y el código que lo necesite lo dirá.

import "server-only";

import { getBackendByProject, projectUrl } from "@/lib/backend/registry";

export async function entornoPublicoDeLaApp(projectId: string): Promise<Record<string, string>> {
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
