// HER CONVERSATIONS FOR HER OWNER (spec local 2026-11-06-asistente-propio, §1 «le cuenta qué pasó», §6.5; phase 4E):
// what `list_messages` lists in HER chat (lib/agent/resultados.ts). On the pages she serves her bubble IS the page's
// chat, so her visits are listed the way the page's inbox lists its conversations (lib/resultados/mensajes.ts): the
// newest first, unread as the visitor's lines after the owner's read mark (`assistantVisits.readAt`, which only the
// owner's seeing them in her Conversaciones sets), and of each, what she noted for the owner from it and how that went.
// Measured 10/11: without this she told her owner «ayer no pasó nada» right after her summary said she talked with two.
// Re-measured 10/11 with it (plan …-fase-4e, task 6, Jesús's OK, cap 1.5 credits): «¿Qué pasó ayer con los clientes?» →
// list_messages by_date for yesterday, both conversations opened with which="one", both told with what each wanted and
// what she noted (80 centicredits; 108 in all with two visitors and a memory note).
import "server-only";

import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import { titlesOf } from "../projects";
import { VISIT_RETENTION_DAYS, visitsOf, type VisitRow } from "./store";

export type HerFilter = { which: "unread" } | { which: "by_date"; from?: string; to?: string };
export type NotedStatus = "pending" | "accepted" | "dismissed";
export interface Noted {
  request: string;
  status: NotedStatus;
}

export interface HerConversationInList {
  id: string;
  project: string | null;
  /** The last line's text, the visitor's or hers. */
  last: string;
  /** The last line's day in the owner's zone, YYYY-MM-DD. */
  date: string;
  unread: number;
  noted: Noted[];
}

export interface HerConversationsSummary {
  conversations: number;
  unreadConversations: number;
  unreadMessages: number;
  list: HerConversationInList[];
}

export interface HerConversation {
  id: string;
  project: string | null;
  messages: { from: "visitor" | "you"; text: string; date: string }[];
  noted: Noted[];
}

/** A list says at most this many, as the page's inbox gives one screen. */
const LIST_MAX = 50;
/** Her newest visits looked at for a list (she keeps 90 days of them). */
const SCAN = 500;
/** Without a range, the last 7 days, like `list_form_submissions`. */
const DEFAULT_DAYS = 7;
const DAY_MS = 86_400_000;
/** Bounded as the page's inbox (lib/resultados/mensajes.ts: `recortar`, `ULTIMOS`), so a result never reaches the spill
 *  threshold: a spilled result is a FILE, written in her box on a paid plan, and visitors' data never enters it
 *  (invariant 5; final review I3). */
const LAST_MAX = 120;
const LINES_MAX = 30;
const cut = (s: string) => (s.length > LAST_MAX ? `${s.slice(0, LAST_MAX)}…` : s);

const v = schema.assistantVisits;
const r = schema.assistantRequests;
const c = schema.assistantRequestCards;

