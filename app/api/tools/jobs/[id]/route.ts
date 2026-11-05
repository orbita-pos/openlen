// GET /api/tools/jobs/<id> (spec local 2026-11-04-herramientas-hechas-por-len, §4.6): one job, if it is the person's
// own and of the tool the query names (DeepSeek's owner scope) → `{ job }`, else 404.
import { toolProjectOf } from "@/lib/tools/bridge/handlers";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { json, jobsCaller } from "@/lib/tools/jobs/http";
import { toolJobView } from "@/lib/tools/jobs/start";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = paraLaApp(async (req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> => {
  const who = await jobsCaller(await usuarioDeLaPeticion(req), new URL(req.url).searchParams);
  if ("response" in who) return who.response;
  const job = await toolJobView((await ctx.params).id, who.caller.personId, toolProjectOf(who.caller));
  return job ? json({ job }) : json({ error: "not_found" }, 404);
});

export const OPTIONS = respuestaPrevia;
