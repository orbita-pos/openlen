// EL SERVICE WORKER NO ATRAPA A NADIE (pieza 9 de Len 2.5).
//
// Un service worker vive en el navegador del visitante y le sirve la página de
// su caché hasta que el navegador encuentra uno NUEVO en la misma ruta. Si el
// sitio lo quita, esa ruta contesta la home en HTML (`try_files` del
// Caddyfile), la actualización falla y el viejo se queda sirviendo la versión
// vieja para siempre. Pasa igual si el dueño vuelve atrás a una release sin él,
// o si suelta el subdominio y otro lo reclama: el service worker del dueño
// anterior seguiría pintando su página en el sitio del nuevo.
//
// Por eso, donde el sitio no trae el suyo, se publica éste: se instala sin
// esperar, borra las cachés, se da de baja y recarga las pestañas abiertas. Es
// el patrón de siempre para retirar un service worker; escrito aquí, no copiado.

import { isPublishableFolderPath } from "@/lib/agent/ficheros/folder";

export const SELF_UNREGISTERING_SW = `// This site no longer uses a service worker: this one removes itself and its caches.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
  })());
});
`;

const REGISTER = /serviceWorker\s*\.\s*register\s*\(\s*(["'`])([^"'`]+)\1/g;

/** Las rutas del árbol de la release (sin barra) donde puede vivir un service
 *  worker del sitio: `sw.js` siempre —es donde lo pone casi todo el mundo— y
 *  cada `serviceWorker.register("…")` con una ruta literal del propio sitio
 *  (en una página o en un .js). */
export function serviceWorkerPaths(files: ReadonlyArray<{ path: string; content: string }>): string[] {
  const paths = new Set<string>(["sw.js"]);
  for (const f of files) {
    if (!/\.(?:html|m?js)$/i.test(f.path)) continue;
    for (const m of f.content.matchAll(REGISTER)) {
      const raw = m[2]!.trim();
      // Otro origen (`https:`, `//cdn…`): no es de este sitio.
      if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(raw)) continue;
      // Una ruta relativa se resuelve, como en el navegador, contra la página
      // que la registra; desde un .js no se sabe qué página lo carga y se toma
      // la raíz, que es donde lo pone casi todo el mundo.
      const base = /\.html$/i.test(f.path) ? `https://sitio/${f.path}` : "https://sitio/";
      let path: string;
      try {
        path = decodeURIComponent(new URL(raw, base).pathname);
      } catch {
        continue;
      }
      if (/\.m?js$/i.test(path) && isPublishableFolderPath(path)) paths.add(path.slice(1));
    }
  }
  return [...paths].sort();
}
