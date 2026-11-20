// POST /api/space (spec local 2026-11-19-agentes-para-todos, §6.3): the person's space — the hidden home of their
// agents — found or born. With the session or the phone's key; the person is whoever is signed in, never a body field.
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { agentsEnabled } from "@/lib/space/enabled";
import { ensureSpace } from "@/lib/space/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const POST = paraLaApp(async (req: Request): Promise<Response> => {
  const personId = await usuarioDeLaPeticion(req);
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!agentsEnabled()) return json({ error: "agents_off" }, 404);
  return json({ id: await ensureSpace(personId) });
});

export const OPTIONS = respuestaPrevia;
