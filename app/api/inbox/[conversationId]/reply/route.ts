import { insertMessage, markConversationRead } from "@/lib/chat/store";
import { hub } from "@/lib/chat/hub";
import { json, requireOwnerForConversation } from "../../_shared";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 4000;

/** POST /api/inbox/[conversationId]/reply — owner sends a message as the business. */
export const POST = paraLaApp(async (
  req: Request,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<Response> => {
  const { conversationId } = await params;
  const ctx = await requireOwnerForConversation(conversationId, await usuarioDeLaPeticion(req));
  if ("error" in ctx) return json({ error: ctx.error === 401 ? "unauthorized" : "not_found" }, ctx.error);

  let parsed: { body?: unknown };
  try {
    parsed = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const text = (typeof parsed.body === "string" ? parsed.body : "").trim().slice(0, MAX_BODY);
  if (text.length === 0) return json({ error: "bad_request" }, 400);

  // agents reply AS the business (ownerChatUserId) — keeps the conversation 2-participant
  const m = await insertMessage(conversationId, ctx.ownerChatUserId, text);
  hub.publish(conversationId, { type: "message", message: m });
  // Contestar es haber leído (plans/len-resultados/diseno.md §6): el visitante
  // ve el visto, como cuando el negocio abre la conversación. No fatal, como en
  // `../messages/route.ts`: el mensaje ya salió.
  const leido = new Date();
  try {
    await markConversationRead(ctx.projectId, conversationId, ctx.ownerChatUserId, leido);
    hub.publish(conversationId, { type: "read", userId: ctx.ownerChatUserId, readAt: leido.toISOString() });
  } catch { /* non-fatal */ }
  return json(
    {
      message: {
        id: m.id,
        authorId: m.authorId,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        mine: true,
      },
    },
    200,
  );
});

export const OPTIONS = respuestaPrevia;
