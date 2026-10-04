// Lo que PostgREST guarda en su «schema cache», leído del catálogo de Postgres
// en cada petición (la base de un proyecto es pequeña y cambia con cada
// migración de Len: una caché que invalidar sería otra cosa que se desfasa).
// Sólo el catálogo (`pg_catalog`), que cualquier rol puede leer.

import type { TxQuery } from "../db";

export interface ColumnInfo {
  readonly name: string;
  /** `format_type`: el tipo tal como se escribe en SQL («numeric», «text[]»). */
  readonly type: string;
  readonly default: string | null;
  readonly nullable: boolean;
}

export interface TableInfo {
  readonly schema: string;
  readonly name: string;
  readonly columns: readonly ColumnInfo[];
  readonly pk: readonly string[];
}

export async function findTable(q: TxQuery, schema: string, name: string): Promise<TableInfo | null> {
  const t = await q(
    `select c.oid::int8 as oid
       from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relname = $2 and c.relkind in ('r', 'v', 'm', 'f', 'p')`,
    [schema, name],
  );
  const oid = t.rows[0]?.oid;
  if (oid === undefined) return null;
  const cols = await q(
    `select a.attname as name,
            pg_catalog.format_type(a.atttypid, a.atttypmod) as type,
            pg_catalog.pg_get_expr(d.adbin, d.adrelid) as "default",
            not a.attnotnull as nullable
       from pg_catalog.pg_attribute a
       left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = $1::oid and a.attnum > 0 and not a.attisdropped
      order by a.attnum`,
    [String(oid)],
  );
  const pk = await q(
    `select a.attname as name
       from pg_catalog.pg_index i
       join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = $1::oid and i.indisprimary
      order by array_position(i.indkey::int2[], a.attnum)`,
    [String(oid)],
  );
  return {
    schema,
    name,
    columns: cols.rows.map((r) => ({
      name: String(r.name),
      type: String(r.type),
      default: r.default === null ? null : String(r.default),
      nullable: Boolean(r.nullable),
    })),
    pk: pk.rows.map((r) => String(r.name)),
  };
}

export async function listTableNames(q: TxQuery, schema: string): Promise<string[]> {
  const r = await q(
    `select c.relname as name
       from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relkind in ('r', 'v', 'm', 'f', 'p')`,
    [schema],
  );
  return r.rows.map((x) => String(x.name));
}

export interface FunctionParam {
  readonly name: string;
  readonly type: string;
  readonly hasDefault: boolean;
  readonly variadic: boolean;
}

export interface FunctionInfo {
  readonly schema: string;
  readonly name: string;
  readonly params: readonly FunctionParam[];
  readonly returnsSet: boolean;
  /** Ni compuesto ni `record` (las `returns table(…)`). */
  readonly returnsScalar: boolean;
  readonly returnsVoid: boolean;
  readonly volatility: "i" | "s" | "v";
}

export async function findFunctions(q: TxQuery, schema: string, name: string): Promise<FunctionInfo[]> {
  const r = await q(
    `select p.provolatile::text as volatility,
            p.proretset as returns_set,
            pg_catalog.format_type(p.prorettype, null) as return_type,
            (t.typrelid <> 0 or t.typtype = 'c' or p.prorettype = 'pg_catalog.record'::regtype) as returns_composite,
            coalesce(p.proargnames, '{}') as arg_names,
            coalesce(p.proargmodes::text[], '{}') as arg_modes,
            array(select pg_catalog.format_type(x, null) from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) x) as arg_types,
            p.pronargdefaults as n_defaults
       from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       join pg_catalog.pg_type t on t.oid = p.prorettype
      where n.nspname = $1 and p.proname = $2 and p.prokind = 'f'`,
    [schema, name],
  );
  return r.rows.map((row) => {
    const names = (row.arg_names as string[]) ?? [];
    const modes = (row.arg_modes as string[]) ?? [];
    const types = (row.arg_types as string[]) ?? [];
    const inputs: { name: string; type: string; variadic: boolean }[] = [];
    types.forEach((type, i) => {
      const mode = modes[i] ?? "i";
      if (mode === "i" || mode === "b" || mode === "v") inputs.push({ name: names[i] ?? "", type, variadic: mode === "v" });
    });
    const nDefaults = Number(row.n_defaults ?? 0);
    return {
      schema,
      name,
      params: inputs.map((p, i) => ({ ...p, hasDefault: i >= inputs.length - nDefaults })),
      returnsSet: Boolean(row.returns_set),
      returnsScalar: !row.returns_composite && row.return_type !== "void",
      returnsVoid: row.return_type === "void",
      volatility: String(row.volatility) as "i" | "s" | "v",
    };
  });
}

export async function listFunctionNames(q: TxQuery, schema: string): Promise<string[]> {
  const r = await q(
    `select distinct p.proname as name from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = $1 and p.prokind = 'f'`,
    [schema],
  );
  return r.rows.map((x) => String(x.name));
}

/** La sugerencia de PostgREST («Perhaps you meant…»): el nombre más parecido,
 *  si se parece lo bastante. PostgREST usa un conjunto difuso; aquí, la
 *  distancia de edición con el mismo umbral práctico: menos de la mitad. */
export function closestName(target: string, candidates: readonly string[]): string | null {
  let best: string | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const d = levenshtein(target.toLowerCase(), c.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best !== null && bestD <= Math.max(1, Math.floor(Math.max(target.length, best.length) / 2)) ? best : null;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}
