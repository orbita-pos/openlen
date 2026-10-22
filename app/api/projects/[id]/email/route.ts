// /api/projects/[id]/email — THE CORREOS TAB (spec local
// 2026-10-22-email-integration, 4 and 6.9). Only the OWNER, like Payments
// (lib/projects/acceso.ts): a member never sees nor changes the domain.
//   GET                                              → the panel ({ available: false } with email off)
//   POST { action: "connect", domain, showAsRoot }   → connect it, then the panel
//   POST { action: "check" }                         → check it now, then the panel
//   POST { action: "unsuppress", address }           → take an address off the list, then the panel
//   DELETE                                           → disconnect, then the panel

import { auth } from "@/auth";
import { exigirAcceso } from "@/lib/projects/acceso";
import { emailEnabledIn } from "@/lib/project-email/enabled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function ownerOnly(projectId: string): Promise<true | Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const access = await exigirAcceso(projectId, userId, "ver");
  if (access instanceof Response) return access;
  if (access.rol !== "dueno") return json({ error: "owner_only" }, 403);
  return true;
}

async function panel(projectId: string): Promise<Response> {
  const [{ emailPanel }, { realPanelDeps }] = await Promise.all([import("@/lib/project-email/panel"), import("@/lib/project-email/real")]);
  return json(await emailPanel(projectId, realPanelDeps()), 200);
}

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const who = await ownerOnly(id);
  if (who !== true) return who;
  if (!emailEnabledIn()) return json({ available: false }, 200);
  return panel(id);
}

const CONNECT_STATUS = { free_plan: 402, invalid_domain: 400, host_taken: 409, provider_error: 502 } as const;

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const who = await ownerOnly(id);
  if (who !== true) return who;
  if (!emailEnabledIn()) return json({ error: "email_unavailable" }, 503);
  const body = (await req.json().catch(() => null)) as { action?: unknown; domain?: unknown; showAsRoot?: unknown; address?: unknown } | null;
  const [domainMod, { realPanelDeps }] = await Promise.all([import("@/lib/project-email/domain"), import("@/lib/project-email/real")]);
  const deps = realPanelDeps();
  if (body?.action === "connect" && typeof body.domain === "string") {
    const r = await domainMod.connectDomain(id, { domain: body.domain, showAsRoot: body.showAsRoot === true }, deps);
    if (r.kind !== "ok") return json({ error: r.kind, message: r.message }, CONNECT_STATUS[r.kind]);
    return panel(id);
  }
  if (body?.action === "check") {
    await domainMod.checkDomain(id, deps);
    return panel(id);
  }
  if (body?.action === "unsuppress" && typeof body.address === "string") {
    await deps.store.unsuppress(id, body.address);
    return panel(id);
  }
  return json({ error: "invalid_body" }, 400);
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const who = await ownerOnly(id);
  if (who !== true) return who;
  if (!emailEnabledIn()) return json({ error: "email_unavailable" }, 503);
  const [{ disconnectDomain }, { realPanelDeps }] = await Promise.all([import("@/lib/project-email/domain"), import("@/lib/project-email/real")]);
  await disconnectDomain(id, realPanelDeps());
  return panel(id);
}
