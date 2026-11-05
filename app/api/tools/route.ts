// THE PERSON'S INSTALLED TOOLS (spec local 2026-11-04-herramientas-hechas-por-len, §4.3, §4.11): what the rail, the
// project's lenses and the Herramientas page show — each in the person's language, with its private frame when it
// can open, and why not when it can't (removed, Free plan, release gone). And «Sugerencias de herramientas» (phase 2,
// §4.10): whether the page offers that switch at all, and the person's own state.
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { subagentsEnabled } from "@/lib/agent/subagents/enabled";
import { getUserPlan } from "@/lib/limits";
import { toolsEnabled } from "@/lib/tools/enabled";
import { listInstallations, personName, releaseExists } from "@/lib/tools/store";
import { suggestionsOn, toolSuggestionsEnabled } from "@/lib/tools/suggestions";
import { toInstalledToolView } from "@/lib/tools/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const GET = paraLaApp(async (req: Request): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  if (!toolsEnabled()) return json({ error: "tools_off" }, 404);
  const locale = new URL(req.url).searchParams.get("locale") ?? "en";
  // The «Crear» card needs a subagent (its Creator): without them the switch would turn on nothing.
  const suggestionsAvailable = toolSuggestionsEnabled() && subagentsEnabled(process.env);
  const [rows, plan, name, on] = await Promise.all([
    listInstallations(userId),
    getUserPlan(userId),
    personName(userId),
    suggestionsAvailable ? suggestionsOn(userId) : Promise.resolve(false),
  ]);
  const requestHost = req.headers.get("host");
  const tools = await Promise.all(
    rows.map(async (row) => toInstalledToolView(row, { locale, requestHost, plan, releaseExists: await releaseExists(row.releaseSha) })),
  );
  return json({ tools, person: { name }, paid: plan !== "free", suggestions: { available: suggestionsAvailable, on } });
});

export const OPTIONS = respuestaPrevia;
