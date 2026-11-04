// THE `visitor_chat` SOURCE (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.4.1, §7.6.1): what visitors of
// the published page write to the business in its chat — the Super-agent's Feishu chat — or, with `watch: "signups"`,
// who signs up to it. Only conversations where the business (the project's chat user with role «owner») is one of the
// two users: a message between two visitors stays private even from the owner, as the inbox's count has it
// (lib/inbox/badge.ts), and the business's own messages — the AI agents post as it — are not news. DeepSeek's source
// defines what it listens to and drops the rest before it enters. Its channel: answering in that conversation, as the
// business (../actions/channels/chat.ts). The cursor is the time as Postgres wrote it (text), plus the id.
import "server-only";

import { and, asc, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";

import { db, schema } from "@/lib/db";

import { visitorChatParamsSchema } from "./declarations";
import { MATCHING_MAX, SourceError, type EventSource, type SourceChange, type SourceMatch } from "./types";

export interface VisitorChatParams {
  readonly watch?: "messages" | "signups";
  readonly conditions?: readonly { readonly field: string; readonly op: "eq" | "neq" | "contains" | "gt" | "lt" | "exists"; readonly value?: string | number }[];
}

export interface VisitorChatState {
  readonly cursor: { readonly at: string; readonly id: string };
}

const PAGE = 200;
const BEFORE = 20;
/** A conversation's last messages, as the judge reads one. */
const THREAD = 20;
const SUMMARY_CHARS = 80;
const START = { at: "-infinity", id: "" } as const;

const m = schema.chatMessages;
const c = schema.chatConversations;
const e = schema.chatEvents;
const business = alias(schema.chatUsers, "business");
const visitor = alias(schema.chatUsers, "visitor");
const messageAt = sql<string>`${m.createdAt}::text`;
const eventAt = sql<string>`${e.createdAt}::text`;

const paramsSchema = visitorChatParamsSchema as unknown as z.ZodType<VisitorChatParams>;

interface MessageRow {
  readonly id: string;
  readonly conversationId: string;
  readonly businessId: string;
  readonly body: string;
  readonly at: string;
  readonly name: string | null;
  readonly username: string | null;
  readonly email: string | null;
  readonly origin: string | null;
}

interface SignupRow {
  readonly id: string;
  readonly chatUserId: string | null;
  readonly at: string;
  readonly name: string | null;
  readonly username: string | null;
  readonly email: string | null;
}

const nameOf = (r: { readonly name: string | null; readonly username: string | null }) => r.name || r.username || "";

/** A visitor's message to the business, as the judge reads it. */
const messageDetail = (r: MessageRow) => ({
  message_id: r.id,
  conversation_id: r.conversationId,
  visitor: nameOf(r),
  visitor_email: r.email ?? null,
  text: r.body,
  handoff: r.origin === "ai_handoff",
});

const signupDetail = (r: SignupRow) => ({ chat_user_id: r.chatUserId, visitor: nameOf(r), visitor_email: r.email ?? null });

/** The visitors' messages in the project's conversations with the business, matching `where`. */
function messagesWhere(projectId: string, where: SQL | undefined, order: "asc" | "desc", limit: number): Promise<MessageRow[]> {
  const sort = order === "asc" ? [asc(m.createdAt), asc(m.id)] : [desc(m.createdAt), desc(m.id)];
  return db
    .select({ id: m.id, conversationId: m.conversationId, businessId: business.id, body: m.body, at: messageAt, name: visitor.displayName, username: visitor.username, email: visitor.email, origin: c.origin })
    .from(m)
    .innerJoin(c, eq(c.id, m.conversationId))
    .innerJoin(business, and(eq(business.projectId, c.projectId), eq(business.role, "owner")))
    .leftJoin(visitor, eq(visitor.id, m.authorId))
    .where(and(eq(c.projectId, projectId), or(eq(c.aUserId, business.id), eq(c.bUserId, business.id)), ne(m.authorId, business.id), where))
    .orderBy(...sort)
    .limit(limit) as Promise<MessageRow[]>;
}

/** The project's chat sign-ups, matching `where`. */
function signupsWhere(projectId: string, where: SQL | undefined, order: "asc" | "desc", limit: number): Promise<SignupRow[]> {
  const sort = order === "asc" ? [asc(e.createdAt), asc(e.id)] : [desc(e.createdAt), desc(e.id)];
  return db
    .select({ id: e.id, chatUserId: e.chatUserId, at: eventAt, name: visitor.displayName, username: visitor.username, email: visitor.email })
    .from(e)
    .leftJoin(visitor, eq(visitor.id, e.chatUserId))
    .where(and(eq(e.projectId, projectId), eq(e.type, "register"), where))
    .orderBy(...sort)
    .limit(limit) as Promise<SignupRow[]>;
}

const afterMessage = (cursor: VisitorChatState["cursor"]) =>
  sql`(${m.createdAt} > ${cursor.at}::timestamp OR (${m.createdAt} = ${cursor.at}::timestamp AND ${m.id} > ${cursor.id}))`;
const afterSignup = (cursor: VisitorChatState["cursor"]) =>
  sql`(${e.createdAt} > ${cursor.at}::timestamp OR (${e.createdAt} = ${cursor.at}::timestamp AND ${e.id} > ${cursor.id}))`;

/** A conversation's last messages, oldest first, each said by the visitor or the business. */
async function threadOf(conversationId: string, businessId: string): Promise<{ from: "visitor" | "business"; text: string; at: string }[]> {
  const rows = await db
    .select({ authorId: m.authorId, body: m.body, at: messageAt })
    .from(m)
    .where(eq(m.conversationId, conversationId))
    .orderBy(desc(m.createdAt), desc(m.id))
    .limit(THREAD);
  return rows.reverse().map((r) => ({ from: r.authorId === businessId ? "business" : "visitor", text: r.body, at: r.at }));
}

const MATCHABLE = { messages: ["conversation_id", "visitor_email"], signups: ["visitor_email"] } as const;

function matchWhere(watch: "messages" | "signups", match: readonly SourceMatch[]): SQL | undefined {
  const allowed: readonly string[] = MATCHABLE[watch];
  const wrong = match.find((x) => !allowed.includes(x.field));
  if (wrong) throw new SourceError("column_missing", `visitor_chat can match ${allowed.join(" or ")}.`);
  return and(...match.map((x) => (x.field === "conversation_id" ? eq(m.conversationId, x.value) : eq(visitor.email, x.value))));
}

const watchOf = (params: VisitorChatParams) => params.watch ?? "messages";

export const visitorChatSource: EventSource<VisitorChatParams, VisitorChatState> = {
  kind: "visitor_chat",
  paramsSchema,
  // Answered in the conversation, as the business; or by email, when the visitor gave one and the project's email is ready.
  offers: { dataChange: false, replies: ["chat", "email"] },

  async validate(projectId, params) {
    // Always: a chat with no conversation yet is still a chat to watch. What exists now never fires.
    if (watchOf(params) === "signups") {
      const [last] = await signupsWhere(projectId, undefined, "desc", 1);
      return { ok: true, initialState: { cursor: last ? { at: last.at, id: last.id } : START } };
    }
    const [last] = await messagesWhere(projectId, undefined, "desc", 1);
    return { ok: true, initialState: { cursor: last ? { at: last.at, id: last.id } : START } };
  },

  async observe(projectId, params, state) {
    if (watchOf(params) === "signups") {
      const rows = await signupsWhere(projectId, afterSignup(state.cursor), "asc", PAGE);
      if (rows.length === 0) return { state, changes: [] };
      const changes: SourceChange[] = rows.map((r) => {
        const detail = signupDetail(r);
        return { subject: "chat_signup", summary: [detail.visitor, detail.visitor_email].filter(Boolean).join(" · "), detail, link: r.id, at: r.at };
      });
      const last = rows.at(-1)!;
      return { state: { cursor: { at: last.at, id: last.id } }, changes };
    }
    const rows = await messagesWhere(projectId, afterMessage(state.cursor), "asc", PAGE);
    if (rows.length === 0) return { state, changes: [] };
    const changes: SourceChange[] = rows.map((r) => {
      const detail = messageDetail(r);
      const text = r.body.length > SUMMARY_CHARS ? `${r.body.slice(0, SUMMARY_CHARS)}…` : r.body;
      return { subject: "chat", summary: `${detail.visitor}: ${text}`, detail, link: r.id, at: r.at };
    });
    const last = rows.at(-1)!;
    return { state: { cursor: { at: last.at, id: last.id } }, changes };
  },

  async read(projectId, params, { keys, match }) {
    const watch = watchOf(params);
    const matched = match?.length ? matchWhere(watch, match) : undefined;
    if (watch === "signups") {
      const row = (r: SignupRow) => ({ id: r.id, ...signupDetail(r), at: r.at });
      const items = keys.length === 0 ? [] : (await signupsWhere(projectId, inArray(e.id, [...keys]), "desc", keys.length)).map(row);
      const previous = (await signupsWhere(projectId, undefined, "desc", BEFORE)).map(row);
      if (!matched) return { items, previous };
      return { items, previous, matching: (await signupsWhere(projectId, matched, "desc", MATCHING_MAX)).map(row) };
    }
    const row = (r: MessageRow) => ({ id: r.id, ...messageDetail(r), at: r.at });
    const found = keys.length === 0 ? [] : await messagesWhere(projectId, inArray(m.id, [...keys]), "desc", keys.length);
    const items = await Promise.all(found.map(async (r) => ({ ...row(r), thread: await threadOf(r.conversationId, r.businessId) })));
    const previous = (await messagesWhere(projectId, undefined, "desc", BEFORE)).map(row);
    if (!matched) return { items, previous };
    return { items, previous, matching: (await messagesWhere(projectId, matched, "desc", MATCHING_MAX)).map(row) };
  },
};
