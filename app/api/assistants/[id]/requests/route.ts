// HER «PEDIDOS» (spec local 2026-11-06-asistente-propio, §4.3, §4.6.2): what visitors asked for and couldn't be done,
// joined into cards — the waiting ones and what was decided in the last 30 days — for her person only (§6.12): the
// cards come from visitors' words.
import { assistantsEnabled } from "@/lib/assistants/enabled";
import { requestCardView } from "@/lib/assistants/requests/view";
import { requestCardsOfAssistant } from "@/lib/assistants/requests/store";
import { assistantById } from "@/lib/assistants/store";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** With the session or the phone's key (phase 5: her tab in Len móvil). */
export const GET = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const personId = await usuarioDeLaPeticion(req);
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!assistantsEnabled()) return json({ error: "assistants_off" }, 404);
  const { id } = await params;
  const a = await assistantById(id);
  if (!a || a.personId !== personId) return json({ error: "not_found" }, 404);
  const cards = await requestCardsOfAssistant(a.id, new Date());
  return json({ cards: cards.map((c) => ({ ...requestCardView(c), projectTitle: c.projectTitle })) });
});

export const OPTIONS = respuestaPrevia;
