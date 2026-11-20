// @vitest-environment node
//
// POST /api/space (spec local 2026-11-19-agentes-para-todos, §6.3): the person's space, born the first time — with
// their session or the phone's key; off with OPENLEN_AGENTS=0 (and with the assistant off).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  person: vi.fn(async (): Promise<string | null> => "u1"),
  ensureSpace: vi.fn(async (_personId: string) => "space-1"),
}));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: m.person }));
vi.mock("@/lib/space/store", () => ({ ensureSpace: m.ensureSpace }));

const { POST } = await import("./route");

const post = () => POST(new Request("http://localhost/api/space", { method: "POST" }), { params: Promise.resolve({}) });

beforeEach(() => {
  m.person.mockResolvedValue("u1");
  m.ensureSpace.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/space", () => {
  it("signed out: 401 and nothing is made", async () => {
    m.person.mockResolvedValue(null);
    expect((await post()).status).toBe(401);
    expect(m.ensureSpace).not.toHaveBeenCalled();
  });

  it("with OPENLEN_AGENTS=0: 404 agents_off", async () => {
    vi.stubEnv("OPENLEN_AGENTS", "0");
    const res = await post();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "agents_off" });
    expect(m.ensureSpace).not.toHaveBeenCalled();
  });

  it("with the assistant off too: 404 agents_off", async () => {
    vi.stubEnv("OPENLEN_ASSISTANT", "0");
    expect((await post()).status).toBe(404);
  });

  it("signed in: 200 with the person's space", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "space-1" });
    expect(m.ensureSpace).toHaveBeenCalledWith("u1");
  });
});
