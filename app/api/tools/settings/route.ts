// «SUGERENCIAS DE HERRAMIENTAS» (spec local 2026-11-04-herramientas-hechas-por-len, §4.10, §4.11): the person's own
// switch for the «Crear» card, off until they turn it on. Only the workspace's browser session: the phone uses tools
// from phase 5.
import { auth } from "@/auth";
import { setSuggestionsOn, suggestionsOn } from "@/lib/tools/suggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function GET(): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  return json({ suggestions: await suggestionsOn(userId) });
}

export async function PATCH(req: Request): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const body = (await req.json().catch(() => null)) as { suggestions?: unknown } | null;
  if (typeof body?.suggestions !== "boolean") return json({ error: "invalid" }, 400);
  await setSuggestionsOn(userId, body.suggestions);
  return json({ suggestions: body.suggestions });
}
