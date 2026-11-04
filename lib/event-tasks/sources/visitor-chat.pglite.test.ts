// @vitest-environment node
//
// The `visitor_chat` source (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.4.1, §7.6.1): what visitors
// write to the business in the published page's chat, and who signs up to it. Only conversations where the business
// is one of the two users — never two visitors' messages, never the business's own (the AI agents post as it too).
// Against real Postgres (PGlite), with the chat's tables as scripts/privatechat-migrate.ts makes them.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

const base = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  get db() {
    return base.db;
  },
}));

const { visitorChatSource } = await import("./visitor-chat");
const CTX = { timeZone: "UTC", now: new Date("2026-11-04T12:00:00Z"), ownerId: "owner" };

let pg: PGlite;
const msg = (id: string, conversation: string, author: string, body: string, time: string) =>
  pg.query(`INSERT INTO "chatMessages" (id, "conversationId", "authorId", body, "createdAt") VALUES ($1, $2, $3, $4, $5)`, [id, conversation, author, body, `2026-11-04 ${time}`]);
const registered = (id: string, chatUserId: string, time: string, project = "p1") =>
  pg.query(`INSERT INTO "chatEvents" (id, "projectId", "chatUserId", type, "createdAt") VALUES ($1, $2, $3, 'register', $4)`, [id, project, chatUserId, `2026-11-04 ${time}`]);

async function started(params: { watch?: "messages" | "signups" } = {}) {
  const v = await visitorChatSource.validate("p1", params, CTX);
  if (!v.ok) throw new Error(v.reason);
  return v.initialState;
}

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(`
    CREATE TABLE "projects" ("id" text PRIMARY KEY);
    INSERT INTO "projects" VALUES ('p1'), ('p2');
    CREATE TABLE "chatUsers" ("id" text PRIMARY KEY, "projectId" text NOT NULL, "username" text NOT NULL, "passwordHash" text, "email" text, "memberId" text, "displayName" text, "role" text NOT NULL DEFAULT 'member', "status" text NOT NULL DEFAULT 'active', "createdAt" timestamp NOT NULL DEFAULT now(), "lastSeenAt" timestamp);
    CREATE TABLE "chatConversations" ("id" text PRIMARY KEY, "projectId" text NOT NULL, "aUserId" text NOT NULL, "bUserId" text NOT NULL, "lastMessageAt" timestamp, "aReadAt" timestamp, "bReadAt" timestamp, "assignedUserId" text, "assignedAt" timestamp, "origin" text, "createdAt" timestamp NOT NULL DEFAULT now());
    CREATE TABLE "chatMessages" ("id" text PRIMARY KEY, "conversationId" text NOT NULL REFERENCES "chatConversations"("id") ON DELETE CASCADE, "authorId" text NOT NULL, "body" text NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT now(), "readAt" timestamp);
    CREATE TABLE "chatEvents" ("id" text PRIMARY KEY, "projectId" text NOT NULL, "chatUserId" text, "type" text NOT NULL, "createdAt" timestamp NOT NULL DEFAULT now());
    INSERT INTO "chatUsers" (id, "projectId", username, email, "displayName", role) VALUES
      ('own', 'p1', 'lamesa', 'dueno@lamesa.mx', 'La Mesa', 'owner'),
      ('ana', 'p1', 'ana', 'ana@ejemplo.com', 'Ana', 'member'),
      ('eva', 'p1', 'eva', NULL, NULL, 'member'),
      ('own2', 'p2', 'otro', NULL, NULL, 'owner'),
      ('zoe', 'p2', 'zoe', NULL, 'Zoe', 'member');
    INSERT INTO "chatConversations" (id, "projectId", "aUserId", "bUserId", origin) VALUES
      ('c-ana', 'p1', 'ana', 'own', NULL),
      ('c-eva', 'p1', 'eva', 'own', 'ai_handoff'),
      ('c-dm', 'p1', 'ana', 'eva', NULL),
      ('c-p2', 'p2', 'own2', 'zoe', NULL);`);
  base.db = drizzle(pg, { schema });
});

