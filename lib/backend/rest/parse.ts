// El parser de la URL de /rest/v1: porte de PostgREST
// (src/library/PostgREST/ApiRequest/QueryParams.hs, v16.4). Misma gramática,
// mismas reglas de qué parámetro es qué; los mensajes de error siguen su forma
// («"failed to parse filter (x)" (line 1, column N)») con el código PGRST100.
//
// Es un descenso recursivo con vuelta atrás donde el original usa `try` de
// parsec: cada `attempt` guarda la posición y la restaura si falla.

import { PostgrestError } from "./errors";

export interface JsonOp {
  readonly arrow: "->" | "->>";
  readonly key?: string;
  /** Índice de array, con su signo: «+0», «-1». */
  readonly idx?: string;
}
export interface Field {
  readonly name: string;
  readonly jsonPath: readonly JsonOp[];
}

export type Aggregate = "count" | "sum" | "avg" | "max" | "min";
export type SelectItem =
  | {
      readonly kind: "field";
      readonly field: Field;
      readonly cast?: string;
      readonly alias?: string;
      readonly aggregate?: Aggregate;
      readonly aggregateCast?: string;
    }
  | {
      readonly kind: "relation";
      readonly name: string;
      readonly alias?: string;
      readonly hint?: string;
      readonly joinType?: "left" | "inner";
      readonly children: readonly SelectItem[];
    }
  | {
      readonly kind: "spread";
      readonly name: string;
      readonly hint?: string;
      readonly joinType?: "left" | "inner";
      readonly children: readonly SelectItem[];
    };

export type SimpleOp = "neq" | "cs" | "cd" | "ov" | "sl" | "sr" | "nxr" | "nxl" | "adj";
export type QuantOp = "eq" | "gte" | "gt" | "lte" | "lt" | "like" | "ilike" | "match" | "imatch";
export type FtsOp = "fts" | "plfts" | "phfts" | "wfts";
export type IsVal = "null" | "not_null" | "true" | "false" | "unknown";

export type Operation =
  | { readonly kind: "simple"; readonly op: SimpleOp; readonly value: string }
  | { readonly kind: "quant"; readonly op: QuantOp; readonly quant?: "any" | "all"; readonly value: string }
  | { readonly kind: "in"; readonly values: readonly string[] }
  | { readonly kind: "is"; readonly value: IsVal }
  | { readonly kind: "isdistinct"; readonly value: string }
  | { readonly kind: "fts"; readonly op: FtsOp; readonly lang?: string; readonly value: string };

export interface OpExpr {
  readonly not: boolean;
  readonly op: Operation;
}
export interface Filter {
  readonly field: Field;
  readonly expr: OpExpr;
}
export type LogicTree =
  | { readonly kind: "expr"; readonly not: boolean; readonly op: "and" | "or"; readonly children: readonly LogicTree[] }
  | { readonly kind: "stmt"; readonly filter: Filter };

export type OrderTerm =
  | { readonly kind: "field"; readonly field: Field; readonly dir?: "asc" | "desc"; readonly nulls?: "first" | "last" }
  | {
      readonly kind: "relation";
      readonly relation: string;
      readonly field: Field;
      readonly dir?: "asc" | "desc";
      readonly nulls?: "first" | "last";
    };

/** El camino de recursos embebidos de un parámetro: `posts.order` → ["posts"]. */
export type EmbedPath = readonly string[];

class ParseFail extends Error {
  constructor(
    readonly pos: number,
    readonly expected: string,
  ) {
    super(expected);
  }
}

const QUANT_OPS: readonly QuantOp[] = ["eq", "gte", "gt", "lte", "lt", "like", "ilike", "match", "imatch"];
const SIMPLE_OPS: readonly SimpleOp[] = ["neq", "cs", "cd", "ov", "sl", "sr", "nxr", "nxl", "adj"];
const IS_VALS: readonly IsVal[] = ["null", "not_null", "true", "false", "unknown"];

/** parsec: `letter <|> digit <|> oneOf "_ $"`. `letter` es cualquier letra Unicode. */
function isIdentChar(c: string): boolean {
  return /[\p{L}\p{N}_ $]/u.test(c);
}

