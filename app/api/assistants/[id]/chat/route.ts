// HER CONVERSATION WITH HER OWNER, FOR THE PHONE (spec local 2026-11-06-asistente-propio, §4.6.3, phase 5): the first
// page of it, as her place on the web loads it (app/[locale]/assistant/[name]/page.tsx), in the shape of a project's
// `chatHistory`, so the phone's chat reads it as it reads Len's. Her person only, with the session or the phone's key.
// For an agent whose conversation hasn't started, also her file's first message (`startsWith`, spec local
// 2026-11-19-agentes-para-todos, §6.4): the phone sends it as her place on the web does, claimed once by the turn.
import { assistantConversationKey } from "@/lib/assistants/conversation";
import { assistantsEnabled } from "@/lib/assistants/enabled";
import { firstMessageOf } from "@/lib/assistants/agent-file";
import { assistantById } from "@/lib/assistants/store";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { getChatMessages } from "@/lib/projects/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const GET = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const personId = await usuarioDeLaPeticion(req);
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!assistantsEnabled()) return json({ error: "assistants_off" }, 404);
  const { id } = await params;
  const a = await assistantById(id);
  if (!a || a.personId !== personId) return json({ error: "not_found" }, 404);
  const chatHistory = await getChatMessages(a.homeProjectId, { charla: assistantConversationKey(a.id) });
  const startsWith = await firstMessageOf(personId, a.agentType ?? null, chatHistory.length, a.openedAt ?? null).catch(() => null);
  return json({ chatHistory, ...(startsWith ? { startsWith } : {}) });
});

export const OPTIONS = respuestaPrevia;
