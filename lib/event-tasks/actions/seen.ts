// WHAT A JUDGING TURN READ (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.6.4, §7.6.6): the keys of the
// rows and the addresses that came in the candidate and through `source_read`. A data change may touch only one of those
// rows, and a reply go only to one of those addresses — the judge can't invent either. For the sources whose channel is
// a conversation or an issue, the conversations (`conversation_id`, named by `visitor`) and the issues and pull requests
// (`number`, named by `title`) too — only where that channel is offered, so a table's own `number` column is no issue.
import type { ReplyChannel } from "../sources/types";

const ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const DEPTH = 3;

export interface Seen {
  readonly keys: Set<string>;
  readonly addresses: Set<string>;
  /** Conversation id → the visitor's name. */
  readonly conversations: Map<string, string>;
  /** Issue or pull request number → its title. */
  readonly threads: Map<string, string>;
}

export const emptySeen = (): Seen => ({ keys: new Set(), addresses: new Set(), conversations: new Map(), threads: new Map() });

/** A row's conversation or issue, for the channels the source offers. */
function channelsOf(row: Record<string, unknown>, into: Seen, channels: readonly ReplyChannel[]): void {
  if (channels.includes("chat") && typeof row.conversation_id === "string" && row.conversation_id) {
    into.conversations.set(row.conversation_id, typeof row.visitor === "string" ? row.visitor : "");
  }
  const n = row.number;
  if (channels.includes("github") && ((typeof n === "number" && Number.isInteger(n)) || (typeof n === "string" && /^\d+$/.test(n)))) {
    into.threads.set(String(n), typeof row.title === "string" ? row.title : "");
  }
}

function addresses(v: unknown, into: Seen, depth: number): void {
  if (typeof v === "string") {
    const a = v.trim();
    if (a.length <= 254 && ADDRESS.test(a)) into.addresses.add(a.toLowerCase());
    return;
  }
  if (depth >= DEPTH || !v || typeof v !== "object") return;
  for (const x of Array.isArray(v) ? v : Object.values(v)) addresses(x, into, depth + 1);
}

/** A row's key: the table's key column, else a form submission's own `id`. */
const keyOf = (row: Record<string, unknown>, keyColumn: string | null): unknown => (keyColumn && row[keyColumn] !== undefined ? row[keyColumn] : row.id);

/** What a `source_read` answered: its `items`, `matching` and `previous` rows. */
export function collectSeen(read: unknown, keyColumn: string | null, into: Seen, channels: readonly ReplyChannel[] = []): void {
  if (!read || typeof read !== "object") return;
  const r = read as Record<string, unknown>;
  for (const list of [r.items, r.matching, r.previous]) {
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      const key = keyOf(row as Record<string, unknown>, keyColumn);
      if (key !== undefined && key !== null) into.keys.add(String(key));
      addresses(row, into, 0);
      channelsOf(row as Record<string, unknown>, into, channels);
    }
  }
}

/** What the candidate itself brought: each change's row (its key, else its link) and its addresses. */
export function seenOfCandidate(candidate: unknown, keyColumn: string | null, channels: readonly ReplyChannel[] = []): Seen {
  const seen = emptySeen();
  const changes = (candidate as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(changes)) return seen;
  for (const c of changes) {
    const change = (c && typeof c === "object" ? c : {}) as { detail?: Record<string, unknown>; link?: unknown };
    const key = (keyColumn && change.detail?.[keyColumn] !== undefined ? change.detail[keyColumn] : undefined) ?? change.link;
    if (key !== undefined && key !== null) seen.keys.add(String(key));
    addresses(change.detail, seen, 0);
    if (change.detail) channelsOf(change.detail, seen, channels);
  }
  return seen;
}