class Cursor {
  pos = 0;
  constructor(readonly s: string) {}

  get eof(): boolean {
    return this.pos >= this.s.length;
  }
  peek(n = 1): string {
    return this.s.slice(this.pos, this.pos + n);
  }
  fail(expected: string): never {
    throw new ParseFail(this.pos, expected);
  }
  /** `try` de parsec: si `fn` falla, vuelve a donde estaba. */
  attempt<T>(fn: () => T): T | undefined {
    const at = this.pos;
    try {
      return fn();
    } catch (e) {
      if (!(e instanceof ParseFail)) throw e;
      this.pos = at;
      return undefined;
    }
  }
  string(lit: string): string {
    if (this.s.startsWith(lit, this.pos)) {
      this.pos += lit.length;
      return lit;
    }
    this.fail(JSON.stringify(lit));
  }
  char(c: string): string {
    return this.string(c);
  }
  ws(): void {
    while (this.peek() === " " || this.peek() === "\t") this.pos++;
  }
  /** `lexeme`: espacios antes y después. */
  lexeme<T>(fn: () => T): T {
    this.ws();
    const v = fn();
    this.ws();
    return v;
  }
  lookAhead(lit: string): boolean {
    return this.s.startsWith(lit, this.pos);
  }
  delimiter(): void {
    if (this.peek() !== ".") this.fail("delimiter (.)");
    this.pos++;
  }
}

// ─── Piezas de la gramática ─────────────────────────────────────────────────

function pQuotedValue(c: Cursor): string {
  c.char('"');
  let out = "";
  for (;;) {
    if (c.eof) c.fail('"\\""');
    const ch = c.peek();
    if (ch === '"') break;
    if (ch === "\\") {
      c.pos++;
      if (c.eof) c.fail("any character");
      out += c.peek();
      c.pos++;
      continue;
    }
    out += ch;
    c.pos++;
  }
  c.char('"');
  return out;
}

function pIdentifier(c: Cursor): string {
  const start = c.pos;
  while (!c.eof && isIdentChar(c.peek())) c.pos++;
  if (c.pos === start) c.fail("letter or digit");
  return c.s.slice(start, c.pos).trim();
}

/** `sepByDash pIdentifier`: un guion que no va seguido de `>` une partes. */
function pDashed(c: Cursor, part: (c: Cursor) => string): string {
  const parts = [part(c)];
  for (;;) {
    const more = c.attempt(() => {
      if (c.peek() !== "-" || c.peek(2) === "->") c.fail('"-"');
      c.pos++;
      return part(c);
    });
    if (more === undefined) break;
    parts.push(more);
  }
  return parts.join("-");
}

function pFieldName(c: Cursor): string {
  if (c.peek() === '"') return pQuotedValue(c);
  return pDashed(c, pIdentifier);
}

function pJsonKeyIdentifier(c: Cursor): string {
  const start = c.pos;
  while (!c.eof && !"(-:.,>)".includes(c.peek())) c.pos++;
  if (c.pos === start) c.fail("any non reserved character different from: .,>()");
  return c.s.slice(start, c.pos).trim();
}

function pJsonPath(c: Cursor): JsonOp[] {
  const path: JsonOp[] = [];
  for (;;) {
    const op = c.attempt<JsonOp>(() => {
      const arrow = c.lookAhead("->>") ? (c.string("->>") as "->>") : (c.string("->") as "->");
      // Índice: dígitos con signo opcional, y luego fin de operando.
      const idx = c.attempt(() => {
        const neg = c.peek() === "-" ? (c.pos++, "-") : "+";
        const start = c.pos;
        while (/\d/.test(c.peek())) c.pos++;
        if (c.pos === start) c.fail("digit");
        const digits = c.s.slice(start, c.pos);
        if (!(c.eof || c.lookAhead("->") || c.lookAhead("::") || c.lookAhead(".") || c.lookAhead(","))) c.fail("end of operand");
        return neg + digits;
      });
      if (idx !== undefined) return { arrow, idx };
      const key = c.peek() === '"' ? pQuotedValue(c) : pDashed(c, pJsonKeyIdentifier);
      return { arrow, key };
    });
    if (op === undefined) break;
    path.push(op);
  }
  return path;
}

