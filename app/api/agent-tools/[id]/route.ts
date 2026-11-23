// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/agent-tools/[id] — the person takes one of their agent's tools away (spec local
// 2026-11-22-herramienta-dentro-del-agente, §1), from the menu of its tab on the web or from the phone, after confirming. As in
// Claude's artifacts, deleting is the person's: the tool and its data are deleted for good (the data hangs from the tool row, so
// it goes with it), and every screen following the tool is told `gone`. The folder's files stay in the space — they are the
// space's — and the agent has no tool that does this.
//
// → 200 { ok: true } · 404 `not_found`.
//
// 🔴 The tool's owner only, and ONE 404 for everything else — the tools are off, nobody is signed in, there is no such tool, it is
// another person's, it was deleted a moment ago — so a stranger can't tell a tool exists. No plan check, no credits.
// ─────────────────────────────────────────────────────────────────────────────
import { publishToolGone } from "@/lib/agent-tools/bus";
import { agentToolsEnabled } from "@/lib/agent-tools/enabled";
import { agentToolById, deleteAgentTool } from "@/lib/agent-tools/store";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const notFound = () => json({ error: "not_found" }, 404);

export const DELETE = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  if (!agentToolsEnabled()) return notFound();
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return notFound();
  const { id } = await params;
  const tool = await agentToolById(id);
  if (!tool || tool.personId !== userId) return notFound();

  // Two deletes at once: only the one that removed the row tells the screens, and the other finds nothing, as a later one would.
  if (!(await deleteAgentTool(tool.id))) return notFound();
  publishToolGone(tool.id);
  return json({ ok: true });
});

export const OPTIONS = respuestaPrevia;
