// LAS VARIABLES DE ENTORNO DE UNA APP (spec local
// docs/superpowers/specs/2026-10-10-variables-de-entorno-design.md): qué nombre
// vale, cuáles pone OpenLen, cuánto cabe y qué le falta a una lista. Sin
// dependencias pesadas: lo importan el diálogo, la ruta, la carpeta y el
// compilador.
//
// TODO lo de aquí es PÚBLICO —acaba en el JavaScript que se sirve—. Por eso sólo
// nombres `VITE_*` (el `envPrefix` de Vite) y el aviso de «parece un secreto».
import { detectSecret, type SecretKind } from "./secret-patterns";

export type EnvTarget = "draft" | "production";
export const ENV_TARGETS: readonly EnvTarget[] = ["draft", "production"];

/** El único fichero de entorno que se lee, como el `.env` de Vite. */
export const DOTENV_PATH = "/.env";

export const ENV_NAME_RE = /^VITE_[A-Za-z0-9_]+$/;
export const MAX_ENV_NAME_LENGTH = 100;
export const MAX_ENV_VALUE_BYTES = 4096;
export const MAX_ENV_NAMES = 100;
export const MAX_DOTENV_BYTES = 16 * 1024;

/** Los que pone OpenLen (`lib/apps/entorno.ts`): ni el ajuste ni `/.env` los cambian. */
export const PLATFORM_ENV_NAMES = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY"] as const;

export function isPlatformEnvName(name: string): boolean {
  return (PLATFORM_ENV_NAMES as readonly string[]).includes(name);
}

export function isEnvTarget(x: unknown): x is EnvTarget {
  return x === "draft" || x === "production";
}

export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Lo que se guarda de un valor: sin `\r` y sin espacios ni saltos en los
 *  extremos. Un valor copiado de un panel suele traer un salto al final, y la
 *  clave dejaría de valer sin que nada lo dijera. */
export function normalizeEnvValue(value: string): string {
  return value.replace(/\r/g, "").trim();
}

/** Prefijos de otros frameworks que significan lo mismo que `VITE_`. */
const FOREIGN_PUBLIC_PREFIXES = ["NEXT_PUBLIC_", "EXPO_PUBLIC_", "REACT_APP_", "VUE_APP_", "PUBLIC_", "VITE_"];

/** «¿Querías decir VITE_X?»: el nombre válido más parecido, o `null` si ya vale o no queda nada. */
export function suggestEnvName(raw: string): string | null {
  const trimmed = raw.trim();
  if (ENV_NAME_RE.test(trimmed)) return null;
  let base = trimmed.toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/_+/g, "_");
  const prefix = FOREIGN_PUBLIC_PREFIXES.find((p) => base.startsWith(p));
  if (prefix) base = base.slice(prefix.length);
  base = base.replace(/^_+|_+$/g, "");
  if (!base || base === "VITE") return null;
  const name = `VITE_${base}`;
  return ENV_NAME_RE.test(name) && name.length <= MAX_ENV_NAME_LENGTH ? name : null;
}

export interface StoredEnvVar {
  readonly name: string;
  readonly target: EnvTarget;
  readonly value: string;
}

export interface EnvVarInput extends StoredEnvVar {
  /** El dueño leyó el aviso de «parece un secreto» y lo guarda igual. */
  readonly acknowledgedPublic?: boolean;
}

export type EnvVarProblem =
  | { readonly code: "name_format"; readonly name: string; readonly suggestion: string | null }
  | { readonly code: "name_too_long"; readonly name: string }
  | { readonly code: "reserved"; readonly name: string }
  | { readonly code: "duplicate"; readonly name: string; readonly target: EnvTarget }
  | { readonly code: "value_too_long"; readonly name: string }
  | { readonly code: "too_many"; readonly max: number }
  | { readonly code: "looks_like_secret"; readonly name: string; readonly kind: SecretKind };

const rowKey = (v: StoredEnvVar) => `${v.target}\u0000${v.name}\u0000${v.value}`;

/**
 * Lo que le falta a una lista para guardarse, en el orden de la lista. Un valor
 * que parece secreto sólo cuenta si es NUEVO o CAMBIÓ respecto de `previous`
 * (lo ya guardado se aceptó en su día) y no trae `acknowledgedPublic`.
 */
