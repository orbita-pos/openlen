// @vitest-environment node
//
// SAVING A SKILL FROM THE REVIEW CARD (spec local 2026-11-19-agentes-para-todos, §6.6): the person's own, as the person
// who is signed in; an improvement only over the text Len proposed it on, so a skill that changed since is never
// overwritten in silence.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { skillFingerprint } from "@/lib/agent/skills/proposals";

const m = vi.hoisted(() => ({
  session: vi.fn(async (): Promise<{ user?: { id?: string } } | null> => ({ user: { id: "u1" } })),
  skills: new Map<string, Map<string, string>>(),
  upserts: [] as unknown[][],
}));
vi.mock("@/auth", () => ({ auth: m.session }));
vi.mock("@/lib/agent/skills/store", () => ({
  listSkills: async (scope: string, owner: string) =>
    scope === "personal" ? [...(m.skills.get(owner) ?? new Map())].map(([name, text]) => ({ name, text, updatedAt: new Date(0) })) : [],
  upsertSkill: async (scope: string, owner: string, name: string, text: string, author: string | null) => {
    m.upserts.push([scope, owner, name, text, author]);
    if (!m.skills.has(owner)) m.skills.set(owner, new Map());
    m.skills.get(owner)!.set(name, text);
    return { before: null };
  },
}));

const { POST } = await import("./route");
const { GET } = await import("./[name]/route");

const fileOf = (name: string, body = "Water when the soil is dry.") => `---\nname: ${name}\ndescription: Look after plants.\n---\n\n${body}\n`;
const post = (body: unknown) => POST(new Request("http://localhost/api/me/skills", { method: "POST", body: JSON.stringify(body) }));
const get = (name: string) => GET(new Request(`http://localhost/api/me/skills/${name}`), { params: Promise.resolve({ name }) });

beforeEach(() => {
  m.session.mockResolvedValue({ user: { id: "u1" } });
  m.skills.clear();
  m.upserts.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/me/skills", () => {
  it("signed out: 401 and nothing saved", async () => {
    m.session.mockResolvedValue(null);
    expect((await post({ name: "plant-care", skillMd: fileOf("plant-care"), base: null })).status).toBe(401);
    expect(m.upserts).toEqual([]);
  });

  it("🔴 saves a new one as the signed-in person's skill, and answers its fingerprint", async () => {
    const res = await post({ name: "plant-care", skillMd: fileOf("plant-care"), base: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: true, fingerprint: skillFingerprint(fileOf("plant-care")) });
    expect(m.upserts).toEqual([["personal", "u1", "plant-care", fileOf("plant-care"), "u1"]]);
  });

  it("🔴 an improvement saves over the text it was proposed on", async () => {
    m.skills.set("u1", new Map([["plant-care", fileOf("plant-care")]]));
    const res = await post({ name: "plant-care", skillMd: fileOf("plant-care", "Water less in winter."), base: skillFingerprint(fileOf("plant-care")) });
    expect(res.status).toBe(200);
    expect(m.skills.get("u1")!.get("plant-care")).toContain("winter");
  });

  it("🔴 a skill that changed since Len proposed it is never overwritten: 409 changed", async () => {
    m.skills.set("u1", new Map([["plant-care", fileOf("plant-care", "Edited by hand meanwhile.")]]));
    const res = await post({ name: "plant-care", skillMd: fileOf("plant-care", "Water less in winter."), base: skillFingerprint(fileOf("plant-care")) });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "changed" });
    expect(m.upserts).toEqual([]);
  });

  it("a new one whose name appeared meanwhile is a change too: 409 changed", async () => {
    m.skills.set("u1", new Map([["plant-care", fileOf("plant-care")]]));
    expect((await post({ name: "plant-care", skillMd: fileOf("plant-care", "Other."), base: null })).status).toBe(409);
    expect(m.upserts).toEqual([]);
  });

  it("a new one past the most skills a person keeps: 409 limit, nothing saved", async () => {
    m.skills.set("u1", new Map(Array.from({ length: 100 }, (_, i) => [`s-${i}`, fileOf(`s-${i}`)] as const)));
    const res = await post({ name: "plant-care", skillMd: fileOf("plant-care"), base: null });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("limit");
    expect(m.upserts).toEqual([]);
  });

  it("one of OpenLen's own names: 409 reserved", async () => {
    const res = await post({ name: "skill-creator", skillMd: fileOf("skill-creator"), base: null });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "reserved" });
  });

  it("🔴 a credential in it: 400 and nothing saved", async () => {
    const res = await post({ name: "plant-care", skillMd: fileOf("plant-care", "Order with sk-abcdefghijklmnopqrstuvwxyz123456."), base: null });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid");
    expect(m.upserts).toEqual([]);
  });

  it("a body that isn't a proposal: 400", async () => {
    expect((await post({ name: 3 })).status).toBe(400);
    expect((await POST(new Request("http://localhost/api/me/skills", { method: "POST", body: "nope" }))).status).toBe(400);
  });

  it("another person's skill of the same name is never touched", async () => {
    m.skills.set("u2", new Map([["plant-care", fileOf("plant-care", "Theirs.")]]));
    await post({ name: "plant-care", skillMd: fileOf("plant-care"), base: null });
    expect(m.skills.get("u2")!.get("plant-care")).toContain("Theirs.");
  });

  it("with skills off (OPENLEN_SKILLS=0): 404", async () => {
    vi.stubEnv("OPENLEN_SKILLS", "0");
    expect((await post({ name: "plant-care", skillMd: fileOf("plant-care"), base: null })).status).toBe(404);
  });
});

describe("GET /api/me/skills/[name]", () => {
  it("the fingerprint of the person's skill, or null", async () => {
    expect(await (await get("plant-care")).json()).toEqual({ fingerprint: null });
    m.skills.set("u1", new Map([["plant-care", fileOf("plant-care")]]));
    expect(await (await get("plant-care")).json()).toEqual({ fingerprint: skillFingerprint(fileOf("plant-care")) });
  });

  it("signed out: 401", async () => {
    m.session.mockResolvedValue(null);
    expect((await get("plant-care")).status).toBe(401);
  });
});
