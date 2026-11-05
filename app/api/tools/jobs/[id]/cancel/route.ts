// POST /api/tools/jobs/<id>/cancel (spec local 2026-11-04-herramientas-hechas-por-len, §4.6): DeepSeek's cancellation
// request, from the tool or the workspace's «Detener» → `{ job }` (now `stopping`, or what it already was), else 404.
import { toolProjectOf } from "@/lib/tools/bridge/handlers";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { json, jobsCaller } from "@/lib/tools/jobs/http";
import { cancelToolJob } from "@/lib/tools/jobs/start";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = paraLaApp(async (req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> => {
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const who = await jobsCaller(await usuarioDeLaPeticion(req), body);
  if ("response" in who) return who.response;
  const job = await cancelToolJob((await ctx.params).id, who.caller.personId, toolProjectOf(who.caller));
  return job ? json({ job }) : json({ error: "not_found" }, 404);
});

export const OPTIONS = respuestaPrevia;
