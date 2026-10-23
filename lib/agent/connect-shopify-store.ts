/**
 * CONNECT THE USER'S SHOPIFY STORE — `connect_shopify_store` (spec local
 * 2026-10-22-shopify-storefront, §6.1).
 *
 * The domain of a store is public and the user is already talking to Len, so there
 * is no card: Len passes the domain it was given, OpenLen reads the store (meta.json,
 * then the Storefront API without a key) and saves it for the project, and Len gets
 * back what it found — the real handles to build with, never invented ones. Owner and
 * editors alike: it is public information, it costs nothing and binds no one.
 */
import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";
import type { ConnectStoreResult } from "@/lib/shopify/connect";
import { shopifyStateOf } from "@/lib/shopify/state";

export const CONNECT_SHOPIFY_STORE = "connect_shopify_store";

export const CONNECT_SHOPIFY_STORE_DECLARATION: Record<string, unknown> = {
  name: CONNECT_SHOPIFY_STORE,
  description:
    "Connect the user's existing Shopify store to this project by its domain, so pages and apps can show its products, its cart and Shopify's checkout without any key. "
    + "Takes their own domain (tienda.com) or the .myshopify.com one; it checks the store and returns its name, currency, country and a sample of its catalog. "
    + "Call it when the user talks about their Shopify store and PROJECT STATE has no `shopify`, or wants another store (it replaces the connected one). Never ask the user for Shopify keys or tokens.",
  parameters: {
    type: "OBJECT",
    properties: { domain: { type: "STRING", description: "The store's domain, as the user gave it." } },
    required: ["domain"],
  },
};

const NO_DOMAIN = "That isn't a store domain (like tienda.com or tienda.myshopify.com). Ask the user for it.";

function failure(r: Exclude<ConnectStoreResult, { kind: "ok" }>, domain: string): string {
  switch (r.kind) {
    case "invalid_domain":
      return NO_DOMAIN;
    case "not_shopify":
      return `${domain} isn't an open Shopify store.`;
    case "password":
      return "The store is password-protected: Shopify opens its catalog only once the store is open. Tell the user.";
    case "unreachable":
    case "storefront_closed":
      return `The store didn't answer: ${r.message}. Try again in a moment.`;
  }
}

export async function toolConnectShopifyStore(session: AgentSession, args: Record<string, unknown>, deps: AgentDeps): Promise<ToolOutcome> {
  if (!deps.connectShopifyStore) return { response: { ok: false, error: "Shopify isn't available on this server." } };
  const domain = typeof args.domain === "string" ? args.domain.trim() : "";
  if (!domain) return { response: { ok: false, error: NO_DOMAIN } };
  const r = await deps.connectShopifyStore(session.projectId, domain, session.personId ?? session.userId);
  if (r.kind !== "ok") return { response: { ok: false, error: failure(r, domain) } };
  const s = shopifyStateOf(r.row);
  const result =
    `Connected ${s.name} (${s.store_domain}): ${s.products} products and ${s.collections} collections, prices in ${s.currency}. Use country="${s.country}" on <shopify-store>. For the rest of the catalog, query the Storefront API with curl: POST ${s.storefront_api}.`
    + (r.emptyCatalog
      ? " Without a key the Storefront API returned no products although the store has some: they may not be published to the Online Store channel. Tell the user."
      : "");
  return { response: { ok: true, shopify: s, collections: r.sample.collections, products: r.sample.products, result } };
}
