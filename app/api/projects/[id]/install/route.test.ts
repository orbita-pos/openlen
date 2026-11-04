// POST /api/projects/[id]/install (spec local 2026-11-04-herramientas-hechas-por-len, §4.2): «Instalar» answers
// whatever the gates answer, for the person who asks.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: vi.fn() }));
vi.mock("@/lib/tools/install", () => ({ installTool: vi.fn() }));

const { usuarioDeLaPeticion } = await import("@/lib/movil/quien");
const { installTool } = await import("@/lib/tools/install");
const { POST } = await import("./route");

const post = (body: unknown) =>
  POST(new Request("http://localhost:3000/api/projects/p1/install", { method: "POST", headers: { host: "localhost:3000" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "p1" }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usuarioDeLaPeticion).mockResolvedValue("u1");
  vi.mocked(installTool).mockResolvedValue({ status: 200, body: { installation: { id: "i1" } } });
});

describe("POST install", () => {
  it("without a person: 401", async () => {
    vi.mocked(usuarioDeLaPeticion).mockResolvedValue(null);
    expect((await post({})).status).toBe(401);
    expect(installTool).not.toHaveBeenCalled();
  });

  it("passes the person, the locale, the host and the acceptances to installTool", async () => {
    const res = await post({ locale: "es", acceptSecurityFingerprint: "fp", confirmFingerprint: "dfp", copyDraftData: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ installation: { id: "i1" } });
    expect(installTool).toHaveBeenCalledWith({
      projectId: "p1",
      actorId: "u1",
      locale: "es",
      requestHost: "localhost:3000",
      acceptSecurityFingerprint: "fp",
      confirmFingerprint: "dfp",
      copyDraftData: true,
    });
  });

  it("answers the gate's status as it is", async () => {
    vi.mocked(installTool).mockResolvedValue({ status: 428, body: { error: "security_findings" } });
    const res = await post({});
    expect(res.status).toBe(428);
    expect(await res.json()).toEqual({ error: "security_findings" });
  });

  it("a malformed body: 400", async () => {
    expect((await post({ copyDraftData: "yes" })).status).toBe(400);
  });
});
