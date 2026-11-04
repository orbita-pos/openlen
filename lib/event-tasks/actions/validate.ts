// A CARD'S ACTIONS ARE CHECKED BEFORE THE CARD EXISTS (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.1,
// §7.6.4): what the judge proposes must be something «Hazlo» can do. Only what the source offers (DeepSeek's rules and
// channels); a data change on the watched table, on a row the judge read in this turn, never its key or its creation
// column, with values that fit their columns; a reply only to an address the judge read. Each refusal is a sentence the
// judge can act on. Production is only read, through the context. A reply goes only by a channel the source offers, and
// only to an address, a conversation or an issue the judge read.
import type { ReplyChannel } from "../sources/types";
import { MAX_ACTIONS, type CardAction } from "./types";

export interface ValidationContext {
  readonly available: { readonly project: true; readonly dataChange: boolean; readonly replyChannels: readonly ReplyChannel[] };
  readonly table?: string;
  readonly keyColumn?: string;
  readonly createdColumn?: string;
  readonly columns?: readonly { readonly name: string; readonly type: string }[];
  readonly seenKeys: ReadonlySet<string>;
  readonly seenAddresses: ReadonlySet<string>;
  readonly seenConversations: ReadonlyMap<string, string>;
  readonly seenThreads: ReadonlyMap<string, string>;
  /** A card about no row or person is about its record. */
  readonly recordId: string;
  readRow(key: string): Promise<Record<string, unknown> | null>;
  castCheck(column: string, value: string): Promise<string | null>;
}

export type Validated = { ok: true; actions: CardAction[]; subjectKey: string } | { ok: false; error: string };

const ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const SUBJECT_MAX = 200;
const BODY_MAX = 5000;
/** The inbox's own cap on a message from the business (app/api/inbox/[conversationId]/reply). */
const CHAT_BODY_MAX = 4000;
const no = (error: string): Validated => ({ ok: false, error });
const text = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
export const normalizeAddress = (a: string) => a.trim().toLowerCase();

/** `[{column, value}]` as declared, or a plain object as a model may send it. */
function pairs(v: unknown): [string, string][] {
  if (Array.isArray(v)) return v.flatMap((p) => (p && typeof p === "object" && typeof (p as { column?: unknown }).column === "string" ? [[(p as { column: string }).column, String((p as { value?: unknown }).value ?? "")] as [string, string]] : []));
  if (v && typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, String(x ?? "")]);
  return [];
}

const asText = (v: unknown): string | null => (v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : String(v));

async function dataChange(a: Record<string, unknown>, ctx: ValidationContext): Promise<CardAction | string> {
  const { table, keyColumn, createdColumn, columns } = ctx;
  if (!table || !keyColumn || !columns) return "This task's source has no table whose rows can be changed.";
  if (text(a.table) !== table) return `A data_change can only change the watched table, ${table}.`;
  const key = typeof a.key === "string" || typeof a.key === "number" ? String(a.key) : a.key && typeof a.key === "object" ? String((a.key as Record<string, unknown>)[keyColumn] ?? "") : "";
  if (!key) return `A data_change needs key: the value of ${keyColumn} of the row.`;
  if (!ctx.seenKeys.has(key)) return `Row ${key} isn't one you read in this turn: change only a row from the change or from source_read.`;
  const set = pairs(a.set);
  if (set.length === 0) return "A data_change needs set: the columns to change and their new values.";
  const editable = columns.map((c) => c.name).filter((n) => n !== keyColumn && n !== createdColumn);
  for (const [column] of set) {
    if (column === keyColumn) return `"${column}" is the table's key and can't be changed.`;
    if (column === createdColumn) return `"${column}" says when the row was created and can't be changed.`;
    if (!columns.some((c) => c.name === column)) return `Table ${table} has no column "${column}". Columns you may change: ${editable.join(", ")}.`;
  }
  let row: Record<string, unknown> | null;
  try {
    row = await ctx.readRow(key);
  } catch (err) {
    return `Production could not be read: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (!row) return `Row ${key} no longer exists.`;
  for (const [column, value] of set) {
    const wrong = await ctx.castCheck(column, value);
    if (wrong) return `"${value}" doesn't fit column ${column} (${columns.find((c) => c.name === column)!.type}): ${wrong}`;
  }
  return {
    kind: "data_change",
    table,
    key: { [keyColumn]: key },
    set: Object.fromEntries(set),
    before: Object.fromEntries(set.map(([column]) => [column, asText(row![column])])),
  };
}

