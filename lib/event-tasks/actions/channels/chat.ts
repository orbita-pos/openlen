// THE OWNER'S REPLY IN THE PAGE'S CHAT (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.4.1, §7.6.3): the
// `visitor_chat` source's channel. Posted as the business — the project's owner chat user, as the inbox's reply does
// (app/api/inbox/[conversationId]/reply) — and only in a conversation the business is in. Once per card: the message's
// id comes from the card, so a retry after a restart finds it already there and says «sent» without a second message.
import "server-only";

import { createHash } from "node:crypto";

import type { HubEvent } from "@/lib/chat/hub";
import type { MessageRow } from "@/lib/chat/store";

import type { ChannelSender } from "../send";

export interface ChatSenderDeps {
  ownerOf(projectId: string): Promise<string>;
  ownerChatUser(projectId: string, ownerId: string): Promise<{ id: string }>;
  conversationOf(projectId: string, conversationId: string, chatUserId: string): Promise<{ id: string; otherUserId: string } | null>;
  insertOnce(conversationId: string, authorId: string, body: string, id: string): Promise<MessageRow | null>;
  publish(conversationId: string, event: HubEvent): void;
  markRead(projectId: string, conversationId: string, chatUserId: string, at: Date): Promise<void>;
}

/** The card's reply message id: UUID-shaped (version 5), from the card alone. */
export function replyMessageId(cardId: string): string {
  const h = createHash("sha256").update(`event-card:${cardId}:reply`).digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function chatSender(deps: ChatSenderDeps): ChannelSender {
  return async (card, a, _attempt, now) => {
    const business = await deps.ownerChatUser(card.projectId, await deps.ownerOf(card.projectId));
    const conversation = await deps.conversationOf(card.projectId, a.to, business.id);
    if (!conversation) return { kind: "failed", message: "The conversation no longer exists.", passing: false };
    const message = await deps.insertOnce(a.to, business.id, a.body, replyMessageId(card.id));
    // Already there: the earlier try went out; nothing to publish again.
    if (message) {
      deps.publish(a.to, { type: "message", message });
      await deps.markRead(card.projectId, a.to, business.id, now);
    }
    return { kind: "sent", result: a.toLabel ?? a.to };
  };
}

/** The real parts: the chat's store and its live hub. */
export async function defaultChatSender(): Promise<ChannelSender> {
  const [store, { hub }, { db, schema }, { eq }] = await Promise.all([import("@/lib/chat/store"), import("@/lib/chat/hub"), import("@/lib/db"), import("drizzle-orm")]);
  return chatSender({
    ownerOf: async (projectId) => {
      const [row] = await db.select({ userId: schema.projects.userId }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
      if (!row) throw new Error(`no project ${projectId}`);
      return row.userId;
    },
    ownerChatUser: (projectId, ownerId) => store.getOrCreateOwnerChatUser(projectId, ownerId),
    conversationOf: store.getConversationForUser,
    insertOnce: store.insertMessageOnce,
    publish: (conversationId, event) => hub.publish(conversationId, event),
    markRead: store.markConversationRead,
  });
}
