// El plan de lectura de /rest/v1 con sus recursos embebidos: porte de
// PostgREST (Plan.hs: el árbol de ReadPlan; QueryBuilder.hs: readPlanToQuery,
// getJoin, readPlanToCountQuery).
//
// Cada embebido es un JOIN LATERAL:
//   · a-uno (m2o, o2o):  LEFT JOIN LATERAL ( <hijo> ) AS "a" ON TRUE,
//                        y se selecciona row_to_json("a".*)::jsonb.
//   · a-muchos (o2m, m2m): LEFT JOIN LATERAL ( SELECT json_agg("a")::jsonb AS "a"
//                        FROM ( <hijo> ) AS "a" ) AS "a" ON TRUE,
//                        y se selecciona COALESCE("a"."a", '[]').
//   · `!inner`: INNER JOIN, y en a-muchos ON "a" IS NOT NULL.
//   · spread (`...rel(cols)`): las columnas del hijo, sueltas en el padre.

import type { TxQuery } from "../db";
import { PostgrestError } from "./errors";
import type { Filter, LogicTree, OrderTerm, ParsedQuery, SelectItem } from "./parse";
import { findRel, isToOne, relationshipsFrom, type Relationship } from "./relationships";
import { closestName, findTable, listTableNames, type ColumnInfo, type TableInfo } from "./schema-cache";
import { fieldSql, filterSql, ident, limitOffsetSql, logicTreeSql, Params, qualified, selectItemSql, type Qualifier } from "./sql";

type FieldItem = Extract<SelectItem, { kind: "field" }>;

interface Embed {
  readonly node: ReadNode;
  readonly rel: Relationship;
  /** Cómo se llama en la salida (alias o nombre). */
  readonly selName: string;
  readonly aggAlias: string;
  readonly inner: boolean;
  readonly spread: boolean;
}

interface ReadNode {
  readonly name: string;
  readonly qi: Qualifier;
  /** `"public"."t" AS "t_1"` (más la puente en un m2m). */
  from: string;
  readonly columns: readonly ColumnInfo[];
  readonly select: FieldItem[];
  readonly embeds: Embed[];
  /** Condiciones de unión con el padre. */
  readonly joinConds: string[];
  /** El camino de este nodo, para casar filtros/orden/límites (`posts.title`). */
  readonly path: readonly string[];
}

export interface PlanSource {
  /** Nombre lógico (para los errores y las relaciones). */
  readonly name: string;
  /** Lo que va tras FROM: `"public"."t"` o `pgrst_source`. */
  readonly fromSql: string;
  /** Alias en la consulta. */
  readonly alias: string;
  readonly columns: readonly ColumnInfo[];
}

interface BuildCtx {
  readonly q: TxQuery;
  readonly schema: string;
  counter: number;
  relsCache: Map<string, Relationship[]>;
}

async function rels(ctx: BuildCtx, origin: string): Promise<Relationship[]> {
  let r = ctx.relsCache.get(origin);
  if (!r) {
    r = await relationshipsFrom(ctx.q, ctx.schema, origin);
    ctx.relsCache.set(origin, r);
  }
  return r;
}

async function targetTable(ctx: BuildCtx, name: string): Promise<TableInfo> {
  const t = await findTable(ctx.q, ctx.schema, name);
  if (t) return t;
  const close = closestName(name, await listTableNames(ctx.q, ctx.schema));
  throw new PostgrestError(404, {
    code: "PGRST205",
    message: `Could not find the table '${ctx.schema}.${name}' in the schema cache`,
    details: null,
    hint: close ? `Perhaps you meant the table '${ctx.schema}.${close}'` : null,
  });
}