describe("visitor_chat", () => {
  it("a visitor's message to the business is a change; one between two visitors never is", async () => {
    const state = await started();
    await msg("m1", "c-ana", "ana", "¿Puedo hablar con alguien?", "10:00:00.000");
    await msg("m2", "c-dm", "ana", "hola Eva", "10:00:01.000");
    const o = await visitorChatSource.observe("p1", {}, state, CTX);
    expect(o.changes).toHaveLength(1);
    expect(o.changes[0]).toMatchObject({
      subject: "chat",
      summary: "Ana: ¿Puedo hablar con alguien?",
      link: "m1",
      at: expect.stringContaining("2026-11-04 10:00:00"),
      detail: { message_id: "m1", conversation_id: "c-ana", visitor: "Ana", visitor_email: "ana@ejemplo.com", text: "¿Puedo hablar con alguien?", handoff: false },
    });
  });

  it("the business's own messages and the AI agent's are not changes", async () => {
    const state = await started();
    await msg("m1", "c-ana", "own", "Hola, ¿en qué te ayudo?", "10:00:00.000");
    await msg("m2", "c-eva", "own", "Soy el asistente.", "10:00:01.000");
    await msg("m3", "c-eva", "eva", "quiero una persona", "10:00:02.000");
    const o = await visitorChatSource.observe("p1", {}, state, CTX);
    expect(o.changes.map((c) => c.link)).toEqual(["m3"]);
    expect(o.changes[0]!.detail).toMatchObject({ visitor: "eva", visitor_email: null, handoff: true });
  });

  it("what existed when the task was made never fires", async () => {
    await msg("m0", "c-ana", "ana", "un mensaje viejo", "09:00:00.000");
    const state = await started();
    expect((await visitorChatSource.observe("p1", {}, state, CTX)).changes).toEqual([]);
  });

  it("two messages in one millisecond both arrive, once", async () => {
    const state = await started();
    await msg("m-a", "c-ana", "ana", "uno", "10:00:00.123");
    await msg("m-b", "c-eva", "eva", "dos", "10:00:00.123");
    const first = await visitorChatSource.observe("p1", {}, state, CTX);
    expect(first.changes.map((c) => c.link)).toEqual(["m-a", "m-b"]);
    expect((await visitorChatSource.observe("p1", {}, first.state, CTX)).changes).toEqual([]);
  });

  it("read gives each message with its conversation, labelled visitor or business", async () => {
    await msg("m1", "c-ana", "ana", "¿Tenéis mesa para 12?", "10:00:00.000");
    await msg("m2", "c-ana", "own", "Déjame mirar.", "10:00:05.000");
    await msg("m3", "c-ana", "ana", "¿Y a las 21:00?", "10:00:09.000");
    const state = await started();
    const read = (await visitorChatSource.read("p1", {}, { keys: ["m3"], state, ctx: CTX })) as { items: Record<string, unknown>[]; previous: Record<string, unknown>[] };
    expect(read.items).toHaveLength(1);
    expect(read.items[0]).toMatchObject({ id: "m3", conversation_id: "c-ana", visitor: "Ana", text: "¿Y a las 21:00?" });
    expect((read.items[0]!.thread as { from: string; text: string }[]).map((t) => [t.from, t.text])).toEqual([
      ["visitor", "¿Tenéis mesa para 12?"],
      ["business", "Déjame mirar."],
      ["visitor", "¿Y a las 21:00?"],
    ]);
    expect(read.previous.map((r) => r.id)).toEqual(["m3", "m1"]);
  });

  it("match on visitor_email finds that visitor's older messages; another field is refused naming the ones it has", async () => {
    await msg("m1", "c-ana", "ana", "hace una semana", "08:00:00.000");
    await msg("m2", "c-eva", "eva", "otra persona", "08:30:00.000");
    const state = await started();
    const read = (await visitorChatSource.read("p1", {}, { keys: [], state, match: [{ field: "visitor_email", value: "ana@ejemplo.com" }], ctx: CTX })) as { matching: { id: string }[] };
    expect(read.matching.map((r) => r.id)).toEqual(["m1"]);
    await expect(visitorChatSource.read("p1", {}, { keys: [], state, match: [{ field: "text", value: "x" }], ctx: CTX })).rejects.toMatchObject({
      reason: "column_missing",
      message: expect.stringContaining("conversation_id or visitor_email"),
    });
  });

  it("signups: a register event is a change with the visitor's name and email", async () => {
    await registered("e0", "eva", "09:00:00");
    const state = await started({ watch: "signups" });
    await registered("e1", "ana", "10:00:00");
    const o = await visitorChatSource.observe("p1", { watch: "signups" }, state, CTX);
    expect(o.changes).toHaveLength(1);
    expect(o.changes[0]).toMatchObject({ subject: "chat_signup", link: "e1", detail: { chat_user_id: "ana", visitor: "Ana", visitor_email: "ana@ejemplo.com" } });
    expect((await visitorChatSource.observe("p1", { watch: "signups" }, o.state, CTX)).changes).toEqual([]);
  });

  it("another project's chat is never read", async () => {
    const state = await started();
    await msg("m9", "c-p2", "zoe", "soy de otro proyecto", "10:00:00.000");
    expect((await visitorChatSource.observe("p1", {}, state, CTX)).changes).toEqual([]);
    const read = (await visitorChatSource.read("p1", {}, { keys: ["m9"], state, ctx: CTX })) as { items: unknown[] };
    expect(read.items).toEqual([]);
  });
});
