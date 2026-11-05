// THE «CREAR» CARDS OF A PROJECT (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): the session person's own
// cards in that project's chat, oldest first — each is drawn under the answer it follows. Only the workspace's browser
// session: the phone uses tools from phase 5.
import { auth } from "@/auth";
import { exigirAcceso } from "@/lib/projects/acceso";
import { CENTICREDITOS_POR_CREDITO } from "@/lib/credits-client";
import { creationCapCentis } from "@/lib/tools/cards/creation";
import { cardsOfProject, toCardView } from "@/lib/tools/cards/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function GET(req: Request): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) return json({ error: "projectId_required" }, 400);
  const access = await exigirAcceso(projectId, userId, "ver");
  if (access instanceof Response) return access;
  const rows = await cardsOfProject(projectId, userId);
  // The card names what one creation may spend at most (`OPENLEN_TOOL_CREATION_CAP`), in credits.
  return json({ cards: rows.map(toCardView), capCredits: creationCapCentis() / CENTICREDITOS_POR_CREDITO });
}
