// /api/projects/[id]/shopify — THE SHOPIFY TAB (spec local 2026-10-22-shopify-storefront,
// §6.6). Only the OWNER, like Correos (lib/projects/acceso.ts). The store is connected by
// talking to Len (`connect_shopify_store`); here it is only seen and disconnected.
//   GET     → the panel ({ available: false, store: null } with Shopify off)
//   DELETE  → forget the store (the pages don't change), then the panel

import { auth } from "@/auth";
import { exigirAcceso } from "@/lib/projects/acceso";
import { shopifyEnabledIn } from "@/lib/shopify/enabled";

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
  const [{ shopifyPanel }, { realShopifyStore }] = await Promise.all([import("@/lib/shopify/panel"), import("@/lib/shopify/real")]);
  return json(await shopifyPanel(projectId, realShopifyStore()), 200);
}

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const who = await ownerOnly(id);
  if (who !== true) return who;
  if (!shopifyEnabledIn()) return json({ available: false, store: null }, 200);
  return panel(id);
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const who = await ownerOnly(id);
  if (who !== true) return who;
  if (!shopifyEnabledIn()) return json({ error: "shopify_unavailable" }, 503);
  const { realShopifyStore } = await import("@/lib/shopify/real");
  await realShopifyStore().remove(id);
  return panel(id);
}
