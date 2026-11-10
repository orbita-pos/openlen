// HER CONVERSATIONS WITH VISITORS (spec local 2026-11-06-asistente-propio, §4.6.2 «Conversaciones», §6.5; phase 2A):
// what the page's visitors said and what she answered, for her person only — visitors' data, never a member's. Without
// what the model saw (`transcript`) or the visitor's browser id.
import { assistantsEnabled } from "@/lib/assistants/enabled";
import { titlesOf } from "@/lib/assistants/projects";
import { assistantById } from "@/lib/assistants/store";
import { visitsOf } from "@/lib/assistants/visitor/store";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The newest visits, and of each its last lines. */
const VISITS = 50;
const LINES = 40;

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
  const rows = await visitsOf(a.id, VISITS);
  // Which of her projects each came from (phase 4), even one she no longer serves.
  const titles = await titlesOf(rows.map((v) => v.projectId));
  return json({
    visits: rows.map((v) => ({
      id: v.id,
      projectId: v.projectId,
      projectTitle: titles.get(v.projectId) ?? null,
      startedAt: v.startedAt,
      lastAt: v.lastAt,
      messageCount: v.messageCount,
      handedOff: v.handedOff,
      lines: v.lines.slice(-LINES),
    })),
  });
});

export const OPTIONS = respuestaPrevia;
