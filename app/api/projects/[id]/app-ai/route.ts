// /api/projects/[id]/app-ai — THE AI OF THE APPS for the Database view (spec
// local 2026-10-15, 4.6). Only the OWNER: the cap is their account's, and what
// is spent is their money.
//   GET → { available: false } with the gateway off; otherwise the overview.
//   PUT { capCredits: number | null } → the new overview (null = 25 % of the plan).

import { auth } from "@/auth";
import { appAiEnabledIn } from "@/lib/app-ai/enabled";
import { appAiOverview, parseCapUpdate } from "@/lib/app-ai/overview";
import { pgAppAiStore } from "@/lib/app-ai/store-pg";
import { getCreditState } from "@/lib/credits";
import { exigirAcceso } from "@/lib/projects/acceso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function ownerOnly(projectId: string): Promise<{ readonly userId: string } | Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const access = await exigirAcceso(projectId, userId, "ver");
  if (access instanceof Response) return access;
  if (access.rol !== "dueno") return json({ error: "owner_only" }, 403);
  return { userId };
}

async function overviewFor(projectId: string, userId: string): Promise<Response> {
  const { allotment } = await getCreditState(userId);
  return json(await appAiOverview({ projectId, ownerId: userId, allotment, now: new Date(), store: pgAppAiStore }), 200);
}

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const who = await ownerOnly(id);
  if (who instanceof Response) return who;
  if (!appAiEnabledIn()) return json({ available: false }, 200);
  return overviewFor(id, who.userId);
}

export async function PUT(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const who = await ownerOnly(id);
  if (who instanceof Response) return who;
  if (!appAiEnabledIn()) return json({ error: "unavailable" }, 409);
  const { allotment } = await getCreditState(who.userId);
  const parsed = parseCapUpdate(await req.json().catch(() => null), allotment);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  await pgAppAiStore.setExplicitCap(who.userId, parsed.cap);
  return overviewFor(id, who.userId);
}
