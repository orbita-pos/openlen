// @vitest-environment node
//
// THE REVIEW CARD'S ROUTES (spec local 2026-11-19-agentes-para-todos, §6.6; final review C2, I1): the card asks for the
// proposals by id — only their person gets them — and «Guardar» saves the one the server keeps, by id, never a SKILL.md a
// browser sends. The store's rules (changed, limit, idempotent) are pinned in proposal-store.pglite.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ID = "00000000-0000-4000-8000-000000000001";
const m = vi.hoisted(() => ({
  session: vi.fn(async (): Promise<{ user?: { id?: string } } | null> => ({ user: { id: "u1" } })),
  save: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ ok: true, fingerprint: "f".repeat(64) })),
  proposalsFor: vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []),
  skills: [] as { name: string; text: string }[],
}));
vi.mock("@/auth", () => ({ auth: m.session }));
vi.mock("@/lib/agent/skills/proposal-store", () => ({ saveProposedSkill: m.save, proposalsFor: m.proposalsFor }));
vi.mock("@/lib/agent/skills/store", () => ({ listSkills: async () => m.skills.map((s) => ({ ...s, updatedAt: new Date(0) })) }));

const { POST } = await import("./route");
const { GET } = await import("./proposals/route");
const { skillFingerprint } = await import("@/lib/agent/skills/proposals");

const post = (body: unknown) => POST(new Request("http://localhost/api/me/skills", { method: "POST", body: JSON.stringify(body) }));
const get = (ids: string) => GET(new Request(`http://localhost/api/me/skills/proposals?ids=${ids}`));
const SKILL = "---\nname: plant-care\ndescription: d\n---\n\nWater.\n";
const stored = { id: ID, name: "plant-care", kind: "new", target: null, description: "d", skillMd: SKILL, baseText: null, fingerprint: skillFingerprint(SKILL) };

beforeEach(() => {
  m.session.mockResolvedValue({ user: { id: "u1" } });
  m.save.mockClear();
  m.proposalsFor.mockReset();
  m.proposalsFor.mockResolvedValue([]);
  m.skills = [];
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/me/skills", () => {
  it("signed out: 401 and nothing saved", async () => {
    m.session.mockResolvedValue(null);
    expect((await post({ proposalId: ID })).status).toBe(401);
    expect(m.save).not.toHaveBeenCalled();
  });

  it("🔴 saves the stored proposal by its id, as the signed-in person", async () => {
    const res = await post({ proposalId: ID });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: true, fingerprint: "f".repeat(64) });
    expect(m.save.mock.calls[0]!.slice(0, 2)).toEqual(["u1", ID]);
  });

  it("🔴 a SKILL.md sent by the browser is never what gets saved", async () => {
    await post({ proposalId: ID, skillMd: "---\nname: x\ndescription: y\n---\n\nInjected.\n", name: "x" });
    expect(m.save).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(m.save.mock.calls[0])).not.toContain("Injected");
  });

  it("each refusal its status: another person's or unknown 404, changed/limit/reserved 409, invalid 400", async () => {
    for (const [error, status] of [["not_found", 404], ["changed", 409], ["limit", 409], ["reserved", 409], ["invalid", 400]] as const) {
      m.save.mockResolvedValueOnce({ ok: false, error });
      const res = await post({ proposalId: ID });
      expect(res.status, error).toBe(status);
      expect((await res.json()).error).toBe(error);
    }
  });

  it("a body without a proposal id: 400", async () => {
    expect((await post({ name: "x" })).status).toBe(400);
    expect((await POST(new Request("http://localhost/api/me/skills", { method: "POST", body: "nope" }))).status).toBe(400);
  });

  it("with skills off (OPENLEN_SKILLS=0): 404", async () => {
    vi.stubEnv("OPENLEN_SKILLS", "0");
    expect((await post({ proposalId: ID })).status).toBe(404);
  });
});

describe("GET /api/me/skills/proposals", () => {
  it("🔴 only the signed-in person's proposals, each saying whether it is saved", async () => {
    m.proposalsFor.mockResolvedValue([stored]);
    const res = await get(`${ID},not-an-id`);
    expect(m.proposalsFor).toHaveBeenCalledWith("u1", [ID]);
    expect(await res.json()).toEqual({ proposals: [{ id: ID, name: "plant-care", kind: "new", target: null, description: "d", skillMd: SKILL, saved: false }] });
    m.skills = [{ name: "plant-care", text: SKILL }];
    expect((await (await get(ID)).json()).proposals[0].saved).toBe(true);
  });

  it("signed out: 401; skills off: 404", async () => {
    m.session.mockResolvedValue(null);
    expect((await get(ID)).status).toBe(401);
    m.session.mockResolvedValue({ user: { id: "u1" } });
    vi.stubEnv("OPENLEN_SKILLS", "0");
    expect((await get(ID)).status).toBe(404);
  });
});