function pField(c: Cursor): Field {
  return c.lexeme(() => ({ name: pFieldName(c), jsonPath: pJsonPath(c) }));
}

/** `aliasSeparator`: un `:` que no es `::`. */
function pAlias(c: Cursor): string | undefined {
  return c.attempt(() => {
    const name = pFieldName(c);
    if (c.peek() !== ":" || c.peek(2) === "::") c.fail('":"');
    c.pos++;
    return name;
  });
}

function pEmbedParams(c: Cursor): { hint?: string; joinType?: "left" | "inner" } {
  let hint: string | undefined;
  let joinType: "left" | "inner" | undefined;
  for (let i = 0; i < 2; i++) {
    const got = c.attempt(() => {
      c.char("!");
      const jt = c.attempt(() => c.string("left")) ?? c.attempt(() => c.string("inner"));
      if (jt) return { joinType: jt as "left" | "inner" };
      return { hint: pFieldName(c) };
    });
    if (!got) break;
    if ("joinType" in got) joinType ??= got.joinType;
    else hint ??= got.hint;
  }
  return { ...(hint !== undefined ? { hint } : {}), ...(joinType !== undefined ? { joinType } : {}) };
}

function selectEnd(c: Cursor): void {
  if (!(c.eof || c.lookAhead(")") || c.lookAhead(","))) c.fail('")", "," or end of input');
}

function pFieldSelect(c: Cursor): SelectItem {
  return c.lexeme(() => {
    const star = c.attempt(() => {
      c.char("*");
      selectEnd(c);
      return true;
    });
    if (star) return { kind: "field", field: { name: "*", jsonPath: [] } } as const;

    const count = c.attempt(() => {
      const alias = pAlias(c);
      c.string("count()");
      const aggCast = c.attempt(() => (c.string("::"), pIdentifier(c)));
      selectEnd(c);
      return {
        kind: "field",
        field: { name: "*", jsonPath: [] },
        aggregate: "count",
        ...(aggCast !== undefined ? { aggregateCast: aggCast } : {}),
        ...(alias !== undefined ? { alias } : {}),
      } as const;
    });
    if (count) return count;

    const alias = pAlias(c);
    const field = pField(c);
    const cast = c.attempt(() => (c.string("::"), pIdentifier(c)));
    const aggregate = c.attempt(() => {
      c.char(".");
      const name = (["sum", "avg", "count", "max", "min"] as const).find((a) => c.lookAhead(`${a}()`));
      if (!name) c.fail("aggregate");
      c.string(`${name}()`);
      return name;
    });
    const aggCast = c.attempt(() => (c.string("::"), pIdentifier(c)));
    selectEnd(c);
    return {
      kind: "field",
      field,
      ...(cast !== undefined ? { cast } : {}),
      ...(alias !== undefined ? { alias } : {}),
      ...(aggregate !== undefined ? { aggregate } : {}),
      ...(aggCast !== undefined ? { aggregateCast: aggCast } : {}),
    } as SelectItem;
  });
}

function pFieldForest(c: Cursor): SelectItem[] {
  const items: SelectItem[] = [];
  if (c.eof || c.lookAhead(")")) return items;
  for (;;) {
    items.push(pFieldTree(c));
    const sep = c.attempt(() => c.lexeme(() => c.char(",")));
    if (sep === undefined) break;
  }
  return items;
}

function pChildren(c: Cursor): SelectItem[] {
  c.char("(");
  const children = pFieldForest(c);
  c.char(")");
  return children;
}

function pFieldTree(c: Cursor): SelectItem {
  const spread = c.attempt(() =>
    c.lexeme(() => {
      c.string("...");
      const name = pFieldName(c);
      const params = pEmbedParams(c);
      if (!c.lookAhead("(")) c.fail('"("');
      return { name, params };
    }),
  );
  if (spread) return { kind: "spread", name: spread.name, ...spread.params, children: pChildren(c) };

  const rel = c.attempt(() =>
    c.lexeme(() => {
      const alias = pAlias(c);
      const name = pFieldName(c);
      if (name === "count") c.fail("relation");
      const params = pEmbedParams(c);
      if (!c.lookAhead("(")) c.fail('"("');
      return { alias, name, params };
    }),
  );
  if (rel) {
    return {
      kind: "relation",
      name: rel.name,
      ...(rel.alias !== undefined ? { alias: rel.alias } : {}),
      ...rel.params,
      children: pChildren(c),
    };
  }
  return pFieldSelect(c);
}

