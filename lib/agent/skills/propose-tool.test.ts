// LEN'S `propose_skills` (spec local 2026-11-19-agentes-para-todos, §6.6): render-only, as Claude Code's — it draws the
// review card under his answer and writes nothing; the person saves from the card.
import { describe, expect, it } from "vitest";

import { ejecutarRead, type Leidos } from "@/lib/agent/ficheros/read";
import type { AgentSession } from "@/lib/agent/tools";

import { bundledSkillFiles } from "./bundled";
import { skillProposalIdsOf } from "./proposal-card";
import { PROPOSE_SKILLS, PROPOSE_SKILLS_DECLARATION, runProposeSkills } from "./propose-tool";
import { skillFingerprint } from "./proposals";
import { skillPath } from "./paths";

const CURRENT = "---\nname: plant-care\ndescription: Look after the person's plants.\n---\n\n# Plants\n\nWater when the top two centimetres are dry.\n";
const LEN = { projectId: "p1", userId: "u1" } as unknown as AgentSession;
const withRead = (snapshot: string | null) => {
  const leidos = new Map<string, { instantanea: string; offset?: number; limit?: number }>();
  if (snapshot !== null) leidos.set(skillPath("personal", "plant-care"), { instantanea: snapshot });
  return { ...LEN, leidos } as unknown as AgentSession;
};
/** What the tool stored, by the speaker and the project: final review C2 — the card reads them from the server. */
type Row = { name: string; skillMd: string; base: string | null; baseText: string | null };
const stored: { personId: string; projectId: string; rows: Row[] }[] = [];
const deps = (seen: string[] = []) => ({
  listPersonal: async (personId: string) => (seen.push(personId), [{ name: "plant-care", text: CURRENT }]),
  saveProposals: async (personId: string, projectId: string, rows: readonly Row[]) => {
    stored.push({ personId, projectId, rows: [...rows] });
    return rows.map((_, i) => `00000000-0000-4000-8000-00000000000${i + 1}`);
  },
});
const lastStored = () => stored[stored.length - 1]!;
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

  // Delivery 2's deferred minor: the card says «Pídele que la proponga otra vez» when a skill changed since it was proposed,
  // so the tool can't forbid proposing one they already saw when they ask for it.
  it("🔴 proposing a skill they already saw again is fine when they ask for it, as the card's «changed» tells them to", () => {
    expect(PROPOSE_SKILLS_DECLARATION.description).toContain("not again for a skill they already saw unless they ask for it");
  });

  it("🔴 shows the card for the speaker's skills and writes nothing", async () => {
    const seen: string[] = [];
    const out = await runProposeSkills(LEN, { proposals: [NEW] }, deps(seen));
    expect(seen).toEqual(["u1"]);
    expect(out.response).toMatchObject({ ok: true, card: "skill_proposals" });
    expect(said(out)).toBe("Shown 1 skill proposal(s) to the person for review. Continue; don't wait for their answer.");
    expect(out.action?.tool).toBe(PROPOSE_SKILLS);
    // 🔴 The action carries only the ids: the chat's save cuts a summary to 200 characters (final review C2).
    expect(skillProposalIdsOf(out.action!)).toEqual(["00000000-0000-4000-8000-000000000001"]);
    expect(out.action!.summary!.length).toBeLessThan(200);
    expect(lastStored()).toMatchObject({ personId: "u1", projectId: "p1" });
    expect(lastStored().rows[0]!.skillMd).toContain("name: bread-baking\ndescription: Bake bread at home with the person.");
    expect(lastStored().rows[0]!.baseText).toBeNull();
  });

  // The proposals go with their project (skillProposals' key): an isolated subagent's copy is thrown away after its work.
  it("in an isolated subagent's copy, keeps them under the real project", async () => {
    await runProposeSkills({ ...LEN, projectId: "copy-1", parentProjectId: "p1" } as unknown as AgentSession, { proposals: [NEW] }, deps());
    expect(lastStored()).toMatchObject({ personId: "u1", projectId: "p1" });
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
    Object.assign((partial.leidos as Map<string, object>).get(skillPath("personal", "plant-care"))!, { offset: 1, limit: 3, vistaParcial: true });
    expect(said(await runProposeSkills(partial, { proposals: [IMPROVE] }, deps()))).toContain("first");
    const out = await runProposeSkills(withRead(CURRENT.replace(/\n/g, "\r\n")), { proposals: [IMPROVE] }, deps());
    expect(out.response).toMatchObject({ ok: true });
    expect(lastStored().rows[0]!.base).toBe(skillFingerprint(CURRENT));
    expect(lastStored().rows[0]!.baseText).toBe(CURRENT);
  });

  // Final review C1: a real Read records offset 1 for a whole file; the check must be Edit's own (`vistaParcial`).
  it("🔴 after a real whole-file Read, an improvement goes through; after a partial one, it doesn't", async () => {
    const path = skillPath("personal", "plant-care");
    const site = { contenido: (r: string) => (r === path ? CURRENT : null), ficheros: [path] };
    const whole = { ...LEN, leidos: new Map() } as unknown as AgentSession;
    expect(ejecutarRead({ file_path: "~/.len/skills/plant-care/SKILL.md" }, site, whole.leidos as Leidos).ok).toBe(true);
    expect((await runProposeSkills(whole, { proposals: [IMPROVE] }, deps())).response).toMatchObject({ ok: true });
    const partial = { ...LEN, leidos: new Map() } as unknown as AgentSession;
    (partial.leidos as Leidos).set(path, { instantanea: CURRENT, offset: 1, limit: 2, vistaParcial: true });
    expect(said(await runProposeSkills(partial, { proposals: [IMPROVE] }, deps()))).toContain("first");
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

  it("skillProposalIdsOf reads the ids back, at most three, and drops what isn't one", () => {
    expect(skillProposalIdsOf({ summary: "not json" })).toEqual([]);
    expect(skillProposalIdsOf({})).toEqual([]);
    const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    expect(skillProposalIdsOf({ summary: JSON.stringify({ ids: [id(1), 3, "../x", id(2), id(3), id(4)] }) })).toEqual([id(1), id(2), id(3)]);
  });
});
