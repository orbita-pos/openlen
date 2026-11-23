// ─────────────────────────────────────────────────────────────────────────────
// POST /api/movil/len-artifacts/[id]/open — the phone app opens one of its person's agent tools (spec local
// 2026-11-22-herramienta-dentro-del-agente, §2–§3): its frame URL on the phone's OWN private label, which only the phone app may
// frame and whose bridge answers only the app — the workspace's label stays framed only by openlen.com, as
// `/api/movil/tools/[id]/open` does for an installed tool.
//
// → 200 { url, origin } · 404 `not_found` (the tools are off, nobody is signed in, there is no such tool, it is another
// person's) · 503 `no_frame_host` (the canvas origin is off, or the tool has no phone label).
//
// The phone label was stored once, WITH the tool, when it was published (it is an HMAC of the tool's id, so it never changes):
// nothing here writes it. No plan check, no credits.
// ─────────────────────────────────────────────────────────────────────────────
import { lenArtifactsEnabled } from "@/lib/len-artifacts/enabled";
import { lenArtifactFrameUrl } from "@/lib/len-artifacts/host";
import { lenArtifactById } from "@/lib/len-artifacts/store";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const notFound = () => json({ error: "not_found" }, 404);

export const POST = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  if (!lenArtifactsEnabled()) return notFound();
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return notFound();
  const { id } = await params;
  const tool = await lenArtifactById(id);
  if (!tool || tool.personId !== userId) return notFound();

  const url = tool.phoneHostLabel ? lenArtifactFrameUrl({ hostLabel: tool.phoneHostLabel, releaseSha: tool.releaseSha, requestHost: req.headers.get("host") }) : null;
  if (!url) return json({ error: "no_frame_host" }, 503);
  return json({ url, origin: new URL(url).origin });
});

export const OPTIONS = respuestaPrevia;
