// El SQL de /rest/v1: porte de PostgREST (src/library/PostgREST/Query/SqlFragment.hs
// y QueryBuilder.hs, v16.4). Los valores van SIEMPRE como parámetros sin tipo
// (`$n`, lo que PostgREST llama `unknownLiteral`) y Postgres infiere el tipo
// por la columna; los identificadores, con `escapeIdent`.

import type { Field, LogicTree, OrderTerm, SelectItem, Filter } from "./parse";
import { PostgrestError } from "./errors";
import type { ColumnInfo } from "./schema-cache";

export class Params {
  readonly values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

/** `escapeIdent`: entre comillas dobles, con las de dentro dobladas. */
export function ident(name: string): string {
  return `"${name.replace(/\u0000/g, "").replace(/"/g, '""')}"`;
}

/** `pgFmtLit`: un literal de texto. Con barras invertidas, la forma E''. */
export function literal(text: string): string {
  const trimmed = text.replace(/\u0000/g, "");
  const escaped = `'${trimmed.replace(/'/g, "''")}'`;
  return escaped.includes("\\") ? `E${escaped.replace(/\\/g, "\\\\")}` : escaped;
}

/** `pgBuildArrayLiteral`: `{"a","b"}`, para `= ANY(...)`. */
export function arrayLiteral(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

export interface Qualifier {
  /** Cómo se nombra la tabla en la consulta: `"public"."t"` o un alias. */
  readonly sql: string;
}

export function qualified(schema: string, name: string): Qualifier {
  return { sql: `${ident(schema)}.${ident(name)}` };
}

function jsonPathSql(field: Field): string {
  return field.jsonPath
    .map((op) => `${op.arrow}${op.key !== undefined ? literal(op.key) : `${literal(op.idx!)}::int`}`)
    .join("");
}

/** `pgFmtField`. `*` es la fila entera de la tabla. */
export function fieldSql(q: Qualifier, field: Field): string {
  if (field.name === "*") return `${q.sql}.*`;
  return `${q.sql}.${ident(field.name)}${jsonPathSql(field)}`;
}

/** `addAliases`: sin alias, una ruta JSON se llama como su última clave. */
function defaultAlias(field: Field): string | undefined {
  if (field.jsonPath.length === 0) return undefined;
  const last = field.jsonPath.at(-1)!;
  if (last.key !== undefined) return last.key;
  const lastKey = [...field.jsonPath].reverse().find((op) => op.key !== undefined)?.key;
  return lastKey ?? field.name;
}

/** `pgFmtSelectItem`, sólo campos (los embebidos los arma readQuery). */
export function selectItemSql(q: Qualifier, item: Extract<SelectItem, { kind: "field" }>): string {
  if (item.aggregate) {
    throw new PostgrestError(400, { code: "PGRST123", message: "Use of aggregate functions is not allowed", details: null, hint: null });
  }
  let sql = fieldSql(q, item.field);
  // El tipo lo valida el parser (letras, dígitos, `_`, espacio y `$`): va sin
  // comillas para que `int` o `bigint` sigan siendo lo que son.
  if (item.cast) sql = `CAST( ${sql} AS ${item.cast} )`;
  const alias = item.alias ?? defaultAlias(item.field);
  return alias !== undefined ? `${sql} AS ${ident(alias)}` : sql;
}

const SIMPLE: Record<string, string> = {
  neq: "<>",
  cs: "@>",
  cd: "<@",
  ov: "&&",
  sl: "<<",
  sr: ">>",
  nxr: "&<",
  nxl: "&>",
  adj: "-|-",
};
const QUANT: Record<string, string> = {
  eq: "=",
  gte: ">=",
  gt: ">",
  lte: "<=",
  lt: "<",
  like: "like",
  ilike: "ilike",
  match: "~",
  imatch: "~*",
};
const FTS: Record<string, string> = {
  fts: "@@ to_tsquery",
  plfts: "@@ plainto_tsquery",
  phfts: "@@ phraseto_tsquery",
  wfts: "@@ websearch_to_tsquery",
};

/** `pgFmtFilter`. `columns` sirve para envolver en `to_tsvector` un texto que
 *  se busca con `fts` (el `cfToTsVector` de PostgREST). */
export function filterSql(q: Qualifier, f: Filter, p: Params, columns?: readonly ColumnInfo[]): string {
  const { field, expr } = f;
  const not = expr.not ? "NOT " : "";
  const fld = fieldSql(q, field);
  const op = expr.op;
  switch (op.kind) {
    case "simple":
      return `${not}${fld} ${SIMPLE[op.op]} ${p.add(op.value)}`;
    case "quant": {
      const raw = op.op === "like" || op.op === "ilike" ? op.value.replace(/\*/g, "%") : op.value;
      const val = p.add(raw);
      const rhs = op.quant === "any" ? `ANY(${val})` : op.quant === "all" ? `ALL(${val})` : val;
      return `${not}${fld} ${QUANT[op.op]} ${rhs}`;
    }
    case "is":
      return `${not}${fld} IS ${{ null: "NULL", not_null: "NOT NULL", true: "TRUE", false: "FALSE", unknown: "UNKNOWN" }[op.value]}`;
    case "isdistinct":
      return `${not}${fld} IS DISTINCT FROM ${p.add(op.value)}`;
    case "in":
      if (op.values.length === 1 && op.values[0] === "") return `${not}${fld} = ANY('{}')`;
      return `${not}${fld} = ANY (${p.add(arrayLiteral(op.values))})`;
    case "fts": {
      const col = columns?.find((c) => c.name === field.name);
      const needsVector = field.jsonPath.length === 0 && col !== undefined && col.type !== "tsvector";
      const lang = op.lang !== undefined ? `${p.add(op.lang)}, ` : "";
      const lhs = needsVector ? `to_tsvector(${lang}${fld})` : fld;
      return `${not}${lhs} ${FTS[op.op]}(${lang}${p.add(op.value)})`;
    }
  }
}

export function logicTreeSql(q: Qualifier, t: LogicTree, p: Params, columns?: readonly ColumnInfo[]): string {
  if (t.kind === "stmt") return filterSql(q, t.filter, p, columns);
  const parts = t.children.map((c) => logicTreeSql(q, c, p, columns));
  return `${t.not ? "NOT" : ""} (${parts.join(t.op === "and" ? " AND " : " OR ")})`;
}

export function orderSql(q: Qualifier, terms: readonly OrderTerm[]): string {
  if (terms.length === 0) return "";
  const parts = terms.map((t) => {
    if (t.kind === "relation") {
      throw new PostgrestError(400, {
        code: "PGRST127",
        message: "Feature not implemented",
        details: "ordering by an embedded resource",
        hint: null,
      });
    }
    const dir = t.dir === "asc" ? " ASC" : t.dir === "desc" ? " DESC" : "";
    const nulls = t.nulls === "first" ? " NULLS FIRST" : t.nulls === "last" ? " NULLS LAST" : "";
    return `${fieldSql(q, t.field)}${dir}${nulls}`;
  });
  return `ORDER BY ${parts.join(", ")}`;
}

export function limitOffsetSql(range: { offset: number; limit: number | null } | undefined, p: Params): string {
  if (!range || (range.limit === null && range.offset === 0)) return "";
  const limit = range.limit === null ? "ALL" : p.add(String(range.limit));
  return `LIMIT ${limit} OFFSET ${p.add(String(range.offset))}`;
}

/** `fromJsonBodyF`: las filas de un cuerpo JSON con los tipos de las columnas.
 *  `withDefaults`: `Prefer: missing=default` (lo que falta toma el DEFAULT). */
export function jsonBodySql(
  body: string,
  isObject: boolean,
  cols: readonly ColumnInfo[],
  p: Params,
  opts: { includeSelect: boolean; limitOne: boolean; withDefaults: boolean },
): string {
  const named = cols.map((c) => `pgrst_body.${ident(c.name)}`).join(", ");
  const typed = cols.map((c) => `${ident(c.name)} ${c.type}`).join(", ");
  const parsed = cols.map((c) => ident(c.name)).join(", ");
  const defaults = cols.filter((c) => c.default !== null);
  const useDefaults = opts.withDefaults && defaults.length > 0;
  const placeholder = `${p.add(body)}::${useDefaults ? "jsonb" : "json"}`;
  const defsJsonb = `jsonb_build_object(${defaults.map((c) => `${literal(c.name)}, ${c.default}`).join(", ")})`;
  const finalBody = useDefaults ? "pgrst_json_defs.val" : "pgrst_payload.json_data";
  const fnPrefix = useDefaults ? "jsonb" : "json";
  const defaultsClause = !useDefaults
    ? ""
    : isObject
      ? `LATERAL (SELECT ${defsJsonb} || pgrst_payload.json_data AS val) pgrst_json_defs, `
      : `LATERAL (SELECT jsonb_agg(${defsJsonb} || elem) AS val from jsonb_array_elements(pgrst_payload.json_data) elem) pgrst_json_defs, `;
  const source =
    cols.length === 0
      ? isObject
        ? "(values(1)) _ "
        : `${fnPrefix}_array_elements(${finalBody}) _ `
      : `${fnPrefix}_to_record${isObject ? "" : "set"}(${finalBody}) AS _(${typed}) ${opts.limitOne ? "LIMIT 1" : ""}`;
  return (
    (opts.includeSelect ? `SELECT ${named} ` : "") +
    `FROM (SELECT ${placeholder} AS json_data) pgrst_payload, ` +
    defaultsClause +
    `LATERAL (SELECT ${parsed} FROM ${source}) pgrst_body `
  );
}
