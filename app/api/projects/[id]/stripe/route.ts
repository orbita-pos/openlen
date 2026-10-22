// /api/projects/[id]/stripe — THE PAYMENTS TAB AND DISCONNECTING STRIPE (spec local
// 2026-10-21-stripe-integration, §6.6 and §6.7). Only the OWNER, like the other
// tabs of the Database view that show their money (lib/projects/acceso.ts).
//   GET ?env=draft|live → { available: false } without Stripe; otherwise that
//                         environment's panel (lib/stripe/panel.ts).
//   DELETE              → removes STRIPE_SECRET_KEY from both environments. The
//                         secrets door's Stripe hook deletes the webhook endpoints
//                         registered with it, their secrets and the account rows.
//                         It does NOT cancel subscriptions nor refund: that's Stripe's.

import { auth } from "@/auth";
import { exigirAcceso } from "@/lib/projects/acceso";
import { stripeEnabled } from "@/lib/stripe/enabled";

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

export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const who = await ownerOnly(id);
  if (who !== true) return who;
  if (!stripeEnabled()) return json({ available: false }, 200);
  const env = new URL(req.url).searchParams.get("env") ?? "draft";
  if (env !== "draft" && env !== "live") return json({ error: "invalid_env" }, 400);
  const { stripePanel } = await import("@/lib/stripe/panel");
  return json(await stripePanel(id, env), 200);
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const who = await ownerOnly(id);
  if (who !== true) return who;
  const [{ realSecretsDeps }, { unsetFunctionSecrets }] = await Promise.all([import("@/lib/functions/secrets-real"), import("@/lib/functions/secrets-core")]);
  const deps = realSecretsDeps();
  if (!deps) return json({ error: "functions_unavailable" }, 503);
  const draft = await unsetFunctionSecrets(id, "draft", ["STRIPE_SECRET_KEY"], deps);
  const live = await unsetFunctionSecrets(id, "live", ["STRIPE_SECRET_KEY"], deps);
  return json({ ok: true, removed: { draft, live } }, 200);
}
