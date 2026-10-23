// @vitest-environment node
//
// /api/projects/[id]/shopify — the Shopify tab (spec local 2026-10-22-shopify-storefront, §6.6).
// Only the owner, like Correos. The real store is swapped for a memory one.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));
const m = vi.hoisted(() => ({ enabled: true, store: null as unknown }));
vi.mock("@/lib/shopify/enabled", () => ({ shopifyEnabledIn: () => m.enabled }));
vi.mock("@/lib/shopify/real", () => ({ realShopifyStore: () => m.store }));

import { fijarAccesoDePrueba } from "@/lib/projects/acceso-de-prueba";
import { memoryShopifyStore } from "@/lib/shopify/store";
import type { ShopifyStore } from "@/lib/shopify/types";

import { DELETE, GET } from "./route";

const ROW = {
  projectId: "p1",
  shopDomain: "hydrogen-preview.myshopify.com",
  primaryDomain: "checkout.hydrogen.shop",
  name: "Hydrogen Demo Store",
  currency: "USD",
  country: "CA",
  productsCount: 22,
  collectionsCount: 6,
  checkedAt: new Date("2026-10-22T10:00:00Z"),
  connectedBy: "u1",
};
const ctx = () => ({ params: Promise.resolve({ id: "p1" }) });
const get = () => GET(new Request("http://x"), ctx());
const del = () => DELETE(new Request("http://x", { method: "DELETE" }), ctx());

beforeEach(() => {
  fijarAccesoDePrueba(null);
  m.enabled = true;
  m.store = memoryShopifyStore(() => new Date("2026-10-22T10:00:00Z"));
});

describe("/api/projects/[id]/shopify", () => {
  it("no store connected: available, with no store", async () => {
    expect(await (await get()).json()).toEqual({ available: true, store: null });
  });

  it("the connected store, with its admin link", async () => {
    await (m.store as ShopifyStore).put(ROW);
    expect(await (await get()).json()).toEqual({
      available: true,
      store: {
        name: "Hydrogen Demo Store",
        shopDomain: "hydrogen-preview.myshopify.com",
        primaryDomain: "checkout.hydrogen.shop",
        currency: "USD",
        country: "CA",
        productsCount: 22,
        collectionsCount: 6,
        checkedAt: "2026-10-22T10:00:00.000Z",
        connectedAt: "2026-10-22T10:00:00.000Z",
        adminUrl: "https://admin.shopify.com/store/hydrogen-preview",
      },
    });
  });

  it("a member gets 403, on every method", async () => {
    fijarAccesoDePrueba(() => ({ rol: "editor", duenoId: "dueno" }));
    expect((await get()).status).toBe(403);
    expect((await del()).status).toBe(403);
  });

  it("DELETE forgets the store and answers the panel", async () => {
    await (m.store as ShopifyStore).put(ROW);
    expect(await (await del()).json()).toEqual({ available: true, store: null });
    expect(await (m.store as ShopifyStore).get("p1")).toBeNull();
  });

  it("with Shopify off: not available, and nothing to disconnect", async () => {
    m.enabled = false;
    expect(await (await get()).json()).toEqual({ available: false, store: null });
    const r = await del();
    expect([r.status, (await r.json()).error]).toEqual([503, "shopify_unavailable"]);
  });
});
