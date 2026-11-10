// HER CONVERSATION WITH HER OWNER, FOR THE PHONE (spec local 2026-11-06-asistente-propio, §4.6.3, phase 5): the first
// page of it, as her place on the web loads it (app/[locale]/assistant/[name]/page.tsx), in the shape of a project's
// `chatHistory`, so the phone's chat reads it as it reads Len's. Her person only, with the session or the phone's key.
import { assistantConversationKey } from "@/lib/assistants/conversation";
import { assistantsEnabled } from "@/lib/assistants/enabled";
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
  return json({ chatHistory: await getChatMessages(a.homeProjectId, { charla: assistantConversationKey(a.id) }) });
});

export const OPTIONS = respuestaPrevia;
