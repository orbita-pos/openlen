// @vitest-environment node
//
// /api/projects/[id]/email — the Correos tab (spec local 2026-10-22-email-integration,
// 4 and 6.9). Only the owner. The real dependencies are swapped for memory ones.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));
const m = vi.hoisted(() => ({ enabled: true, deps: null as unknown }));
vi.mock("@/lib/project-email/enabled", () => ({ emailEnabledIn: () => m.enabled }));
vi.mock("@/lib/project-email/real", () => ({ realPanelDeps: () => m.deps }));

import { fijarAccesoDePrueba } from "@/lib/projects/acceso-de-prueba";
import type { PanelDeps } from "@/lib/project-email/panel";
import type { ResendClients } from "@/lib/project-email/resend-clients";
import { memoryEmailStore } from "@/lib/project-email/store";

import { DELETE, GET, POST } from "./route";

const RECORDS = [
  { type: "MX" as const, name: "send.notify", value: "feedback-smtp.us-east-1.amazonses.com", priority: 10 },
  { type: "TXT" as const, name: "send.notify", value: "v=spf1 include:amazonses.com ~all" },
  { type: "TXT" as const, name: "resend._domainkey.notify", value: "p=MIGf" },
];

function deps(plan: "free" | "pro" = "pro"): PanelDeps {
  const resend: ResendClients = {
    createDomain: vi.fn(async () => ({ id: "rd_1", records: RECORDS, status: "not_started" })),
    getDomain: vi.fn(async () => ({ status: "pending", records: RECORDS })),
    verifyDomain: vi.fn(async () => {}),
    deleteDomain: vi.fn(async () => {}),
    send: vi.fn(),
  };
  return {
    store: memoryEmailStore(),
    resend,
    planOfProject: async () => plan,
    ownerOf: async () => ({ userId: "u1", email: "dueno@taller.mx" }),
    notify: async () => {},
    applyFunctionEnv: async () => {},
    now: () => new Date("2026-10-22T10:00:00Z"),
    dc: { resolveTxt: async () => [], fetch: (async () => new Response(null, { status: 404 })) as typeof fetch },
    resolveNs: async () => [],
    privateKeyPem: null,
    customDomainOf: async () => null,
    returnUrl: "https://openlen.com/api/email/domain-connect/return",
    stateSecret: "s",
  };
}

const ctx = () => ({ params: Promise.resolve({ id: "p1" }) });
const post = (body: unknown) => POST(new Request("http://x/api/projects/p1/email", { method: "POST", body: JSON.stringify(body) }), ctx());

beforeEach(() => {
  fijarAccesoDePrueba(null);
  m.enabled = true;
  m.deps = deps();
});

describe("/api/projects/[id]/email", () => {
  it("a member gets 403, on every method", async () => {
    fijarAccesoDePrueba(() => ({ rol: "editor", duenoId: "dueno" }));
    expect((await GET(new Request("http://x"), ctx())).status).toBe(403);
    expect((await post({ action: "check" })).status).toBe(403);
    expect((await DELETE(new Request("http://x", { method: "DELETE" }), ctx())).status).toBe(403);
  });

  it("with email off it says so", async () => {
    m.enabled = false;
    expect(await (await GET(new Request("http://x"), ctx())).json()).toEqual({ available: false });
  });

  it("the free plan sees plan: free with no domain, and can't connect", async () => {
    m.deps = deps("free");
    expect(await (await GET(new Request("http://x"), ctx())).json()).toMatchObject({ available: true, plan: "free", domain: null });
    const r = await post({ action: "connect", domain: "taller.mx", showAsRoot: false });
    expect([r.status, (await r.json()).error]).toEqual([402, "free_plan"]);
  });

  it("connect returns the three records; a bad domain is 400", async () => {
    const r = await post({ action: "connect", domain: "Taller.mx", showAsRoot: false });
    expect(r.status).toBe(200);
    expect((await r.json()).domain).toMatchObject({ sendingHost: "notify.taller.mx", records: RECORDS });
    expect((await post({ action: "connect", domain: "no es", showAsRoot: false })).status).toBe(400);
    expect((await post({ action: "nope" })).status).toBe(400);
  });

  it("check answers the panel with the new status; unsuppress removes the address", async () => {
    await post({ action: "connect", domain: "taller.mx", showAsRoot: false });
    expect((await (await post({ action: "check" })).json()).domain.status).toBe("verifying");
    const d = m.deps as PanelDeps;
    await d.store.suppress("p1", "ana@x.com", "bounced");
    expect((await (await post({ action: "unsuppress", address: "ANA@x.com" })).json()).suppressions).toEqual([]);
  });

  it("DELETE disconnects", async () => {
    await post({ action: "connect", domain: "taller.mx", showAsRoot: false });
    const r = await DELETE(new Request("http://x", { method: "DELETE" }), ctx());
    expect([r.status, (await r.json()).domain]).toEqual([200, null]);
  });
});
