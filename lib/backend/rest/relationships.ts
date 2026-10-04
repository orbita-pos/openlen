// Las relaciones entre tablas para los recursos embebidos, como PostgREST
// (SchemaCache.hs: allM2OandO2ORels + addInverseRels + addM2MRels; Plan.hs:
// findRel; los errores PGRST200/201 de Error.hs). Sólo tablas del esquema
// expuesto; todavía no vistas ni relaciones calculadas (funciones).
//
// `cols` va siempre como pares (columna del ORIGEN, columna del DESTINO): la
// condición de unión es `destino.col = origen.col`.

import type { TxQuery } from "../db";
import { PostgrestError } from "./errors";

export type Relationship =
  | {
      readonly kind: "m2o" | "o2m" | "o2o";
      readonly table: string;
      readonly foreignTable: string;
      readonly isSelf: boolean;
      readonly constraint: string;
      readonly cols: readonly (readonly [string, string])[];
    }
  | {
      readonly kind: "m2m";
      readonly table: string;
      readonly foreignTable: string;
      readonly isSelf: boolean;
      readonly junction: string;
      readonly constraint1: string;
      readonly constraint2: string;
      /** (columna del origen, columna de la puente) */
      readonly sourceCols: readonly (readonly [string, string])[];
      /** (columna del destino, columna de la puente) */
      readonly targetCols: readonly (readonly [string, string])[];
    };

export function isToOne(r: Relationship): boolean {
  return r.kind === "m2o" || r.kind === "o2o";
}

interface FkRow {
  table: string;
  foreignTable: string;
  isSelf: boolean;
  constraint: string;
  cols: [string, string][];
  oneToOne: boolean;
}

/** `allM2OandO2ORels`, para un esquema. */
async function foreignKeys(q: TxQuery, schema: string): Promise<FkRow[]> {
  const r = await q(
    `WITH pks_uniques_cols AS (
       SELECT conrelid, array_agg(key order by key) as cols
         FROM pg_catalog.pg_constraint, LATERAL unnest(conkey) AS _(key)
        WHERE contype IN ('p', 'u') AND connamespace <> 'pg_catalog'::regnamespace
        GROUP BY oid, conrelid
     )
     SELECT tab.relname AS table_name, other.relname AS foreign_table_name,
            traint.conrelid = traint.confrelid AS is_self, traint.conname AS constraint_name,
            column_info.col_names, column_info.fcol_names,
            (column_info.cols IN (SELECT cols FROM pks_uniques_cols WHERE conrelid = traint.conrelid)) AS one_to_one
       FROM pg_catalog.pg_constraint traint
       JOIN LATERAL (
         SELECT array_agg(cols.attname::text order by ord) AS col_names,
                array_agg(refs.attname::text order by ord) AS fcol_names,
                array_agg(cols.attnum order by cols.attnum) AS cols
           FROM unnest(traint.conkey, traint.confkey) WITH ORDINALITY AS _(col, ref, ord)
           JOIN pg_catalog.pg_attribute cols ON cols.attrelid = traint.conrelid AND cols.attnum = col
           JOIN pg_catalog.pg_attribute refs ON refs.attrelid = traint.confrelid AND refs.attnum = ref
       ) AS column_info ON TRUE
       JOIN pg_catalog.pg_namespace ns1 ON ns1.oid = traint.connamespace
       JOIN pg_catalog.pg_class tab ON tab.oid = traint.conrelid
       JOIN pg_catalog.pg_class other ON other.oid = traint.confrelid
       JOIN pg_catalog.pg_namespace ns2 ON ns2.oid = other.relnamespace
      WHERE traint.contype = 'f' AND traint.conparentid = 0 AND ns1.nspname = $1 AND ns2.nspname = $1
      ORDER BY traint.conrelid, traint.conname`,
    [schema],
  );
  return r.rows.map((row) => {
    const cols = row.col_names as string[];
    const fcols = row.fcol_names as string[];
    return {
      table: String(row.table_name),
      foreignTable: String(row.foreign_table_name),
      isSelf: Boolean(row.is_self),
      constraint: String(row.constraint_name),
      cols: cols.map((c, i) => [c, fcols[i]!] as [string, string]),
      oneToOne: Boolean(row.one_to_one),
    };
  });
}

async function primaryKeys(q: TxQuery, schema: string): Promise<Map<string, Set<string>>> {
  const r = await q(
    `SELECT c.relname AS table_name, array_agg(a.attname::text) AS cols
       FROM pg_catalog.pg_index i
       JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = any(i.indkey)
      WHERE i.indisprimary AND n.nspname = $1
      GROUP BY c.relname`,
    [schema],
  );
  return new Map(r.rows.map((x) => [String(x.table_name), new Set(x.cols as string[])]));
}

