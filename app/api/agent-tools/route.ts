// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agent-tools?assistantId= — the tools an agent has made for its person (spec local
// 2026-11-22-herramienta-dentro-del-agente, §2): the tabs beside its chat on the web, the buttons of its chat on the phone.
//
// → 200 [{ id, slug, title, frameUrl, frameOrigin }], oldest first so the tabs stay where they were · 400 `bad_request` (no
//   `assistantId`) · 404 `not_found`.
//
// `frameUrl` is where the WORKSPACE frames the tool (its private host with the published version in the query) and `frameOrigin`
// the origin of it, so the screen can check what answers the bridge; the phone's own address comes from
// `POST /api/movil/agent-tools/[id]/open`. A tool whose frame has no address here (the canvas origin is switched off) is left
// out: there is nothing to frame.
//
// 🔴 The agent has to be the person's, and ONE 404 for everything else — nobody is signed in, there is no such agent, it is
// another person's — so a stranger can't tell an agent exists. The exception is the switch: with the tools OFF the answer is an
// empty list, so the screens simply have no tabs. No plan check, no credits: every plan has its tools.
// ─────────────────────────────────────────────────────────────────────────────
import { agentToolsEnabled } from "@/lib/agent-tools/enabled";
import { agentToolFrameUrl } from "@/lib/agent-tools/host";
import { agentToolsOf } from "@/lib/agent-tools/store";
import { assistantById } from "@/lib/assistants/store";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const notFound = () => json({ error: "not_found" }, 404);

export const GET = paraLaApp(async (req: Request): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return notFound();
  if (!agentToolsEnabled()) return json([]);
  const assistantId = new URL(req.url).searchParams.get("assistantId");
  if (!assistantId) return json({ error: "bad_request", message: "assistantId is required." }, 400);
  const agent = await assistantById(assistantId);
  if (!agent || agent.personId !== userId) return notFound();

  const requestHost = req.headers.get("host");
  const tools = [];
  for (const tool of await agentToolsOf(agent.id)) {
    const frameUrl = agentToolFrameUrl({ hostLabel: tool.hostLabel, releaseSha: tool.releaseSha, requestHost });
    if (!frameUrl) continue;
    tools.push({ id: tool.id, slug: tool.slug, title: tool.title, frameUrl, frameOrigin: new URL(frameUrl).origin });
  }
  return json(tools);
});

export const OPTIONS = respuestaPrevia;