async function buildNode(ctx: BuildCtx, src: PlanSource, items: readonly SelectItem[], path: readonly string[]): Promise<ReadNode> {
  const qi: Qualifier = { sql: ident(src.alias) };
  const node: ReadNode = {
    name: src.name,
    qi,
    from: `${src.fromSql} AS ${ident(src.alias)}`,
    columns: src.columns,
    select: [],
    embeds: [],
    joinConds: [],
    path,
  };
  for (const item of items) {
    if (item.kind === "field") {
      if (item.aggregate) {
        throw new PostgrestError(400, { code: "PGRST123", message: "Use of aggregate functions is not allowed", details: null, hint: null });
      }
      node.select.push(item);
      continue;
    }
    const rel = findRel(ctx.schema, src.name, await rels(ctx, src.name), item.name, item.hint);
    if (item.kind === "spread" && !isToOne(rel)) {
      throw new PostgrestError(400, {
        code: "PGRST127",
        message: "Feature not implemented",
        details: "spreading a to-many relationship",
        hint: null,
      });
    }
    const target = await targetTable(ctx, rel.foreignTable);
    const childAlias = `${rel.foreignTable}_${++ctx.counter}`;
    const selName = item.kind === "relation" ? (item.alias ?? item.name) : item.name;
    const child = await buildNode(
      ctx,
      { name: rel.foreignTable, fromSql: qualified(ctx.schema, rel.foreignTable).sql, alias: childAlias, columns: target.columns },
      item.children,
      [...path, selName],
    );
    if (rel.kind === "m2m") {
      const junction = qualified(ctx.schema, rel.junction).sql;
      child.from = `${child.from}, ${junction}`;
      for (const [tc, jc] of rel.targetCols) child.joinConds.push(`${junction}.${ident(jc)} = ${child.qi.sql}.${ident(tc)}`);
      for (const [oc, jc] of rel.sourceCols) child.joinConds.push(`${junction}.${ident(jc)} = ${qi.sql}.${ident(oc)}`);
    } else {
      for (const [oc, tc] of rel.cols) child.joinConds.push(`${child.qi.sql}.${ident(tc)} = ${qi.sql}.${ident(oc)}`);
    }
    node.embeds.push({
      node: child,
      rel,
      selName,
      aggAlias: `${src.name}_${rel.foreignTable}_${ctx.counter}`,
      inner: item.joinType === "inner",
      spread: item.kind === "spread",
    });
  }
  return node;
}

/** El nodo al que va un camino (`["posts","comments"]`), o PGRST108. */
function nodeAt(root: ReadNode, path: readonly string[]): ReadNode {
  let n = root;
  for (const step of path) {
    const e = n.embeds.find((x) => x.selName === step);
    if (!e) {
      throw new PostgrestError(400, {
        code: "PGRST108",
        message: `'${step}' is not an embedded resource in this request`,
        details: null,
        hint: `Verify that '${step}' is included in the 'select' query parameter.`,
      });
    }
    n = e.node;
  }
  return n;
}

interface NodeExtras {
  filters: Filter[];
  logic: LogicTree[];
  order: OrderTerm[];
  range: { offset: number; limit: number | null } | undefined;
}

export interface ReadPlan {
  readonly root: ReadNode;
  readonly extras: Map<ReadNode, NodeExtras>;
}

export async function buildReadPlan(q: TxQuery, schema: string, src: PlanSource, qs: ParsedQuery): Promise<ReadPlan> {
  const ctx: BuildCtx = { q, schema, counter: 0, relsCache: new Map() };
  const root = await buildNode(ctx, src, qs.select, []);
  const extras = new Map<ReadNode, NodeExtras>();
  const at = (path: readonly string[]) => {
    const n = nodeAt(root, path);
    let e = extras.get(n);
    if (!e) {
      e = { filters: [], logic: [], order: [], range: undefined };
      extras.set(n, e);
    }
    return e;
  };
  for (const f of qs.filters) at(f.path).filters.push(f.filter);
  for (const l of qs.logic) at(l.path).logic.push(l.tree);
  for (const o of qs.order) at(o.path).order.push(...o.terms);
  for (const [key, range] of Object.entries(qs.ranges)) at(key === "" ? [] : key.split(".")).range = range;
  return { root, extras };
}

/** Un filtro `embebido=is.null` / `not.is.null` sobre un embebido del nodo
 *  (`CoercibleFilterNullEmbed`). Cualquier otro operador ahí es PGRST120. */
function nullEmbedFilter(node: ReadNode, f: Filter): string | null {
  const e = node.embeds.find((x) => x.selName === f.field.name);
  if (!e || f.field.jsonPath.length > 0) return null;
  if (f.expr.op.kind !== "is" || (f.expr.op.value !== "null" && f.expr.op.value !== "not_null")) {
    throw new PostgrestError(400, {
      code: "PGRST120",
      message: `Bad operator on the '${f.field.name}' embedded resource`,
      details: "Only is null or not is null filters are allowed on embedded resources",
      hint: null,
    });
  }
  const isNull = (f.expr.op.value === "null") !== f.expr.not;
  return `${ident(e.aggAlias)} IS ${isNull ? "" : "NOT "}DISTINCT FROM NULL`;
}