function pListVal(c: Cursor): string[] {
  c.lexeme(() => c.char("("));
  const values: string[] = [];
  for (;;) {
    const quoted = c.attempt(() => {
      const v = pQuotedValue(c);
      if (!(c.lookAhead(",") || c.lookAhead(")"))) c.fail('"," or ")"');
      return v;
    });
    if (quoted !== undefined) values.push(quoted);
    else {
      const start = c.pos;
      while (!c.eof && c.peek() !== "," && c.peek() !== ")") c.pos++;
      values.push(c.s.slice(start, c.pos));
    }
    if (c.peek() !== ",") break;
    c.pos++;
  }
  c.lexeme(() => c.char(")"));
  return values;
}

function pOpExpr(c: Cursor, pVal: (c: Cursor) => string): OpExpr {
  const not = c.attempt(() => (c.string("not"), c.delimiter(), true)) ?? false;
  const op =
    c.attempt<Operation>(() => (c.string("in"), c.delimiter(), { kind: "in", values: pListVal(c) })) ??
    c.attempt<Operation>(() => {
      c.string("is");
      c.delimiter();
      const v = IS_VALS.find((x) => c.peek(x.length).toLowerCase() === x);
      if (!v) c.fail("isVal: (null, not_null, true, false, unknown)");
      c.pos += v.length;
      return { kind: "is", value: v };
    }) ??
    c.attempt<Operation>(() => (c.string("isdistinct"), c.delimiter(), { kind: "isdistinct", value: pVal(c) })) ??
    c.attempt<Operation>(() => {
      const op = (["fts", "plfts", "phfts", "wfts"] as const).find((o) => c.lookAhead(o));
      if (!op) c.fail("fts");
      c.string(op);
      const lang = c.attempt(() => (c.char("("), pIdentifier(c)));
      if (lang !== undefined) c.char(")");
      c.delimiter();
      return { kind: "fts", op, ...(lang !== undefined ? { lang } : {}), value: pVal(c) };
    }) ??
    c.attempt<Operation>(() => {
      const op = SIMPLE_OPS.find((o) => c.lookAhead(o));
      if (!op) c.fail("simple operator");
      c.string(op);
      c.delimiter();
      return { kind: "simple", op, value: pVal(c) };
    }) ??
    c.attempt<Operation>(() => {
      const op = QUANT_OPS.find((o) => c.lookAhead(o));
      if (!op) c.fail("operator");
      c.string(op);
      const quant = c.attempt(() => {
        c.char("(");
        const q = c.attempt(() => c.string("any")) ?? c.string("all");
        c.char(")");
        return q as "any" | "all";
      });
      c.delimiter();
      return { kind: "quant", op, ...(quant !== undefined ? { quant } : {}), value: pVal(c) };
    });
  if (!op) c.fail("operator (eq, gt, ...)");
  return { not, op };
}

const pSingleVal = (c: Cursor): string => {
  const v = c.s.slice(c.pos);
  c.pos = c.s.length;
  return v;
};

function pLogicSingleVal(c: Cursor): string {
  const quoted = c.attempt(() => {
    const v = pQuotedValue(c);
    if (!(c.eof || c.lookAhead(",") || c.lookAhead(")"))) c.fail('"," or ")"');
    return v;
  });
  if (quoted !== undefined) return quoted;
  const arr = c.attempt(() => {
    const start = c.pos;
    c.char("{");
    while (!c.eof && c.peek() !== "{" && c.peek() !== "}") c.pos++;
    c.char("}");
    return c.s.slice(start, c.pos);
  });
  if (arr !== undefined) return arr;
  const start = c.pos;
  while (!c.eof && c.peek() !== "," && c.peek() !== ")") c.pos++;
  return c.s.slice(start, c.pos);
}

