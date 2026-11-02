// A turn's subagents, for the chat card (spec local 2026-11-01-subagentes-de-len, §4.8): the panel
// reads them while any is running and once on reload. What each did and how it ended, never its
// transcript or the prompt Len wrote (that one is in the turn's own step).
//
// AUTHORIZATION: session + read access to the project (a member watches, as in `turno/[fila]`).
// 404 when there is no access, without telling which.

import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { exigirAcceso } from "@/lib/projects/acceso";
import { runsByIds, runsOfRow } from "@/lib/agent/subagents/store";
import { subagentRefFrom } from "@/lib/agent/subagents/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A turn wakes a handful at most; more is not a card's question. */
const MAX_IDS = 20;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const GET = paraLaApp(async (req: Request): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "no_autenticado" }, 401);

  const url = new URL(req.url);
  const projectId = url.searchParams.get("project");
  const row = url.searchParams.get("row");
  if (!projectId || !row) return json({ error: "falta_fila" }, 400);

  const acceso = await exigirAcceso(projectId, userId, "ver");
  if (acceso instanceof Response) return json({ error: "no_encontrado" }, 404);

  // The runs this turn woke with `send_message` live in the row that launched them: the card names them.
  const ids = [...new Set((url.searchParams.get("ids") ?? "").split(","))]
    .filter((id) => subagentRefFrom({ id, preset: "x" }) !== null)
    .slice(0, MAX_IDS);
  const rows = await runsOfRow(projectId, row);
  const woken = ids.length > 0 ? await runsByIds(projectId, ids) : [];
  const seen = new Set(rows.map((r) => r.id));
  const runs = [...rows, ...woken.filter((r) => !seen.has(r.id))].map((r) => ({
    id: r.id,
    preset: r.preset,
    description: r.description,
    status: r.status,
    actions: r.actions,
    finalText: r.finalText,
    toolUses: r.toolUses,
    durationMs: r.durationMs,
    createdAt: r.createdAt,
    settledAt: r.settledAt,
    forked: r.forked,
  }));
  return json({ runs });
});

export const OPTIONS = respuestaPrevia;
