// @vitest-environment node
//
// The owner's reply in the page's chat (spec local 2026-11-04-hazlo, §7.4.1, §7.6.3): posted as the business, in a
// conversation the business is in, once per card — the message's id comes from the card, so a retry after a restart
// finds it there instead of posting a second one.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

import type { EventTaskCardRow } from "../../store";

const base = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  get db() {
    return base.db;
  },
}));

const { chatSender, replyMessageId } = await import("./chat");
const store = await import("@/lib/chat/store");

const NOW = new Date("2026-11-04T12:00:00Z");
const card = { id: "card1", projectId: "p1" } as EventTaskCardRow;
const reply = { kind: "reply" as const, channel: "chat" as const, to: "c-ana", toLabel: "Ana", body: "Hola Ana, tenemos mesa a las 21:00." };

let pg: PGlite;
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

function deps() {
  return {
    ownerOf: vi.fn(async () => "owner"),
    ownerChatUser: vi.fn(async () => ({ id: "own" })),
    conversationOf: store.getConversationForUser,
    insertOnce: store.insertMessageOnce,
    publish: vi.fn(),
    markRead: vi.fn(async () => {}),
  };
}

describe("chatSender", () => {
  it("the reply is posted once as the business, even when sent twice", async () => {
    const send = chatSender(deps());
    expect(await send(card, reply, 1, NOW)).toEqual({ kind: "sent", result: "Ana" });
    expect(await send(card, reply, 2, NOW)).toEqual({ kind: "sent", result: "Ana" });
    const rows = (await pg.query(`SELECT id, "authorId", body FROM "chatMessages"`)).rows;
    expect(rows).toEqual([{ id: replyMessageId("card1"), authorId: "own", body: reply.body }]);
  });

  it("a new reply is published to the conversation's live stream and marks it read, once", async () => {
    const d = deps();
    const send = chatSender(d);
    await send(card, reply, 1, NOW);
    await send(card, reply, 2, NOW);
    expect(d.publish).toHaveBeenCalledTimes(1);
    expect(d.publish).toHaveBeenCalledWith("c-ana", { type: "message", message: expect.objectContaining({ id: replyMessageId("card1"), authorId: "own" }) });
    expect(d.markRead).toHaveBeenCalledWith("p1", "c-ana", "own", NOW);
  });

  it("a conversation the business isn't in is refused", async () => {
    expect(await chatSender(deps())(card, { ...reply, to: "c-dm" }, 1, NOW)).toEqual({ kind: "failed", message: "The conversation no longer exists.", passing: false });
    expect((await pg.query(`SELECT id FROM "chatMessages"`)).rows).toEqual([]);
  });

  it("the message id is a UUID that depends only on the card", () => {
    expect(replyMessageId("card1")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(replyMessageId("card1")).toBe(replyMessageId("card1"));
    expect(replyMessageId("card2")).not.toBe(replyMessageId("card1"));
  });
});