/** The day of `at` in `zone`, YYYY-MM-DD; a zone the platform doesn't know reads as UTC. */
export function dayIn(zone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** The visitor's lines after the owner's read mark; all of them before any. */
function unreadOf(visit: VisitRow): number {
  const since = visit.readAt?.getTime() ?? -Infinity;
  return visit.lines.filter((l) => l.role === "visitor" && Date.parse(l.at) > since).length;
}

/** What she noted from each of these visits (one visitor per project), oldest first, with how the card went. */
async function notedOf(assistantId: string, visits: readonly VisitRow[]): Promise<Map<string, Noted[]>> {
  const out = new Map<string, Noted[]>();
  if (visits.length === 0) return out;
  const rows = await db
    .select({ projectId: r.projectId, visitorId: r.visitorId, text: r.text, cardId: r.cardId, at: r.at })
    .from(r)
    .where(and(eq(r.assistantId, assistantId), isNull(r.discardedAt), inArray(r.projectId, [...new Set(visits.map((x) => x.projectId))]), inArray(r.visitorId, [...new Set(visits.map((x) => x.visitorId))])));
  const cardIds = [...new Set(rows.map((x) => x.cardId).filter((id): id is string => Boolean(id)))];
  const cards = cardIds.length ? await db.select({ id: c.id, status: c.status }).from(c).where(inArray(c.id, cardIds)) : [];
  const statusOf = new Map(cards.map((x) => [x.id, x.status]));
  const visitOf = new Map(visits.map((x) => [`${x.projectId}\u0000${x.visitorId}`, x.id]));
  for (const row of [...rows].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const id = visitOf.get(`${row.projectId}\u0000${row.visitorId}`);
    if (!id) continue;
    const status = (row.cardId ? statusOf.get(row.cardId) : undefined) ?? "pending";
    out.set(id, [...(out.get(id) ?? []), { request: row.text, status }]);
  }
  return out;
}

export async function herConversations(assistantId: string, zone: string, filter: HerFilter, now: Date = new Date()): Promise<HerConversationsSummary> {
  const all = (await visitsOf(assistantId, SCAN, now)).filter((x) => x.lines.length > 0);
  const unread = new Map(all.map((x) => [x.id, unreadOf(x)]));
  let chosen: VisitRow[];
  if (filter.which === "unread") {
    chosen = all.filter((x) => (unread.get(x.id) ?? 0) > 0);
  } else {
    // A conversation is in the range when any of its lines is, as her morning summary counts a day (summary/count.ts).
    const from = filter.from ?? dayIn(zone, new Date(now.getTime() - (DEFAULT_DAYS - 1) * DAY_MS));
    const to = filter.to ?? dayIn(zone, now);
    chosen = all.filter((x) => x.lines.some((l) => {
      const day = dayIn(zone, new Date(l.at));
      return day >= from && day <= to;
    }));
  }
  chosen = chosen.slice(0, LIST_MAX);
  const [titles, noted] = await Promise.all([titlesOf(chosen.map((x) => x.projectId)), notedOf(assistantId, chosen)]);
  return {
    conversations: all.length,
    unreadConversations: all.filter((x) => (unread.get(x.id) ?? 0) > 0).length,
    unreadMessages: [...unread.values()].reduce((s, n) => s + n, 0),
    list: chosen.map((x) => {
      const last = x.lines[x.lines.length - 1]!;
      return {
        id: x.id,
        project: titles.get(x.projectId) ?? null,
        last: cut(last.text),
        date: dayIn(zone, new Date(last.at)),
        unread: unread.get(x.id) ?? 0,
        noted: noted.get(x.id) ?? [],
      };
    }),
  };
}

/** One of HER conversations, every line kept; null for an id that isn't hers or is past the 90 days. */
export async function herConversation(assistantId: string, zone: string, id: string, now: Date = new Date()): Promise<HerConversation | null> {
  const cutoff = new Date(now.getTime() - VISIT_RETENTION_DAYS * DAY_MS);
  const [visit] = await db
    .select()
    .from(v)
    .where(and(eq(v.id, id), eq(v.assistantId, assistantId), gte(v.lastAt, cutoff)))
    .limit(1);
  if (!visit) return null;
  const [titles, noted] = await Promise.all([titlesOf([visit.projectId]), notedOf(assistantId, [visit])]);
  return {
    id: visit.id,
    project: titles.get(visit.projectId) ?? null,
    messages: visit.lines.slice(-LINES_MAX).map((l) => ({ from: l.role === "visitor" ? "visitor" : "you", text: l.text, date: dayIn(zone, new Date(l.at)) })),
    noted: noted.get(visit.id) ?? [],
  };
}

export interface SeenVisit {
  readonly id: string;
  /** The `lastAt` of the conversation as it was shown. */
  readonly lastAt: Date;
}

/** Her owner saw these in her Conversaciones: each of HER visits among `seen` is read up to the last line it showed —
 *  never past `now`, never back. Not «up to now» (final review I1): a visitor line's `at` is its turn's start, saved
 *  after the answer, and the phone marks when «Conversaciones» is tapped, maybe minutes after loading; what came after
 *  what was shown stays unread. Another's ids are left alone. */
export async function markHerVisitsRead(assistantId: string, seen: readonly SeenVisit[], now: Date): Promise<number> {
  const upTo = new Map<string, number>();
  for (const s of seen) upTo.set(s.id, Math.max(upTo.get(s.id) ?? -Infinity, Math.min(now.getTime(), s.lastAt.getTime())));
  let marked = 0;
  for (const [id, ms] of upTo) {
    const rows = await db
      .update(v)
      // Postgres's greatest() skips a null: the first mark is the shown time.
      .set({ readAt: sql`greatest(${v.readAt}, ${new Date(ms).toISOString()}::timestamptz)` })
      .where(and(eq(v.assistantId, assistantId), eq(v.id, id)))
      .returning({ id: v.id });
    marked += rows.length;
  }
  return marked;
}
