// HOW HER REQUESTS TO LEN ARE GOING (spec local 2026-11-16-movil-es-tu-asistente, §5.4, §5.8.5): her chat on the phone
// shows a card for each `ask_len`, and asks here how each is going — Len's row when it exists, her note when it doesn't
// (still queued, or failed before Len's turn opened its row). For her person only, with the session or the phone's key.
import { turnoDeLaFila } from "@/lib/agent/direcciones";
import { assistantsEnabled } from "@/lib/assistants/enabled";
import { lenRequestView } from "@/lib/assistants/len-requests";
import { assistantById, assistantNoticesByFila } from "@/lib/assistants/store";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { leerTurnoDelUsuario } from "@/lib/projects/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** As many cards as one look at her chat follows. */
const MAX_FILAS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const GET = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const personId = await usuarioDeLaPeticion(req);
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!assistantsEnabled()) return json({ error: "assistants_off" }, 404);
  const { id } = await params;
  const a = await assistantById(id);
  if (!a || a.personId !== personId) return json({ error: "not_found" }, 404);
  const filas = [...new Set((new URL(req.url).searchParams.get("filas") ?? "").split(",").map((f) => f.trim()))].filter((f) => UUID.test(f)).slice(0, MAX_FILAS);
  const notes = await assistantNoticesByFila(a.id, filas);
  const now = new Date();
  const requests = await Promise.all(
    filas.map(async (filaId) =>
      lenRequestView({
        filaId,
        note: notes.find((n) => n.filaId === filaId) ?? null,
        turn: await leerTurnoDelUsuario(filaId, personId).catch(() => null),
        liveTurnoId: turnoDeLaFila(filaId, personId),
        now,
      }),
    ),
  );
  return json({ requests });
});

export const OPTIONS = respuestaPrevia;
