// /api/tools/jobs (spec local 2026-11-04-herramientas-hechas-por-len, §4.6). POST starts a tool's job once the person
// confirmed in OpenLen's dialog (`{ name, input, uploads }` and the caller) → `{ job }`, or `{ error }` with its
// status. GET lists the person's jobs of the tool the query names, newest first.
import { toolProjectOf } from "@/lib/tools/bridge/handlers";
import { json, jobsCaller, REFUSAL_STATUS } from "@/lib/tools/jobs/http";
import { listToolJobs, realStartDeps, startToolJob } from "@/lib/tools/jobs/start";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const who = await jobsCaller(body);
  if ("response" in who) return who.response;
  const started = await startToolJob(who.caller, { name: body.name, input: body.input, uploads: body.uploads }, await realStartDeps());
  return started.ok ? json({ job: started.job }) : json({ error: started.reason }, REFUSAL_STATUS[started.reason]);
}

export async function GET(req: Request): Promise<Response> {
  const who = await jobsCaller(new URL(req.url).searchParams);
  if ("response" in who) return who.response;
  return json({ jobs: await listToolJobs(who.caller.personId, toolProjectOf(who.caller)) });
}
