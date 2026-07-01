// Shared plumbing for the visitor-facing chat API (/api/chat/[sub]/…). Mirrors
// app/api/m/[sub]/_shared.ts: runs on the app origin, every response no-store,
// the cookie it sets is host-only. Resolves a published subdomain to its
// project + chat settings, and gates protected routes on a live ol_chat session.

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { readChatCookie } from "@/lib/chat/session";
import {
  type ChatUserRow,
  getChatSession,
  getChatUserById,
  touchChatSession,
} from "@/lib/chat/store";

export function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export interface ChatSiteContext {
  projectId: string;
  userId: string;
  chatEnabled: boolean;
  /** Whether the site assistant (AI) is also enabled — gates the AI→human
   *  handoff endpoint (only the merged both-surfaces config may mint a guest). */
  assistantEnabled: boolean;
  selfServeJoin: boolean;
  identityMode: "guest" | "account";
  locale: string;
  title: string;
}

export async function loadChatSite(sub: string): Promise<ChatSiteContext | null> {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(sub)) return null;
  const rows = await db
    .select({ id: schema.projects.id, userId: schema.projects.userId, title: schema.projects.title, data: schema.projects.data })
    .from(schema.projects)
    .where(eq(schema.projects.subdomain, sub))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const chat = row.data?.settings?.chat;
  const assistant = row.data?.settings?.assistant;
  return {
    projectId: row.id,
    userId: row.userId ?? "",
    chatEnabled: chat?.enabled === true,
    assistantEnabled: assistant?.enabled === true,
    selfServeJoin: chat?.selfServeJoin !== false, // default open
    identityMode: chat?.identityMode === "account" ? "account" : "guest", // default guest
    locale: detectLang(row.data?.html ?? ""),
    title: row.title?.trim() || sub,
  };
}

function detectLang(html: string): string {
  const m = /<html[^>]*\blang=["']?([a-zA-Z-]{2,10})/.exec(html);
  return m ? m[1].slice(0, 2).toLowerCase() : "en";
}

/** Resolve the ol_chat cookie to its live user, scoped to this project. Null =
 *  no/blocked/foreign session. Touches lastSeenAt (throttled, fire-and-forget). */
export async function requireChatSession(
  req: Request,
  projectId: string,
): Promise<{ user: ChatUserRow } | null> {
  const raw = readChatCookie(req);
  if (!raw) return null;
  const sess = await getChatSession(raw);
  if (!sess || sess.projectId !== projectId) return null;
  const user = await getChatUserById(sess.chatUserId);
  if (!user || user.status !== "active") return null;
  touchChatSession(raw);
  return { user };
}