function pLogicTree(c: Cursor): LogicTree {
  const stmt = c.attempt<LogicTree>(() => {
    const field = pField(c);
    c.delimiter();
    return { kind: "stmt", filter: { field, expr: pOpExpr(c, pLogicSingleVal) } };
  });
  if (stmt) return stmt;
  const not = c.attempt(() => (c.string("not"), c.delimiter(), true)) ?? false;
  const op = (c.attempt(() => c.string("and")) ?? c.attempt(() => c.string("or"))) as "and" | "or" | undefined;
  if (!op) c.fail("logic operator (and, or)");
  c.lexeme(() => c.char("("));
  const children = [pLogicTree(c)];
  while (c.attempt(() => c.lexeme(() => c.char(","))) !== undefined) children.push(pLogicTree(c));
  c.lexeme(() => c.char(")"));
  return { kind: "expr", not, op, children };
}

function pOrder(c: Cursor): OrderTerm[] {
  const terms: OrderTerm[] = [];
  const end = () => {
    if (!(c.eof || c.lookAhead(","))) c.fail('"," or end of input');
  };
  const dirAndNulls = () => {
    const dir = (c.attempt(() => (c.delimiter(), c.string("asc"))) ?? c.attempt(() => (c.delimiter(), c.string("desc")))) as
      | "asc"
      | "desc"
      | undefined;
    const nulls = c.attempt(() => (c.delimiter(), c.string("nullsfirst"))) ? "first" : c.attempt(() => (c.delimiter(), c.string("nullslast"))) ? "last" : undefined;
    end();
    return { ...(dir ? { dir } : {}), ...(nulls ? { nulls: nulls as "first" | "last" } : {}) };
  };
  for (;;) {
    const term = c.lexeme(
      () =>
        c.attempt<OrderTerm>(() => {
          const relation = pFieldName(c);
          c.char("(");
          const field = pField(c);
          c.char(")");
          return { kind: "relation", relation, field, ...dirAndNulls() };
        }) ?? ({ kind: "field", field: pField(c), ...dirAndNulls() } as OrderTerm),
    );
    terms.push(term);
    if (c.peek() !== ",") break;
    c.pos++;
  }
  return terms;
}

// ─── Entradas ───────────────────────────────────────────────────────────────

function run<T>(what: string, input: string, fn: (c: Cursor) => T): T {
  const c = new Cursor(input);
  try {
    const v = fn(c);
    if (!c.eof) c.fail("end of input");
    return v;
  } catch (e) {
    if (!(e instanceof ParseFail)) throw e;
    const unexpected = e.pos >= input.length ? "end of input" : JSON.stringify(input[e.pos]);
    throw new PostgrestError(400, {
      code: "PGRST100",
      message: `"failed to parse ${what} (${input})" (line 1, column ${e.pos + 1})`,
      details: `unexpected ${unexpected} expecting ${e.expected}`,
      hint: null,
    });
  }
}

export function parseSelect(input: string): SelectItem[] {
  return run("select parameter", input, pFieldForest);
}

export function parseOrder(input: string): OrderTerm[] {
  return run("order", input, pOrder);
}

function parseTreePath(key: string): { path: string[]; field: Field } {
  return run("tree path", key, (c) => {
    const names = [pFieldName(c)];
    while (c.attempt(() => (c.delimiter(), true))) names.push(pFieldName(c));
    const jsonPath = pJsonPath(c);
    return { path: names.slice(0, -1), field: { name: names.at(-1)!, jsonPath } };
  });
}

export function parseFilter(key: string, value: string): { path: EmbedPath; filter: Filter } {
  const { path, field } = parseTreePath(key);
  const expr = run("filter", value, (c) => pOpExpr(c, pSingleVal));
  return { path, filter: { field, expr } };
}

export function parseLogicTree(key: string, value: string): { path: EmbedPath; tree: LogicTree } {
  const names = run("logic path", key, (c) => {
    const out = [pFieldName(c)];
    while (c.attempt(() => (c.delimiter(), true))) out.push(pFieldName(c));
    return out;
  });
  const op = names.at(-1)!;
  const path = names.slice(0, -1).filter((n) => n !== "not");
  const opWithNot = names.includes("not") ? `not.${op}` : op;
  const tree = run("logic tree", opWithNot + value, pLogicTree);
  return { path, tree };
}

