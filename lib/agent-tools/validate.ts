// THE CHECKS OF A CALL ON AN AGENT TOOL'S DATA (spec local 2026-11-22-herramienta-dentro-del-agente, §3): the agent's
// `tool_data` and the tool's own page (`window.openlen.data`, through the bridge's route) reach the same database, so they
// are checked by the same rules and with the same sentences — one copy. `matchQuery` and the store trust their input; what a
// model or a page sends is read here, with a sentence for each way it can be wrong.
//
// The two callers speak different wire names (the agent says `doc_id`, the page `docId`), so the sentences name the one the
// caller uses (`idName`). Pure: no database, no session.
import { AGENT_TOOL_QUERY_LIMIT_MAX } from "./limits";
import type { AgentToolQuery, QueryOp } from "./query";
import type { DataWrite } from "./store";

export const QUERY_OPS = ["==", "!=", "<", "<=", ">", ">="] as const satisfies readonly QueryOp[];

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Text that isn't blank, exactly as given (a collection or a document id is never trimmed). */
export const nonBlank = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

/** `query`, checked: a sentence for each way it can be wrong, and a refusal of what it doesn't take (a typo like `orderby`
 *  would silently change the answer). */
export function parseQuery(raw: unknown): { query: AgentToolQuery } | { problem: string } {
  if (raw === undefined) return { query: {} };
  if (!isRecord(raw)) return { problem: "query must be an object like { where: [{ field, op, value }], orderBy: { field, direction }, limit }." };
  for (const key of Object.keys(raw)) {
    if (key !== "where" && key !== "orderBy" && key !== "limit") return { problem: `query has no "${key}": it takes where, orderBy and limit.` };
  }
  const query: AgentToolQuery = {};

  if (raw.where !== undefined) {
    if (!Array.isArray(raw.where)) return { problem: "query.where must be a list of conditions: [{ field, op, value }]." };
    const where: { field: string; op: QueryOp; value: unknown }[] = [];
    for (const [i, c] of raw.where.entries()) {
      if (!isRecord(c)) return { problem: `query.where[${i}] must be an object like { field, op, value }.` };
      for (const key of Object.keys(c)) {
        if (key !== "field" && key !== "op" && key !== "value") return { problem: `query.where[${i}] has no "${key}": a condition takes field, op and value.` };
      }
      const field = nonBlank(c.field);
      if (field === null) return { problem: `query.where[${i}].field must be the path of a field, as text.` };
      if (typeof c.op !== "string" || !(QUERY_OPS as readonly string[]).includes(c.op)) return { problem: `query.where[${i}].op must be one of ${QUERY_OPS.join(" ")}.` };
      if (!("value" in c)) return { problem: `query.where[${i}].value is required: what the field is compared with.` };
      where.push({ field, op: c.op as QueryOp, value: c.value });
    }
    query.where = where;
  }

  if (raw.orderBy !== undefined) {
    if (!isRecord(raw.orderBy)) return { problem: 'query.orderBy must be an object like { field: "age", direction: "desc" }.' };
    for (const key of Object.keys(raw.orderBy)) {
      if (key !== "field" && key !== "direction") return { problem: `query.orderBy has no "${key}": it takes field and direction.` };
    }
    const field = nonBlank(raw.orderBy.field);
    if (field === null) return { problem: "query.orderBy.field must be the path of a field, as text." };
    const { direction } = raw.orderBy;
    if (direction !== undefined && direction !== "asc" && direction !== "desc") return { problem: 'query.orderBy.direction must be "asc" or "desc".' };
    query.orderBy = direction === undefined ? { field } : { field, direction };
  }

  if (raw.limit !== undefined) {
    const { limit } = raw;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > AGENT_TOOL_QUERY_LIMIT_MAX) {
      return { problem: `query.limit must be a whole number from 1 to ${AGENT_TOOL_QUERY_LIMIT_MAX}.` };
    }
    query.limit = limit;
  }
  return { query };
}

export type ReadAction = "get" | "list" | "query";
export type WriteAction = "set" | "update" | "delete";

/** What a caller names in one call: whatever it sent, not yet trusted. */
export interface DataInput {
  collection?: unknown;
  docId?: unknown;
  data?: unknown;
  query?: unknown;
}

/** A read, checked. `collection` is null only for a `list` that names none, `docId` is null unless it is a `get`. */
export function parseRead(action: ReadAction, input: DataInput, idName = "doc_id"): { collection: string | null; docId: string | null; query: AgentToolQuery } | { problem: string } {
  const collection = nonBlank(input.collection);
  const docId = nonBlank(input.docId);
  if (action !== "list" && collection === null) return { problem: `collection is required for ${action}.` };
  if (action === "get" && docId === null) return { problem: `${idName} is required for get.` };
  const parsed = action === "query" ? parseQuery(input.query) : { query: {} as AgentToolQuery };
  if ("problem" in parsed) return parsed;
  return { collection, docId: action === "get" ? docId : null, query: parsed.query };
}

/** A write, checked: the one document it touches. */
export function parseWrite(action: WriteAction, input: DataInput, idName = "doc_id"): { write: DataWrite } | { problem: string } {
  const collection = nonBlank(input.collection);
  if (collection === null) return { problem: `collection is required for ${action}.` };
  const docId = nonBlank(input.docId);
  if (docId === null) return { problem: `${idName} is required for ${action}.` };
  if (action === "delete") return { write: { op: "delete", collection, docId } };
  if (!isRecord(input.data)) return { problem: `data is required for ${action}: the document, a JSON object.` };
  return { write: { op: action, collection, docId, data: input.data } };
}
