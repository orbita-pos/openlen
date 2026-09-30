// ¿Genera Tailwind CSS para esta clase? — contestado por el COMPILADOR, no por
// una lista.
//
// POR QUÉ ASÍ. Los diagnósticos de Claude Code salen de un compilador (el LSP
// del proyecto): no adivinan qué es válido, preguntan a la herramienta que lo
// decide. Aquí esa herramienta existe: la publicación compila Tailwind v3 con el
// paquete `tailwindcss` (`lib/publish/optimize-html.ts`), así que se le pregunta
// a él. `getClassOrder` es la API síncrona con la que el plugin oficial de
// Prettier ordena clases: devuelve `null` para la que Tailwind no conoce.
// Probado el 2026-09-29: `open`, `show`, `active` y `scrolled` → null;
// `hidden`, `dark`, `group`, `rotate-180` y `bg-brand` (con `brand` en el
// `theme.extend` de la página) → conocidas.
//
// Una lista escrita a mano de prefijos de Tailwind se equivocaría por los dos
// lados y caducaría en silencio con cada versión.
//
// COSTE. Crear el contexto tarda ~0,5 s la primera vez; después cada consulta
// son milisegundos. Se guarda uno por `theme.extend` distinto, y casi todas las
// páginas no traen ninguno. Sólo se llega aquí cuando el script pone una clase
// que ni el CSS de la página ni el propio script usan: lo normal es no llegar.

import * as setupContextUtils from "tailwindcss/lib/lib/setupContextUtils";
import type { ContextoTailwind } from "tailwindcss/lib/lib/setupContextUtils";
import * as resolveConfigModulo from "tailwindcss/lib/public/resolve-config";

// Los dos ficheros son de DENTRO del paquete y los carga el propio Tailwind, así
// que van al build de producción con él (la publicación ya lo usa). La entrada
// pública `tailwindcss/resolveConfig` no: el standalone no la traía.
//
// Webpack y Node exponen distinto un módulo CommonJS importado entero: uno trae
// las funciones arriba y el otro dentro de `default`.
const modulo = setupContextUtils as unknown as {
  createContext?: typeof setupContextUtils.createContext;
  default?: { createContext?: typeof setupContextUtils.createContext };
};
const createContext = modulo.createContext ?? modulo.default?.createContext;
type ResolveConfig = (config: unknown) => unknown;
const rc = resolveConfigModulo as unknown as { default?: ResolveConfig | { default?: ResolveConfig } };
const resolveConfig: ResolveConfig | undefined = typeof rc.default === "function" ? rc.default : rc.default?.default;

const MAX_CONTEXTOS = 8;
const contextos = new Map<string, ContextoTailwind>();

function contextoPara(extend: Record<string, unknown> | null): ContextoTailwind {
  const clave = JSON.stringify(extend ?? {});
  const guardado = contextos.get(clave);
  if (guardado) return guardado;
  if (!createContext || !resolveConfig) throw new Error("tailwindcss: no se encontró su compilador");
  const ctx = createContext(
    resolveConfig({
      content: [],
      theme: { extend: extend ?? {} },
      // Sin preflight: no hace falta para saber qué clases existen, y es lo
      // único que lee un fichero `.css` del paquete (el que Next en Windows
      // no encuentra en desarrollo, ver `optimize-html.ts`).
      corePlugins: { preflight: false },
    }),
  );
  if (contextos.size >= MAX_CONTEXTOS) contextos.delete(contextos.keys().next().value as string);
  contextos.set(clave, ctx);
  return ctx;
}

/**
 * Las clases de la lista para las que Tailwind v3 genera CSS con el
 * `theme.extend` de la página.
 *
 * Lanza si el compilador no carga: quien pregunta es un diagnóstico, y un
 * diagnóstico que no sabe contestar calla (ver `css-wiring.ts`).
 */
export function clasesQueConoceTailwind(
  clases: readonly string[],
  extend: Record<string, unknown> | null,
): Set<string> {
  if (clases.length === 0) return new Set();
  const conocidas = new Set<string>();
  for (const [clase, orden] of contextoPara(extend).getClassOrder([...clases])) {
    if (orden !== null) conocidas.add(clase);
  }
  return conocidas;
}