function conditions(plan: ReadPlan, node: ReadNode, p: Params): string[] {
  const ex = plan.extras.get(node);
  const conds: string[] = [];
  for (const f of ex?.filters ?? []) conds.push(nullEmbedFilter(node, f) ?? filterSql(node.qi, f, p, node.columns));
  for (const l of ex?.logic ?? []) conds.push(logicTreeSql(node.qi, l, p, node.columns));
  return [...conds, ...node.joinConds];
}

function orderFor(plan: ReadPlan, node: ReadNode): string {
  const terms = plan.extras.get(node)?.order ?? [];
  if (terms.length === 0) return "";
  const parts = terms.map((t) => {
    const dir = t.dir === "asc" ? " ASC" : t.dir === "desc" ? " DESC" : "";
    const nulls = t.nulls === "first" ? " NULLS FIRST" : t.nulls === "last" ? " NULLS LAST" : "";
    if (t.kind === "field") return `${fieldSql(node.qi, t.field)}${dir}${nulls}`;
    const e = node.embeds.find((x) => x.selName === t.relation);
    if (!e) {
      throw new PostgrestError(400, {
        code: "PGRST108",
        message: `'${t.relation}' is not an embedded resource in this request`,
        details: null,
        hint: `Verify that '${t.relation}' is included in the 'select' query parameter.`,
      });
    }
    if (!isToOne(e.rel)) {
      throw new PostgrestError(400, {
        code: "PGRST118",
        message: `A related order on '${t.relation}' is not possible`,
        details: `'${node.name}' and '${t.relation}' do not form a many-to-one or one-to-one relationship`,
        hint: null,
      });
    }
    return `${fieldSql({ sql: ident(e.aggAlias) }, t.field)}${dir}${nulls}`;
  });
  return `ORDER BY ${parts.join(", ")}`;
}

/** `readPlanToQuery`. `skipRootConditions`: las filas que devuelve una
 *  escritura (los filtros de la raíz ya fueron los de la escritura). */
export function readSql(plan: ReadPlan, node: ReadNode, p: Params, opts: { skipConditions?: boolean } = {}): string {
  const selects: string[] = [];
  if (node.select.length === 0 && node.embeds.length === 0) selects.push(`${node.qi.sql}.*`);
  else selects.push(...node.select.map((s) => selectItemSql(node.qi, s)));
  const joins: string[] = [];
  for (const e of node.embeds) {
    const sub = readSql(plan, e.node, p);
    const agg = ident(e.aggAlias);
    const join = e.inner ? "INNER" : "LEFT";
    if (isToOne(e.rel)) {
      joins.push(`${join} JOIN LATERAL ( ${sub} ) AS ${agg} ON TRUE`);
      if (e.spread) {
        for (const s of e.node.select) {
          const name = s.alias ?? (s.field.jsonPath.at(-1)?.key ?? s.field.name);
          selects.push(`${agg}.${ident(name)}`);
        }
      } else {
        selects.push(`row_to_json(${agg}.*)::jsonb AS ${ident(e.selName)}`);
      }
    } else {
      joins.push(`${join} JOIN LATERAL ( SELECT json_agg(${agg})::jsonb AS ${agg} FROM (${sub} ) AS ${agg} ) AS ${agg} ON ${e.inner ? `${agg} IS NOT NULL` : "TRUE"}`);
      selects.push(`COALESCE( ${agg}.${agg}, '[]') AS ${ident(e.selName)}`);
    }
  }
  const conds = opts.skipConditions ? [] : conditions(plan, node, p);
  return (
    `SELECT ${selects.join(", ")} FROM ${node.from} ${joins.join(" ")}` +
    (conds.length > 0 ? ` WHERE ${conds.join(" AND ")}` : "") +
    ` ${orderFor(plan, node)} ${limitOffsetSql(plan.extras.get(node)?.range, p)}`
  );
}

/** `readPlanToCountQuery`: la raíz, sin límites; un `!inner` cuenta como EXISTS. */
export function countSql(plan: ReadPlan, node: ReadNode, p: Params): string {
  const conds = conditions(plan, node, p);
  for (const e of node.embeds) if (e.inner) conds.push(`EXISTS (${countSql(plan, e.node, p)} )`);
  return `SELECT 1 FROM ${node.from}${conds.length > 0 ? ` WHERE ${conds.join(" AND ")}` : ""}`;
}

export function rootRange(plan: ReadPlan) {
  return plan.extras.get(plan.root)?.range;
}

/** Los filtros de la RAÍZ en SQL, para el WHERE de un UPDATE/DELETE. */
export function rootConditions(plan: ReadPlan, p: Params): string[] {
  return conditions(plan, plan.root, p);
}
