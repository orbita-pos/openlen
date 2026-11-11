// GET /api/projects/[id]/assistant-requests — the cards «De Lucía» for Len's chat (spec local 2026-11-06-asistente-propio,
// §4.6.1): what visitors asked her for in this project, waiting or decided in the last 7 days. The OWNER's, and only
// those of their own assistant: cards come from visitors' words (§6.12), so a member gets none.
import { auth } from "@/auth";
import { assistantsEnabled } from "@/lib/assistants/enabled";
import { requestCardView } from "@/lib/assistants/requests/view";
import { requestCardsOfProject } from "@/lib/assistants/requests/store";
import { exigirAcceso } from "@/lib/projects/acceso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  if (!assistantsEnabled()) return json({ error: "assistants_off" }, 404);
  const { id } = await params;
  const acceso = await exigirAcceso(id, userId, "ver");
  if (acceso instanceof Response) return acceso;
  if (acceso.rol !== "dueno") return json({ cards: [] });
  const cards = await requestCardsOfProject(id, new Date());
  return json({
    cards: cards.filter((c) => c.personId === userId).map((c) => ({ ...requestCardView(c), assistantId: c.assistantId, assistantName: c.assistantName })),
  });
}
