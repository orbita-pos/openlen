// lib/functions/config-toml.ts — LO QUE LAS FUNCIONES LEEN DE supabase/config.toml
// (spec local 2026-10-11, Parte 1): `[functions.<nombre>]` con `verify_jwt`,
// `import_map` y `entrypoint`, como la CLI de Supabase. El resto del fichero
// (api, db, auth…) es de Supabase y aquí no se mira: un lector de TOML entero
// sería una dependencia para tres claves. Puro.

export interface FunctionTomlConfig {
  verify_jwt?: boolean;
  import_map?: string;
  entrypoint?: string;
}

export type TomlRead =
  | { readonly ok: true; readonly functions: Record<string, FunctionTomlConfig> }
  | { readonly ok: false; readonly line: number; readonly message: string };

const SECCION = /^\[\s*([^\]]+?)\s*\]\s*(?:#.*)?$/;
const CLAVE = /^(verify_jwt|import_map|entrypoint)\s*=\s*(.+?)\s*$/;

/** Un valor TOML de los que usamos: booleano o cadena, sin el comentario de detrás. */
function valor(crudo: string): boolean | string | null {
  const m = /^(true|false)\b/.exec(crudo);
  if (m) return m[1] === "true";
  const c = /^"((?:[^"\\]|\\.)*)"|^'([^']*)'/.exec(crudo);
  if (c) return c[1] !== undefined ? c[1].replace(/\\(["\\])/g, "$1") : c[2]!;
  return null;
}

export function readFunctionsToml(text: string): TomlRead {
  const functions: Record<string, FunctionTomlConfig> = {};
  let actual: string | null = null;
  const lineas = text.split(/\r?\n/);
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i]!.trim();
    if (linea === "" || linea.startsWith("#")) continue;
    const s = SECCION.exec(linea);
    if (s && !linea.startsWith("[[")) {
      const m = /^functions\.(?:"([^"]+)"|([A-Za-z0-9_-]+))$/.exec(s[1]!);
      actual = m ? (m[1] ?? m[2])! : null;
      if (actual !== null) functions[actual] ??= {};
      continue;
    }
    if (actual === null) continue;
    const k = CLAVE.exec(linea);
    if (!k) continue;
    const clave = k[1] as keyof FunctionTomlConfig;
    const v = valor(k[2]!);
    if (clave === "verify_jwt") {
      if (typeof v !== "boolean") return { ok: false, line: i + 1, message: `supabase/config.toml line ${i + 1}: verify_jwt must be true or false.` };
      functions[actual]!.verify_jwt = v;
    } else {
      if (typeof v !== "string") return { ok: false, line: i + 1, message: `supabase/config.toml line ${i + 1}: ${clave} must be a string.` };
      functions[actual]![clave] = v;
    }
  }
  return { ok: true, functions };
}
