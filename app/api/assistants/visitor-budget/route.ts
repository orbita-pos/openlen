// WHAT THE VISITORS MAY SPEND THIS MONTH (spec local 2026-11-06-asistente-propio, §4.7, §6.2; phase 2A): the account's
// spend with its assistants' visitors and its cap — a quarter of the plan unless the person chose another (0 … the plan,
// in centicredits; null = back to the quarter). The person's own, from their session.
import { auth } from "@/auth";
import { assistantsEnabled } from "@/lib/assistants/enabled";
import { visitorCap, visitorMonth } from "@/lib/assistants/visitor/budget";
import { explicitVisitorCap, monthSpent, setExplicitVisitorCap } from "@/lib/assistants/visitor/store";
import { getCreditState } from "@/lib/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function GET(): Promise<Response> {
  const personId = (await auth())?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!assistantsEnabled()) return json({ error: "assistants_off" }, 404);
  const [credit, spent, explicit] = await Promise.all([getCreditState(personId), monthSpent(personId, visitorMonth(new Date())), explicitVisitorCap(personId)]);
  return json({ spent, cap: visitorCap(explicit, credit.allotment), explicit, max: credit.allotment });
}

export async function PUT(req: Request): Promise<Response> {
  const personId = (await auth())?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!assistantsEnabled()) return json({ error: "assistants_off" }, 404);
  const body = (await req.json().catch(() => null)) as { cap?: unknown } | null;
  const cap = body?.cap;
  if (cap !== null) {
    const credit = await getCreditState(personId);
    if (typeof cap !== "number" || !Number.isInteger(cap) || cap < 0 || cap > credit.allotment) return json({ error: "bad_request" }, 400);
  }
  await setExplicitVisitorCap(personId, cap as number | null);
  return json({ ok: true });
}
