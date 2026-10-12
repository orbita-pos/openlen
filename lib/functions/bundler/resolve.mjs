// lib/functions/bundler/resolve.mjs — DE UN IMPORT DE SUPABASE AL CATÁLOGO
// (spec local 2026-10-11, Parte 1). JS puro, sin dependencias: lo usa el hilo
// del empaquetador (lib/apps/bundler/bundler-worker.mjs), que se carga por ruta
// y no pasa por TypeScript, y lo importan las pruebas y el TS por su `.d.mts`.
//
// Lo que Len escribe es lo que ha visto en los ejemplos de Supabase:
//   npm:stripe@14 · jsr:@supabase/supabase-js@2 · https://esm.sh/stripe@11?target=deno
//   https://deno.land/std@0.168.0/http/server.ts · node:crypto
// y, como OpenLen se adapta a Len, también el nombre suelto (`stripe`).

/** El `serve` de deno.land/std: lo da el envoltorio, sobre `Deno.serve`. */
export const STD_HTTP_SERVER = "openlen:std-http-server";
/** `@supabase/functions-js/edge-runtime.d.ts`: sólo tipos, un módulo vacío. */
export const TYPES_ONLY = "openlen:types-only";

const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "crypto", "dns", "events", "fs", "http", "https", "net", "os",
  "path", "perf_hooks", "process", "querystring", "readline", "stream", "string_decoder", "timers", "tls", "url", "util",
  "worker_threads", "zlib",
]);

/** `@scope/name@range/sub` | `name@range/sub` | `name` → sus partes, o null. */
function parsePackage(rest) {
  const m = /^((?:@[^/@]+\/)?[^/@?#]+)(?:@([^/?#]+))?(\/[^?#]*)?$/.exec(rest);
  if (!m) return null;
  return { name: m[1], range: m[2] ?? null, subpath: m[3] ?? "" };
}

/** El mayor de un rango (`^14.2`, `~14`, `14`, `14.2.0`), o null (`latest`, `>=14`…). */
function majorOf(range) {
  const m = /^[\^~]?v?(\d+)/.exec(range ?? "");
  return m ? Number(m[1]) : null;
}

function lista(catalog) {
  return catalog.dependencies.map((d) => `npm:${d.name}`).join(", ");
}

function noEsta(catalog, specifier) {
  return {
    kind: "error",
    message: `"${specifier}" isn't in this project's Edge Functions catalog. Import one of: ${lista(catalog)} (any version resolves to the catalog's).`,
  };
}

export function applyImportMap(imports, specifier) {
  if (!imports) return specifier;
  if (Object.hasOwn(imports, specifier)) return imports[specifier];
  let best = null;
  for (const key of Object.keys(imports)) {
    if (key.endsWith("/") && specifier.startsWith(key) && (best === null || key.length > best.length)) best = key;
  }
  return best === null ? specifier : imports[best] + specifier.slice(best.length);
}

export function resolveSpecifier(catalog, specifier) {
  if (specifier.startsWith("node:")) return { kind: "node", id: specifier };
  if (NODE_BUILTINS.has(specifier)) {
    return { kind: "error", message: `"${specifier}" is a Node built-in: import it as "node:${specifier}".` };
  }
  if (/^https:\/\/deno\.land\/std(@[^/]+)?\/http\/server\.ts$/.test(specifier)) return { kind: "runtime", id: STD_HTTP_SERVER };

  let rest = null;
  let scheme = "npm";
  if (specifier.startsWith("npm:")) rest = specifier.slice(4);
  else if (specifier.startsWith("jsr:")) {
    rest = specifier.slice(4);
    scheme = "jsr";
  } else if (specifier.startsWith("https://esm.sh/")) {
    rest = specifier.slice("https://esm.sh/".length).replace(/^v\d+\//, "").replace(/[?#].*$/, "");
  } else if (/^https?:\/\//.test(specifier)) return noEsta(catalog, specifier);
  else rest = specifier;

  const p = parsePackage(rest);
  if (!p) return noEsta(catalog, specifier);
  if (p.subpath.endsWith(".d.ts")) return { kind: "runtime", id: TYPES_ONLY };
  const dep = catalog.dependencies.find((d) => d.name === p.name);
  if (!dep) return noEsta(catalog, specifier);
  if (p.subpath !== "") {
    return { kind: "error", message: `Only the main entry of ${dep.name} is available here: import from "npm:${dep.name}".` };
  }
  const pedido = majorOf(p.range);
  const congelado = majorOf(dep.version);
  const warning =
    pedido !== null && pedido !== congelado
      ? `${scheme}:${dep.name}@${p.range} resolves to ${dep.name} ${dep.version}, the version in this project's Edge Functions catalog.`
      : null;
  return { kind: "catalog", name: dep.name, file: dep.file, warning };
}
