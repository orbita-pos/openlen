// The phone's «Entregado» (spec local 2026-10-31-len-movil, §5.3): what Len delivered in every project
// the person can see, newest first.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: vi.fn() }));
vi.mock("@/lib/projects/visible-projects", () => ({ visibleProjects: vi.fn() }));
vi.mock("@/lib/agent/skills/delivery-index", () => ({ listDeliveries: vi.fn() }));

import { listDeliveries } from "@/lib/agent/skills/delivery-index";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { visibleProjects } from "@/lib/projects/visible-projects";
import { GET } from "./route";

const ROW = { id: "d1", projectId: "seen", turnId: "t1", name: "a.pdf", url: "/api/projects/seen/deliveries/t1/ab12cd34-a.pdf", previewUrl: null, size: 3, contentType: "application/pdf", description: null, createdAt: new Date("2026-11-10T18:00:00Z") };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usuarioDeLaPeticion).mockResolvedValue("u1");
  vi.mocked(visibleProjects).mockResolvedValue([
    { id: "own", title: "Mi tienda", role: "dueno" },
    { id: "seen", title: "Sólo mirar", role: "lector" },
  ]);
  vi.mocked(listDeliveries).mockResolvedValue([ROW]);
});

describe("GET /api/movil/delivered", () => {
  it("lists the deliveries of every project the person can see, with the project's title", async () => {
    const res = await GET(new Request("http://x/api/movil/delivered", { headers: { origin: "https://localhost" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [{ ...ROW, createdAt: ROW.createdAt.toISOString(), projectTitle: "Sólo mirar" }] });
    expect(listDeliveries).toHaveBeenCalledWith(["own", "seen"], 50);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
  });

  it("caps the limit at 100", async () => {
    await GET(new Request("http://x/api/movil/delivered?limit=5000"));
    expect(listDeliveries).toHaveBeenCalledWith(["own", "seen"], 100);
  });

  it("without a person it is 401", async () => {
    vi.mocked(usuarioDeLaPeticion).mockResolvedValue(null);
    expect((await GET(new Request("http://x/api/movil/delivered"))).status).toBe(401);
  });
});
