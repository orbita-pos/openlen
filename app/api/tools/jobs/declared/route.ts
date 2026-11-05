// GET /api/tools/jobs/declared?name=<job> (spec local 2026-11-04-herramientas-hechas-por-len, §4.4, §4.6): what OpenLen's
// confirmation shows before a tool's job runs — its title in the person's language, its minutes and the most it can
// cost —, read from the version the caller runs, never from the tool's frame → `{ job }`, or 404 when not declared.
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { json, jobsCaller } from "@/lib/tools/jobs/http";
import { describeToolJob, realStartDeps } from "@/lib/tools/jobs/start";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = paraLaApp(async (req: Request): Promise<Response> => {
  const query = new URL(req.url).searchParams;
  const who = await jobsCaller(await usuarioDeLaPeticion(req), query);
  if ("response" in who) return who.response;
  const job = await describeToolJob(who.caller, query.get("name") ?? "", await realStartDeps());
  return job ? json({ job }) : json({ error: "unknown_job" }, 404);
});

export const OPTIONS = respuestaPrevia;
