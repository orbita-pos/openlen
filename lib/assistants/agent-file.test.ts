// @vitest-environment node
//
// AN AGENT'S FILE (spec local 2026-11-19-agentes-para-todos, §6.1, §6.4): an assistant may point at one of its
// person's agent files, `~/.len/agents/<name>.md` in Claude Code's format. These read it, say what's wrong with a name,
// and pick the skills its turn preloads.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ listAgents: vi.fn(async (): Promise<{ name: string; text: string; updatedAt: Date }[]> => []) }));
vi.mock("@/lib/agent/subagents/agent-store", () => ({ listAgents: m.listAgents }));

const { resolveSkills } = await import("@/lib/agent/skills/registry");
const { agentPreloads, agentTypeProblem, loadAgentOf } = await import("./agent-file");

const teacher = `---\nname: mr-smith\ndescription: My English teacher\nskills: language-teacher, b, missing\ninitialPrompt: Hola, empecemos con tu nivel\n---\n\nYou are Mr. Smith. Never give the answer first.\n`;
const stored = (name: string, text: string) => ({ name, text, updatedAt: new Date("2026-11-19T00:00:00Z") });
const skill = (name: string, modelInvocable = true) => ({
  skill: { name, description: `${name} skill`, modelInvocable, userInvocable: true, body: `${name} body`, fork: null },
  baseDir: `/.openlen/skills/${name}`,
});

beforeEach(() => {
  m.listAgents.mockReset();
  m.listAgents.mockResolvedValue([stored("mr-smith", teacher), stored("broken", "no frontmatter")]);
});

describe("loadAgentOf", () => {
  it("reads the person's agent file", async () => {
    const agent = await loadAgentOf("u1", "mr-smith");
    expect(m.listAgents).toHaveBeenCalledWith("personal", "u1");
    expect(agent).toMatchObject({ name: "mr-smith", skills: ["language-teacher", "b", "missing"], initialPrompt: "Hola, empecemos con tu nivel" });
    expect(agent?.body).toContain("Never give the answer first.");
  });

  it("is null for a file that is missing or broken", async () => {
    expect(await loadAgentOf("u1", "nobody")).toBeNull();
    expect(await loadAgentOf("u1", "broken")).toBeNull();
  });
});

describe("agentTypeProblem", () => {
  it("names what is wrong, or nothing", async () => {
    expect(await agentTypeProblem("u1", "nobody")).toBe("missing");
    expect(await agentTypeProblem("u1", "broken")).toBe("invalid");
    expect(await agentTypeProblem("u1", "assistant")).toBe("reserved");
    expect(await agentTypeProblem("u1", "mr-smith")).toBeNull();
  });
});

describe("agentPreloads", () => {
  it("its skills in order, without the loaded, the unknown and the ones the model can't invoke", async () => {
    const agent = (await loadAgentOf("u1", "mr-smith"))!;
    const skills = resolveSkills({ bundled: [skill("language-teacher"), skill("b")], project: [], personal: [] });
    expect(agentPreloads(agent, new Set(), skills).map((s) => s.skill.name)).toEqual(["language-teacher", "b"]);
    expect(agentPreloads(agent, new Set(["b"]), skills).map((s) => s.skill.name)).toEqual(["language-teacher"]);
    const hidden = resolveSkills({ bundled: [skill("language-teacher", false), skill("b")], project: [], personal: [] });
    expect(agentPreloads(agent, new Set(), hidden).map((s) => s.skill.name)).toEqual(["b"]);
  });
});
