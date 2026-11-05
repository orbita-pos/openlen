// A PRESS ON A «CREAR» CARD (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): DeepSeek's action-card verbs,
// acted on as the session person (`actOnCard`: the card must be theirs). accepted → 202 (the work goes on in the
// background), settled → 200 with the card as it is, refused → 402 (plan), 404 (not theirs) or 409 with the reason.
import { auth } from "@/auth";
import { actOnCard, realActionDeps, type ToolCardVerb } from "@/lib/tools/cards/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERBS: readonly ToolCardVerb[] = ["create", "dismiss", "cancel", "undo", "restore", "retry", "install_anyway"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { verb?: unknown; payload?: unknown; locale?: unknown; timeZone?: unknown } | null;
  const verb = body?.verb;
  if (typeof verb !== "string" || !VERBS.includes(verb as ToolCardVerb)) return json({ error: "invalid_verb" }, 400);
  const payload = body?.payload && typeof body.payload === "object" ? (body.payload as Record<string, unknown>) : {};
  const result = await actOnCard(
    id,
    userId,
    verb as ToolCardVerb,
    {
      ...(payload.placement !== undefined ? { placement: payload.placement } : {}),
      ...(payload.customLocation !== undefined ? { customLocation: payload.customLocation } : {}),
      locale: typeof body?.locale === "string" ? body.locale.slice(0, 10) : "en",
      timeZone: typeof body?.timeZone === "string" ? body.timeZone.slice(0, 64) : "UTC",
    },
    await realActionDeps(),
  );
  if (result.status === "accepted") return json(result, 202);
  if (result.status === "settled") return json(result, 200);
  if (result.reason === "plan_required") return json(result, 402);
  if (result.reason === "unknown") return json(result, 404);
  return json(result, 409);
}
