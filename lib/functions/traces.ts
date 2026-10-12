// lib/functions/traces.ts — DÓNDE NACIÓ UN ERROR DE UNA FUNCIÓN, en el fichero de
// Len (spec local 2026-10-11, Parte 1). La traza de Node apunta al paquete
// (`…/index.mjs:2:9`, `…/chunks/x.mjs`); su sourcemap la devuelve a
// `supabase/functions/<nombre>/index.ts:L:C`, como `lib/ai/sitio-del-error.ts`
// hace con las apps. Lo del catálogo, el envoltorio y Node no es de Len: fuera.
// Puro.

import { traductorDeMapas, type SitioDelError } from "@/lib/ai/sitio-del-error";

/** `    at fn (file:///…/chunks/x.mjs:L:C)` · `    at file:///…/index.mjs:L:C` */
const MARCO = /^(\s*at\s+)(?:(.+?)\s+\()?(?:file:\/\/)?[^\s()]*?\/((?:chunks\/)?[\w.$-]+\.mjs):(\d+):(\d+)\)?\s*$/;
const ES_MARCO = /^\s*at\s/;

function traductor(maps: Readonly<Record<string, string>>) {
  const t = traductorDeMapas(Object.fromEntries(Object.entries(maps).map(([k, v]) => [`/${k}`, v])));
  return (fichero: string, linea: number, columna: number): SitioDelError | null => {
    if (!t || !Object.hasOwn(maps, fichero)) return null;
    const r = t({ ruta: `/${fichero}`, linea, columna });
    return r && r !== "vendor" && r.ruta.startsWith("/supabase/") ? r : null;
  };
}

export function translateStack(stack: string, maps: Readonly<Record<string, string>>): string {
  const traducir = traductor(maps);
  const out: string[] = [];
  for (const linea of stack.split("\n")) {
    if (!ES_MARCO.test(linea)) {
      out.push(linea);
      continue;
    }
    const m = MARCO.exec(linea);
    if (!m) continue;
    const sitio = traducir(m[3]!, Number(m[4]), Number(m[5]));
    if (!sitio) continue;
    const donde = `${sitio.ruta.slice(1)}:${sitio.linea}:${sitio.columna}`;
    out.push(m[2] ? `${m[1]}${m[2]} (${donde})` : `${m[1]}${donde}`);
  }
  return out.join("\n");
}

export function firstProjectSite(stack: string, maps: Readonly<Record<string, string>>): SitioDelError | null {
  const traducir = traductor(maps);
  for (const linea of stack.split("\n")) {
    const m = MARCO.exec(linea);
    if (!m) continue;
    const sitio = traducir(m[3]!, Number(m[4]), Number(m[5]));
    if (sitio) return sitio;
  }
  return null;
}