export function parseColumns(input: string): string[] {
  return run("columns parameter", input, (c) => {
    const cols = [pFieldName(c)];
    while (c.attempt(() => c.lexeme(() => c.char(","))) !== undefined) cols.push(pFieldName(c));
    return cols;
  });
}

export interface ParsedQuery {
  readonly select: SelectItem[];
  readonly filters: { path: EmbedPath; filter: Filter }[];
  readonly logic: { path: EmbedPath; tree: LogicTree }[];
  readonly order: { path: EmbedPath; terms: OrderTerm[] }[];
  /** Por camino embebido unido con «.» («» = la raíz). */
  readonly ranges: Record<string, { offset: number; limit: number | null }>;
  readonly columns: string[] | null;
  readonly onConflict: string[] | null;
  /** Los parámetros sin operador de una lectura RPC (`GET /rpc/f?a=1`). */
  readonly rpcParams: [string, string][];
}

const RESERVED = new Set(["select", "columns", "on_conflict"]);
const RESERVED_EMBEDDABLE = new Set(["order", "limit", "offset", "and", "or"]);

/** `HTTP.parseQueryReplacePlus True`: `+` es espacio. */
function decodeQueryString(qs: string): [string, string | null][] {
  if (!qs) return [];
  return qs
    .split("&")
    .filter((p) => p.length > 0)
    .map((p) => {
      const eq = p.indexOf("=");
      const dec = (s: string) => decodeURIComponent(s.replace(/\+/g, " "));
      return eq === -1 ? [dec(p), null] : [dec(p.slice(0, eq)), dec(p.slice(eq + 1))];
    });
}

export function parseQueryString(qs: string, opts: { isRpcRead?: boolean } = {}): ParsedQuery {
  const params = decodeQueryString(qs.startsWith("?") ? qs.slice(1) : qs);
  const lookup = (k: string) => params.find(([key]) => key === k)?.[1] ?? undefined;
  const nonEmpty = params.filter((p): p is [string, string] => p[1] !== null && p[1] !== "");
  const lastWord = (k: string) => k.split(".").at(-1)!;

  const selectRaw = lookup("select");
  const select = parseSelect(selectRaw === undefined || selectRaw === null ? "*" : selectRaw);

  const filters: ParsedQuery["filters"] = [];
  const rpcParams: [string, string][] = [];
  for (const [k, v] of nonEmpty) {
    if (RESERVED.has(k) || RESERVED_EMBEDDABLE.has(lastWord(k))) continue;
    if (opts.isRpcRead) {
      try {
        filters.push(parseFilter(k, v));
      } catch {
        rpcParams.push([k, v]);
      }
    } else {
      filters.push(parseFilter(k, v));
    }
  }

  const logic = nonEmpty.filter(([k]) => ["and", "or"].includes(lastWord(k))).map(([k, v]) => parseLogicTree(k, v));
  const order = nonEmpty
    .filter(([k]) => lastWord(k) === "order")
    .map(([k, v]) => ({ path: k.split(".").slice(0, -1), terms: parseOrder(v) }));

  const ranges: ParsedQuery["ranges"] = {};
  const rangeKey = (k: string) => k.split(".").slice(0, -1).join(".");
  for (const [k, v] of nonEmpty) {
    const w = lastWord(k);
    if (w !== "limit" && w !== "offset") continue;
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n) || String(n) !== v.trim()) continue; // `readMaybe`: lo que no es un número, no cuenta
    const key = rangeKey(k);
    const r = (ranges[key] ??= { offset: 0, limit: null });
    if (w === "limit") r.limit = Math.max(0, n);
    else r.offset = Math.max(0, n);
  }

  const columnsRaw = lookup("columns");
  const onConflictRaw = lookup("on_conflict");
  return {
    select,
    filters,
    logic,
    order,
    ranges,
    columns: columnsRaw ? parseColumns(columnsRaw) : null,
    onConflict: onConflictRaw ? run("on_conflict parameter", onConflictRaw, (c) => {
      const cols = [pFieldName(c)];
      while (c.attempt(() => c.lexeme(() => c.char(","))) !== undefined) cols.push(pFieldName(c));
      return cols;
    }) : null,
    rpcParams,
  };
}
