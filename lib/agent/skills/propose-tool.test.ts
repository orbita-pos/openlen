// LEN'S `propose_skills` (spec local 2026-11-19-agentes-para-todos, §6.6): render-only, as Claude Code's — it draws the
// review card under his answer and writes nothing; the person saves from the card.
import { describe, expect, it } from "vitest";

import type { AgentSession } from "@/lib/agent/tools";

import { bundledSkillFiles } from "./bundled";
import { PROPOSE_SKILLS, PROPOSE_SKILLS_DECLARATION, runProposeSkills, skillProposalsOf } from "./propose-tool";
import { skillFingerprint } from "./proposals";
import { skillPath } from "./paths";

const CURRENT = "---\nname: plant-care\ndescription: Look after the person's plants.\n---\n\n# Plants\n\nWater when the top two centimetres are dry.\n";
const LEN = { projectId: "p1", userId: "u1" } as unknown as AgentSession;
const withRead = (snapshot: string | null) => {
  const leidos = new Map<string, { instantanea: string; offset?: number; limit?: number }>();
  if (snapshot !== null) leidos.set(skillPath("personal", "plant-care"), { instantanea: snapshot });
  return { ...LEN, leidos } as unknown as AgentSession;
};
const deps = (seen: string[] = []) => ({
  listPersonal: async (personId: string) => (seen.push(personId), [{ name: "plant-care", text: CURRENT }]),
});
const NEW = {
  name: "bread-baking",
  kind: "new",
  description: "Bake bread at home with the person.",
  skillMd: "---\nname: bread-baking\ndescription: x\n---\n\n# Bread\n\nKnead ten minutes.",
};
const IMPROVE = {
  name: "plant-care",
  kind: "improvement",
  target: "plant-care",
  description: "Look after the person's plants.",
  edits: [{ old_string: "two centimetres", new_string: "three centimetres" }],
};
const said = (out: { response: unknown }) => String((out.response as { tool_result?: string; message?: string }).tool_result ?? (out.response as { message?: string }).message);

describe("propose_skills", () => {
  it("is declared with up to three proposals of Claude Code's fields", () => {
    expect(PROPOSE_SKILLS).toBe("propose_skills");
    const proposals = (PROPOSE_SKILLS_DECLARATION.parameters.properties as Record<string, { maxItems?: number; description?: string; items?: { properties?: Record<string, unknown> } }>).proposals!;
    // The limit is said and checked on our side, never put on the wire: a ceiling there gags the model instead of
    // checking it (memory zod-max-is-a-gag-on-fireworks), and no other tool of Len's carries one.
    expect(proposals.maxItems).toBeUndefined();
    expect(proposals.description).toContain("1 to 3");
    expect(Object.keys(proposals.items!.properties!)).toEqual(["name", "kind", "target", "description", "evidence", "edits", "skillMd"]);
  });

  it("🔴 shows the card for the speaker's skills and writes nothing", async () => {
    const seen: string[] = [];
    const out = await runProposeSkills(LEN, { proposals: [NEW] }, deps(seen));
    expect(seen).toEqual(["u1"]);
    expect(out.response).toMatchObject({ ok: true, card: "skill_proposals" });
    expect(said(out)).toBe("Shown 1 skill proposal(s) to the person for review. Continue; don't wait for their answer.");
    expect(out.action?.tool).toBe(PROPOSE_SKILLS);
    const shown = skillProposalsOf(out.action!);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.skillMd).toContain("name: bread-baking\ndescription: Bake bread at home with the person.");
  });

  it("speaks for the member who talks, not the owner (personOf)", async () => {
    const seen: string[] = [];
    await runProposeSkills({ ...LEN, personId: "m1" } as unknown as AgentSession, { proposals: [NEW] }, deps(seen));
    expect(seen).toEqual(["m1"]);
  });

  it("🔴 an improvement needs the current SKILL.md read whole and unchanged", async () => {
    expect(said(await runProposeSkills(withRead(null), { proposals: [IMPROVE] }, deps()))).toContain("read ~/.len/skills/plant-care/SKILL.md first");
    expect(said(await runProposeSkills(withRead("an older text"), { proposals: [IMPROVE] }, deps()))).toMatch(/changed since you read it/);
    const partial = withRead(CURRENT);
    (partial.leidos as Map<string, { limit?: number }>).get(skillPath("personal", "plant-care"))!.limit = 3;
    expect(said(await runProposeSkills(partial, { proposals: [IMPROVE] }, deps()))).toContain("first");
    const out = await runProposeSkills(withRead(CURRENT.replace(/\n/g, "\r\n")), { proposals: [IMPROVE] }, deps());
    expect(out.response).toMatchObject({ ok: true });
    expect(skillProposalsOf(out.action!)[0]!.base).toBe(skillFingerprint(CURRENT));
  });

  it("a refused proposal is a tool error with no card", async () => {
    const out = await runProposeSkills(LEN, { proposals: [{ ...NEW, name: "cooking-x", skillMd: "---\nname: cooking-x\ndescription: x\n---\n\n" }] }, deps());
    expect(out.response).toMatchObject({ ok: false, error: "proposal_refused" });
    expect(said(out)).toMatch(/no instructions/);
    expect(out.action).toBeUndefined();
  });

  it("an assistant never proposes skills: that is Len's", async () => {
    const out = await runProposeSkills({ ...LEN, assistant: { id: "a1" } } as unknown as AgentSession, { proposals: [NEW] }, deps());
    expect(out.response).toMatchObject({ ok: false, error: "not_available" });
  });

  it("🔴 skill-creator and learn send the person's own skills to propose_skills, and the project's to Write", () => {
    const files = bundledSkillFiles();
    for (const name of ["skill-creator", "learn"]) {
      const text = files[`/.openlen/skills/${name}/SKILL.md`]!;
      expect(text, name).toContain("propose_skills");
      expect(text, name).toMatch(/~\/\.len\/skills\/[^\n]*propose_skills|propose_skills[^\n]*~\/\.len\/skills\//);
      expect(text, name).toMatch(/\/\.len\/skills\/[^\n]*Write/);
    }
  });

  it("skillProposalsOf reads back what the card shows and drops what isn't a proposal", () => {
    expect(skillProposalsOf({ summary: "not json" })).toEqual([]);
    expect(skillProposalsOf({})).toEqual([]);
    const good = { name: "a-b", kind: "new", target: null, description: "d", skillMd: "---\nname: a-b\ndescription: d\n---\n\nx\n", base: null };
    expect(skillProposalsOf({ summary: JSON.stringify({ proposals: [good, { name: 3 }, null] }) })).toEqual([good]);
  });
});
