// lib/functions/project-files.ts — QUÉ FUNCIONES HAY EN LA CARPETA DEL PROYECTO
// (spec local 2026-10-11, Parte 1), con las convenciones de Supabase: una
// carpeta por función en /supabase/functions/, las que empiezan por `_` son
// compartidas, la entrada es index.ts (o la de `entrypoint` en config.toml), y
// el mapa de imports es el deno.json de la función, el `import_map` de
// config.toml o el import_map.json común. Puro.

import { readFunctionsToml, type FunctionTomlConfig } from "./config-toml";

export const FUNCTIONS_DIR = "/supabase/functions/";
export const CONFIG_TOML = "/supabase/config.toml";
export const MAX_FUNCTIONS = 25;
/** El de la CLI de Supabase. */
export const FUNCTION_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const ENTRADAS = ["index.ts", "index.js", "index.tsx", "index.jsx", "index.mjs"] as const;
const MAPA_COMUN = `${FUNCTIONS_DIR}import_map.json`;

export interface FunctionSpec {
  readonly name: string;
  /** Ruta absoluta del fichero de entrada: /supabase/functions/<nombre>/index.ts. */
  readonly entry: string;
  readonly verifyJwt: boolean;
  readonly importMap: Readonly<Record<string, string>> | null;
}

export interface LayoutError {
  readonly path: string;
  readonly line: number | null;
  readonly message: string;
}

export type FunctionsLayout =
  | { readonly ok: true; readonly functions: readonly FunctionSpec[]; readonly sharedImportMap: Readonly<Record<string, string>> | null }
  | { readonly ok: false; readonly errors: readonly LayoutError[] };

export function isFunctionsInputPath(path: string): boolean {
  return path.startsWith(FUNCTIONS_DIR) || path === CONFIG_TOML;
}

export function functionDirOf(name: string): string {
  return `${FUNCTIONS_DIR}${name}/`;
}

/** Los nombres de las carpetas de función (sin las `_` ni las de punto), ordenados. */
export function functionNamesIn(files: Readonly<Record<string, string>>): string[] {
  const nombres = new Set<string>();
  for (const ruta of Object.keys(files)) {
    if (!ruta.startsWith(FUNCTIONS_DIR)) continue;
    const partes = ruta.slice(FUNCTIONS_DIR.length).split("/");
    if (partes.length < 2) continue;
    const n = partes[0]!;
    if (n === "" || n.startsWith("_") || n.startsWith(".")) continue;
    nombres.add(n);
  }
  return [...nombres].sort();
}

/** `./functions/x/main.ts` (relativo a /supabase/) → `/supabase/functions/x/main.ts`. */
function desdeSupabase(rel: string): string {
  const partes: string[] = [];
  for (const p of `supabase/${rel.replace(/^\.\//, "")}`.split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") partes.pop();
    else partes.push(p);
  }
  return `/${partes.join("/")}`;
}

function leerMapa(files: Readonly<Record<string, string>>, ruta: string, errors: LayoutError[]): Record<string, string> | null {
  const texto = files[ruta];
  if (texto === undefined) return null;
  try {
    const json = JSON.parse(texto) as { imports?: unknown };
    const imports = json.imports;
    if (imports === undefined) return null;
    if (typeof imports !== "object" || imports === null || Object.values(imports).some((v) => typeof v !== "string")) {
      errors.push({ path: ruta, line: null, message: `${ruta.slice(1)}: "imports" must map names to strings.` });
      return null;
    }
    return imports as Record<string, string>;
  } catch (e) {
    errors.push({ path: ruta, line: null, message: `${ruta.slice(1)} is not valid JSON: ${e instanceof Error ? e.message : String(e)}` });
    return null;
  }
}

export function readFunctionsLayout(files: Readonly<Record<string, string>>): FunctionsLayout {
  const errors: LayoutError[] = [];
  let config: Record<string, FunctionTomlConfig> = {};
  const toml = files[CONFIG_TOML];
  if (toml !== undefined) {
    const r = readFunctionsToml(toml);
    if (!r.ok) errors.push({ path: CONFIG_TOML, line: r.line, message: r.message });
    else config = r.functions;
  }
  const nombres = functionNamesIn(files);
  if (nombres.length > MAX_FUNCTIONS) {
    return { ok: false, errors: [{ path: FUNCTIONS_DIR, line: null, message: `This project has ${nombres.length} Edge Functions; the limit is ${MAX_FUNCTIONS}.` }] };
  }
  const comun = leerMapa(files, MAPA_COMUN, errors);
  const functions: FunctionSpec[] = [];
  for (const name of nombres) {
    const dir = functionDirOf(name);
    if (!FUNCTION_NAME_RE.test(name)) {
      errors.push({
        path: dir,
        line: null,
        message: `Invalid Function name: ${name}. Must start with at least one letter, and only include alphanumeric characters, underscores, and hyphens. (^[A-Za-z][A-Za-z0-9_-]*$)`,
      });
      continue;
    }
    const c = config[name] ?? {};
    const entry = c.entrypoint ? desdeSupabase(c.entrypoint) : ENTRADAS.map((f) => dir + f).find((r) => Object.hasOwn(files, r));
    if (!entry || !Object.hasOwn(files, entry)) {
      errors.push({ path: dir, line: null, message: `Function ${name} has no entrypoint: write supabase/functions/${name}/index.ts.` });
      continue;
    }
    const propio =
      leerMapa(files, `${dir}deno.json`, errors) ??
      leerMapa(files, `${dir}deno.jsonc`, errors) ??
      (c.import_map ? leerMapa(files, desdeSupabase(c.import_map), errors) : null);
    functions.push({ name, entry, verifyJwt: c.verify_jwt ?? true, importMap: propio ?? comun });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, functions, sharedImportMap: comun };
}
