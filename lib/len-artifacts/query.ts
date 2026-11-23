// THE QUERY OF AN AGENT'S TOOL (spec local 2026-11-22-herramienta-dentro-del-agente, §3): `where` / `orderBy` / `limit`
// over the documents of one collection, as the `query` of Claude's artifact database — the agent's `tool_data` and the
// tool's own `window.openlen.data.query` answer through it. Pure: the caller hands over the collection's documents.
//
// Rules, each one pinned by `query.test.ts`:
//   - `field` is a dotted path into the document's `data`; it walks the document's OWN fields only (never the prototype,
//     and an array only by index), so `constructor` or `list.length` are simply not there;
//   - a field that is not there never matches a condition — not even `!=`;
//   - `<` `<=` `>` `>=` compare two numbers, two strings or two booleans; any other pair never satisfies them;
//   - the conditions are all required (AND);
//   - `orderBy` keeps the documents without the field AFTER the rest, either way: nothing disappears from the list;
//   - equal values stay in the order the documents came in;
//   - `limit` is at most 100, and 100 is also what no limit means (`runQuery` is `matchQuery`, which keeps every match, cut
//     to `queryLimit`).
import { LEN_ARTIFACT_QUERY_LIMIT_MAX } from "./limits";
import type { LenArtifactDoc } from "./store";

export type QueryOp = "==" | "!=" | "<" | "<=" | ">" | ">=";

export type LenArtifactQuery = {
  where?: readonly { field: string; op: QueryOp; value: unknown }[];
  orderBy?: { field: string; direction?: "asc" | "desc" };
  limit?: number;
};

const MISSING: unique symbol = Symbol("missing");

/** The value at a dotted path of a document's data, or MISSING. */
function valueAt(data: unknown, path: string): unknown {
  let current: unknown = data;
  for (const key of path.split(".")) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= current.length) return MISSING;
      current = current[Number(key)];
    } else if (typeof current === "object" && current !== null) {
      if (!Object.hasOwn(current, key)) return MISSING;
      current = (current as Record<string, unknown>)[key];
    } else {
      return MISSING;
    }
  }
  return current;
}

/** JSON equality: same type and same content, objects and arrays by their fields. */
function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((item, i) => isEqual(item, (b as unknown[])[i]));
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && isEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** -1, 0 or 1 when both are numbers, strings or booleans; null when they can't be ordered against each other. */
function compare(a: unknown, b: unknown): -1 | 0 | 1 | null {
  if (typeof a !== typeof b) return null;
  if (typeof a === "number" || typeof a === "string" || typeof a === "boolean") return a < (b as typeof a) ? -1 : a > (b as typeof a) ? 1 : 0;
  return null;
}

function matches(actual: unknown, op: QueryOp, expected: unknown): boolean {
  if (actual === MISSING) return false;
  if (op === "==") return isEqual(actual, expected);
  if (op === "!=") return !isEqual(actual, expected);
  const order = compare(actual, expected);
  if (order === null) return false;
  if (op === "<") return order < 0;
  if (op === "<=") return order <= 0;
  if (op === ">") return order > 0;
  if (op === ">=") return order >= 0;
  return false;
}

/** Where a value falls when documents of different types are sorted together: null, booleans, numbers, strings, the rest. */
function rank(value: unknown): number {
  if (value === null) return 0;
  if (typeof value === "boolean") return 1;
  if (typeof value === "number") return 2;
  if (typeof value === "string") return 3;
  return 4;
}

/** How many documents a query returns: the limit asked, at most 100, and 100 when it asks for none. */
export function queryLimit(q: LenArtifactQuery): number {
  const asked = q.limit;
  if (typeof asked !== "number" || Number.isNaN(asked)) return LEN_ARTIFACT_QUERY_LIMIT_MAX;
  return Math.min(Math.max(Math.floor(asked), 0), LEN_ARTIFACT_QUERY_LIMIT_MAX);
}

/** Every document that matches `where`, in `orderBy` order, with NO limit: what a caller needs to say how many matched (the
 *  `count` of `tool_data query`) before `queryLimit` cuts what it returns. */
export function matchQuery(docs: readonly LenArtifactDoc[], q: LenArtifactQuery): LenArtifactDoc[] {
  const conditions = q.where ?? [];
  let found = docs.filter((doc) => conditions.every((c) => matches(valueAt(doc.data, c.field), c.op, c.value)));
  if (q.orderBy) {
    const { field, direction } = q.orderBy;
    const sign = direction === "desc" ? -1 : 1;
    found = found
      .map((doc, index) => ({ doc, index, value: valueAt(doc.data, field) }))
      .sort((a, b) => {
        if (a.value === MISSING || b.value === MISSING) return a.value === b.value ? a.index - b.index : a.value === MISSING ? 1 : -1;
        const order = rank(a.value) !== rank(b.value) ? Math.sign(rank(a.value) - rank(b.value)) : (compare(a.value, b.value) ?? 0);
        return order * sign || a.index - b.index;
      })
      .map((entry) => entry.doc);
  }
  return found;
}

export function runQuery(docs: readonly LenArtifactDoc[], q: LenArtifactQuery): LenArtifactDoc[] {
  return matchQuery(docs, q).slice(0, queryLimit(q));
}