function reply(a: Record<string, unknown>, ctx: ValidationContext): CardAction | string {
  const offered = ctx.available.replyChannels;
  // Without a channel: the only one offered, else email — what a reply was before the channels.
  const channel = text(a.channel) || (offered.length === 1 ? offered[0]! : "email");
  if (!(offered as readonly string[]).includes(channel)) return `This task's source replies by: ${offered.join(", ")}.`;
  if (channel === "chat") return chatReply(a, ctx);
  if (channel === "github") return githubReply(a, ctx);
  const to = normalizeAddress(text(a.to));
  if (!ADDRESS.test(to)) return "A reply needs to: one email address.";
  if (!ctx.seenAddresses.has(to)) return `${to} isn't an address you read in this turn: a reply goes only to someone in the data.`;
  const subject = text(a.subject).replace(/[\r\n]+/g, " ");
  const body = text(a.body);
  if (!subject || !body) return "A reply needs a subject and a body.";
  if (subject.length > SUBJECT_MAX || body.length > BODY_MAX) return `A reply's subject is at most ${SUBJECT_MAX} characters and its body ${BODY_MAX}.`;
  return { kind: "reply", channel: "email", to, toLabel: to, subject, body };
}

/** In the page's chat, as the business, in a conversation the judge read. */
function chatReply(a: Record<string, unknown>, ctx: ValidationContext): CardAction | string {
  const to = text(a.to);
  const visitor = ctx.seenConversations.get(to);
  if (visitor === undefined) return `${to || "(no to)"} isn't a conversation you read in this turn: a chat reply goes only to one from the data.`;
  const body = text(a.body);
  if (!body) return "A reply needs a body.";
  if (body.length > CHAT_BODY_MAX) return `A chat reply is at most ${CHAT_BODY_MAX} characters.`;
  return { kind: "reply", channel: "chat", to, toLabel: visitor || to, body };
}

/** A comment on an issue or pull request the judge read, «12» or «#12». */
function githubReply(a: Record<string, unknown>, ctx: ValidationContext): CardAction | string {
  const n = text(a.to).replace(/^#/, "");
  const title = /^\d+$/.test(n) ? ctx.seenThreads.get(n) : undefined;
  if (title === undefined) return `#${n || "?"} isn't an issue or pull request you read in this turn: a GitHub reply goes only to one from the data.`;
  const body = text(a.body);
  if (!body) return "A reply needs a body.";
  if (body.length > BODY_MAX) return `A GitHub reply is at most ${BODY_MAX} characters.`;
  return { kind: "reply", channel: "github", to: n, toLabel: title ? `#${n} ${title}` : `#${n}`, body };
}

/** What Len will do in the project: a sentence or a short paragraph, since every judge after this one reads it too. */
const PROJECT_TEXT_MAX = 1000;

function project(a: Record<string, unknown>): CardAction | string {
  const t = text(a.text);
  if (!t) return "A project action needs text: what will be done.";
  if (t.length > PROJECT_TEXT_MAX) return `A project action is at most ${PROJECT_TEXT_MAX} characters: say what will be done, not how.`;
  return { kind: "project", text: t };
}

export async function validateActions(input: unknown, ctx: ValidationContext): Promise<Validated> {
  if (!Array.isArray(input) || input.length === 0) return no("Give at least one action.");
  if (input.length > MAX_ACTIONS) return no(`At most ${MAX_ACTIONS} actions per card.`);
  const offered = ["project", ...(ctx.available.dataChange ? ["data_change"] : []), ...(ctx.available.replyChannels.length > 0 ? ["reply"] : [])];
  const seenKinds = new Set<string>();
  const actions: CardAction[] = [];
  for (const raw of input) {
    const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const kind = text(a.kind);
    if (!offered.includes(kind)) return no(`This task's source can't do "${kind}". It offers: ${offered.join(", ")}.`);
    if (seenKinds.has(kind)) return no(`At most one ${kind} per card.`);
    seenKinds.add(kind);
    const made = kind === "project" ? project(a) : kind === "data_change" ? await dataChange(a, ctx) : reply(a, ctx);
    if (typeof made === "string") return no(made);
    actions.push(made);
  }
  const change = actions.find((x) => x.kind === "data_change");
  const message = actions.find((x) => x.kind === "reply");
  const subjectKey = change ? Object.values(change.key)[0]! : message ? (message.channel === "github" ? `#${message.to}` : message.to) : ctx.recordId;
  return { ok: true, actions, subjectKey };
}