/** Todas las relaciones que salen de `origin`. */
export async function relationshipsFrom(q: TxQuery, schema: string, origin: string): Promise<Relationship[]> {
  const fks = await foreignKeys(q, schema);
  const rels: Relationship[] = [];
  for (const fk of fks) {
    // La relación directa (el que tiene la FK mira a quien referencia)…
    if (fk.table === origin) {
      rels.push({
        kind: fk.oneToOne ? "o2o" : "m2o",
        table: fk.table,
        foreignTable: fk.foreignTable,
        isSelf: fk.isSelf,
        constraint: fk.constraint,
        cols: fk.cols,
      });
    }
    // …y la inversa (`addInverseRels`).
    if (fk.foreignTable === origin) {
      rels.push({
        kind: fk.oneToOne ? "o2o" : "o2m",
        table: fk.foreignTable,
        foreignTable: fk.table,
        isSelf: fk.isSelf,
        constraint: fk.constraint,
        cols: fk.cols.map(([c, f]) => [f, c] as [string, string]),
      });
    }
  }
  // `addM2MRels`: una tabla puente con FK al origen y FK al destino, cuyas
  // columnas son TODAS parte de su clave primaria.
  const pks = await primaryKeys(q, schema);
  for (const a of fks) {
    if (a.foreignTable !== origin) continue;
    for (const b of fks) {
      if (b.table !== a.table || b.constraint === a.constraint) continue;
      const pk = pks.get(a.table) ?? new Set<string>();
      const junctionCols = [...a.cols.map(([c]) => c), ...b.cols.map(([c]) => c)];
      if (!junctionCols.every((c) => pk.has(c))) continue;
      rels.push({
        kind: "m2m",
        table: origin,
        foreignTable: b.foreignTable,
        isSelf: origin === b.foreignTable,
        junction: a.table,
        constraint1: a.constraint,
        constraint2: b.constraint,
        sourceCols: a.cols.map(([jc, oc]) => [oc, jc] as [string, string]),
        targetCols: b.cols.map(([jc, tc]) => [tc, jc] as [string, string]),
      });
    }
  }
  return rels;
}

function singleCols(r: Relationship): [string, string] | null {
  if (r.kind === "m2m" || r.cols.length !== 1) return null;
  return [r.cols[0]![0], r.cols[0]![1]];
}

/** `findRel`. */
export function findRel(schema: string, origin: string, rels: readonly Relationship[], target: string, hint: string | undefined): Relationship {
  const found = rels.filter((r) => {
    const single = singleCols(r);
    const matchFKSingleCol = (h: string) => single !== null && single[0] === h;
    const matchFKRefSingleCol = (h: string) => single !== null && single[1] === h;
    const matchConstraint = (h: string) => r.kind !== "m2m" && r.constraint === h;
    const matchJunction = (h: string) => r.kind === "m2m" && r.junction === h;
    if (r.isSelf) {
      if (hint === undefined) {
        return (target === r.foreignTable && r.kind === "o2m") || (matchFKSingleCol(target) && r.kind === "m2o");
      }
      return target === r.foreignTable && r.kind === "o2m" && matchFKRefSingleCol(hint);
    }
    if (hint === undefined) {
      return target === r.foreignTable || matchConstraint(target) || matchFKSingleCol(target);
    }
    return (
      target === r.foreignTable && (matchConstraint(hint) || matchFKSingleCol(hint) || matchFKRefSingleCol(hint) || matchJunction(hint))
    );
  });
  if (found.length === 1) return found[0]!;
  if (found.length === 0) {
    throw new PostgrestError(400, {
      code: "PGRST200",
      message: `Could not find a relationship between '${origin}' and '${target}' in the schema cache`,
      details: `Searched for a foreign key relationship between '${origin}' and '${target}'${hint !== undefined ? ` using the hint '${hint}'` : ""} in the schema '${schema}', but no matches were found.`,
      hint: null,
    });
  }
  const fmt = (els: readonly string[]) => `(${els.join(", ")})`;
  throw new PostgrestError(300, {
    code: "PGRST201",
    message: `Could not embed because more than one relationship was found for '${origin}' and '${target}'`,
    details: found.map((r) =>
      r.kind === "m2m"
        ? {
            cardinality: "many-to-many",
            embedding: `${r.table} with ${r.foreignTable}`,
            relationship: `${r.junction} using ${r.constraint1}${fmt(r.sourceCols.map(([, j]) => j))} and ${r.constraint2}${fmt(r.targetCols.map(([, j]) => j))}`,
          }
        : {
            cardinality: { m2o: "many-to-one", o2m: "one-to-many", o2o: "one-to-one" }[r.kind],
            embedding: `${r.table} with ${r.foreignTable}`,
            relationship: `${r.constraint} using ${r.table}${fmt(r.cols.map(([c]) => c))} and ${r.foreignTable}${fmt(r.cols.map(([, f]) => f))}`,
          },
    ),
    hint: `Try changing '${target}' to one of the following: ${found
      .map((r) => `'${r.foreignTable}!${r.kind === "m2m" ? r.junction : r.constraint}'`)
      .join(", ")}. Find the desired relationship in the 'details' key.`,
  });
}
