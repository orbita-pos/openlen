// @vitest-environment node
//
// The return from a DNS provider after Domain Connect (spec local
// 2026-10-22-email-integration, 6.2): the state proves the project, the owner
// is checked, the domain is checked, and the owner lands on the Correos tab.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));
const m = vi.hoisted(() => ({ check: vi.fn(async () => "verifying"), deps: { stateSecret: "secret" } as unknown }));
vi.mock("@/lib/project-email/real", () => ({ realPanelDeps: () => m.deps }));
vi.mock("@/lib/project-email/domain", async (orig) => ({ ...(await orig<object>()), checkDomain: m.check }));

import { fijarAccesoDePrueba } from "@/lib/projects/acceso-de-prueba";
import { dcState } from "@/lib/project-email/panel";

import { GET } from "./route";

beforeEach(() => {
  fijarAccesoDePrueba(null);
  m.check.mockClear();
});

describe("/api/email/domain-connect/return", () => {
  it("a forged state is refused and nothing is checked", async () => {
    const r = await GET(new Request("http://x/api/email/domain-connect/return?state=p1.AAAA"));
    expect(r.status).toBe(400);
    expect(m.check).not.toHaveBeenCalled();
  });

  it("a good state checks the domain and sends the owner to the Correos tab", async () => {
    const r = await GET(new Request(`http://x/api/email/domain-connect/return?state=${encodeURIComponent(dcState("p1", "secret"))}`));
    expect(r.status).toBe(303);
    expect(new URL(r.headers.get("location")!).pathname + new URL(r.headers.get("location")!).search).toBe("/new?project=p1&view=database");
    expect(m.check).toHaveBeenCalledWith("p1", m.deps);
  });

  it("someone who isn't the owner can't use another project's state", async () => {
    fijarAccesoDePrueba(() => ({ rol: "editor", duenoId: "dueno" }));
    const r = await GET(new Request(`http://x/api/email/domain-connect/return?state=${encodeURIComponent(dcState("p1", "secret"))}`));
    expect(r.status).toBe(403);
    expect(m.check).not.toHaveBeenCalled();
  });
});
