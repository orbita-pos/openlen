// THE «CREAR» CARDS OF A PROJECT (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): the session person's own
// cards in that project's chat, oldest first — each is drawn under the answer it follows. The workspace's session or the
// phone app's key (phase 5, §4.14): the phone draws the same cards over its conversation.
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { exigirAcceso } from "@/lib/projects/acceso";
import { CENTICREDITOS_POR_CREDITO } from "@/lib/credits-client";
import { reconcileOnRead } from "@/lib/tools/cards/actions";
import { creationCapCentis } from "@/lib/tools/cards/creation";
import { cardsOfProject, toCardView } from "@/lib/tools/cards/store";
import { toolSuggestionsEnabled } from "@/lib/tools/suggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const GET = paraLaApp(async (req: Request): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  // OPENLEN_TOOLS=0 or OPENLEN_TOOL_SUGGESTIONS=0 turns the «Crear» card off for everyone, cards already shown too.
  if (!toolSuggestionsEnabled()) return json({ error: "tools_off" }, 404);
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) return json({ error: "projectId_required" }, 400);
  const access = await exigirAcceso(projectId, userId, "ver");
  if (access instanceof Response) return access;
  // Reconciled when read: a card a restart left «creando» says «interrumpida» without anyone pressing it first.
  const rows = await reconcileOnRead(await cardsOfProject(projectId, userId));
  // The card names what one creation may spend at most (`OPENLEN_TOOL_CREATION_CAP`), in credits.
  return json({ cards: rows.map(toCardView), capCredits: creationCapCentis() / CENTICREDITOS_POR_CREDITO });
});

export const OPTIONS = respuestaPrevia;
