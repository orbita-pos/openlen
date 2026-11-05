// «RESTAURAR» A REMOVED TOOL (spec local 2026-11-04-herramientas-hechas-por-len, §4.2): DeepSeek's Restore checks the
// retained copy again and reinstalls it without running the Creator. Ours is the installed release row: it must
// still hold its shell and its icon; if it doesn't, nothing is restored and the person asks Len to install again.
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { toolsEnabled } from "@/lib/tools/enabled";
import { restoreInstallation } from "@/lib/tools/restore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const POST = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  if (!toolsEnabled()) return json({ error: "tools_off" }, 404);
  const { id } = await params;
  const restored = await restoreInstallation(id, userId);
  if (restored === "release_gone") return json({ error: "release_gone" }, 409);
  if (restored === "not_found") return json({ error: "not_found" }, 404);
  return json({ ok: true });
});

export const OPTIONS = respuestaPrevia;