export function validateEnvVars(vars: readonly EnvVarInput[], previous: readonly StoredEnvVar[] = []): EnvVarProblem[] {
  const problems: EnvVarProblem[] = [];
  const seen = new Set<string>();
  const names = new Set<string>();
  const before = new Set(previous.map(rowKey));
  for (const v of vars) {
    names.add(v.name);
    if (v.name.length > MAX_ENV_NAME_LENGTH) problems.push({ code: "name_too_long", name: v.name });
    else if (!ENV_NAME_RE.test(v.name)) problems.push({ code: "name_format", name: v.name, suggestion: suggestEnvName(v.name) });
    else if (isPlatformEnvName(v.name)) problems.push({ code: "reserved", name: v.name });
    const slot = `${v.target}\u0000${v.name}`;
    if (seen.has(slot)) problems.push({ code: "duplicate", name: v.name, target: v.target });
    seen.add(slot);
    if (utf8Bytes(v.value) > MAX_ENV_VALUE_BYTES) problems.push({ code: "value_too_long", name: v.name });
    const kind = detectSecret(v.name, v.value);
    if (kind && !v.acknowledgedPublic && !before.has(rowKey(v))) problems.push({ code: "looks_like_secret", name: v.name, kind });
  }
  if (names.size > MAX_ENV_NAMES) problems.push({ code: "too_many", max: MAX_ENV_NAMES });
  return problems;
}

export interface EnvVarGroup {
  readonly name: string;
  readonly value: string;
  readonly targets: readonly EnvTarget[];
}

/** Las filas del ajuste como las pinta el diálogo: un nombre con el mismo valor
 *  en los dos entornos es UNA fila; con valores distintos, dos (borrador primero). */
export function groupEnvVars(vars: readonly StoredEnvVar[]): EnvVarGroup[] {
  const groups = new Map<string, { name: string; value: string; targets: EnvTarget[] }>();
  for (const v of vars) {
    const key = `${v.name}\u0000${v.value}`;
    const g = groups.get(key) ?? { name: v.name, value: v.value, targets: [] };
    g.targets.push(v.target);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ name: g.name, value: g.value, targets: ENV_TARGETS.filter((t) => g.targets.includes(t)) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.targets[0] === "draft" ? -1 : 1));
}

/** La lista ENTERA tras quitar `remove` (una fila del diálogo) y añadir cada
 *  línea en cada entorno marcado. Borrar es esto mismo sin líneas. */
export function applyGroupEdit(
  vars: readonly StoredEnvVar[],
  remove: EnvVarGroup | null,
  add: { readonly lines: readonly { readonly name: string; readonly value: string }[]; readonly targets: readonly EnvTarget[] },
): StoredEnvVar[] {
  const kept: StoredEnvVar[] = remove
    ? vars.filter((v) => !(v.name === remove.name && v.value === remove.value && remove.targets.includes(v.target)))
    : [...vars];
  for (const line of add.lines) {
    for (const target of add.targets) kept.push({ name: line.name.trim(), target, value: normalizeEnvValue(line.value) });
  }
  return kept;
}

/** El cuerpo del PUT de `/api/projects/[id]/env`, limpio, o `null` si no tiene esa forma. */
export function parseEnvVarsBody(raw: unknown): { version: string; vars: EnvVarInput[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const { version, vars } = raw as { version?: unknown; vars?: unknown };
  if (typeof version !== "string" || !Array.isArray(vars) || vars.length > MAX_ENV_NAMES * ENV_TARGETS.length) return null;
  const out: EnvVarInput[] = [];
  for (const item of vars) {
    if (!item || typeof item !== "object") return null;
    const { name, target, value, acknowledgedPublic } = item as Record<string, unknown>;
    if (typeof name !== "string" || typeof value !== "string" || !isEnvTarget(target)) return null;
    out.push({ name: name.trim(), target, value: normalizeEnvValue(value), ...(acknowledgedPublic === true ? { acknowledgedPublic: true } : {}) });
  }
  return { version, vars: out };
}
