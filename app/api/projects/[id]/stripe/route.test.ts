// @vitest-environment node
//
// /api/projects/[id]/stripe — the Payments tab and disconnecting (spec local
// 2026-10-21-stripe-integration, §6.6 and §6.7). Only the owner.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));
const m = vi.hoisted(() => ({ enabled: true, panel: vi.fn(), unset: vi.fn(), deps: {} as unknown }));
vi.mock("@/lib/stripe/enabled", () => ({ stripeEnabled: () => m.enabled }));
vi.mock("@/lib/stripe/panel", () => ({ stripePanel: m.panel }));
vi.mock("@/lib/functions/secrets-real", () => ({ realSecretsDeps: () => m.deps }));
vi.mock("@/lib/functions/secrets-core", () => ({ unsetFunctionSecrets: m.unset }));

import { fijarAccesoDePrueba } from "@/lib/projects/acceso-de-prueba";

import { DELETE, GET } from "./route";

const ctx = () => ({ params: Promise.resolve({ id: "p1" }) });
const get = (env = "draft") => GET(new Request(`http://x/api/projects/p1/stripe?env=${env}`), ctx());

beforeEach(() => {
  fijarAccesoDePrueba(null);
  m.enabled = true;
  m.panel.mockReset();
  m.unset.mockReset();
  m.deps = {};
});

describe("/api/projects/[id]/stripe", () => {
  it("GET is owner-only", async () => {
    fijarAccesoDePrueba(() => ({ rol: "editor", duenoId: "dueno" }));
    const r = await get();
    expect([r.status, await r.json()]).toEqual([403, { error: "owner_only" }]);
  });

  it("GET without Stripe says so; with it, the panel of that environment", async () => {
    m.enabled = false;
    expect(await (await get()).json()).toEqual({ available: false });
    m.enabled = true;
    m.panel.mockResolvedValueOnce({ available: true, environment: "live", account: null });
    expect(await (await get("live")).json()).toEqual({ available: true, environment: "live", account: null });
    expect(m.panel).toHaveBeenCalledWith("p1", "live");
    expect((await get("nope")).status).toBe(400);
  });

  it("DELETE removes both keys (the hook takes the webhook secrets with them)", async () => {
    m.unset.mockResolvedValue(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]);
    const r = await DELETE(new Request("http://x/api/projects/p1/stripe", { method: "DELETE" }), ctx());
    expect(r.status).toBe(200);
    expect(m.unset.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["draft", ["STRIPE_SECRET_KEY"]],
      ["live", ["STRIPE_SECRET_KEY"]],
    ]);
    expect(await r.json()).toEqual({ ok: true, removed: { draft: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"], live: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] } });
  });

  it("DELETE is owner-only too", async () => {
    fijarAccesoDePrueba(() => ({ rol: "editor", duenoId: "dueno" }));
    expect((await DELETE(new Request("http://x/api/projects/p1/stripe", { method: "DELETE" }), ctx())).status).toBe(403);
    expect(m.unset).not.toHaveBeenCalled();
  });
});
