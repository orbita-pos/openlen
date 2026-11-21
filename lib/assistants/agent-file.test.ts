// @vitest-environment node
//
// AN AGENT'S FILE (spec local 2026-11-19-agentes-para-todos, §6.1, §6.4): an assistant may point at one of its
// person's agent files, `~/.len/agents/<name>.md` in Claude Code's format. These read it, say what's wrong with a name,
// and pick the skills its turn preloads.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ listAgents: vi.fn(async (): Promise<{ name: string; text: string; updatedAt: Date }[]> => []) }));
vi.mock("@/lib/agent/subagents/agent-store", () => ({ listAgents: m.listAgents }));

const { resolveSkills } = await import("@/lib/agent/skills/registry");
const { agentPreloads, agentTypeProblem, firstMessageOf, loadAgentOf, warnBrokenAgentFile } = await import("./agent-file");

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

// Claude Code's `initialPrompt`: «auto-submitted as the first user turn» — only while its conversation is empty.
describe("firstMessageOf", () => {
  it("🔴 is the file's initialPrompt on an empty conversation, and nothing once it has turns", async () => {
    expect(await firstMessageOf("u1", "mr-smith", 0)).toBe("Hola, empecemos con tu nivel");
    expect(await firstMessageOf("u1", "mr-smith", 2)).toBeNull();
  });

  // Delivery 1 deferred it: once sent (claimed on her row), it isn't offered again — an opening that didn't get as far as
  // writing a turn would be offered on every visit and refused every time.
  it("🔴 once sent, it isn't offered again, even on an empty conversation", async () => {
    expect(await firstMessageOf("u1", "mr-smith", 0, new Date())).toBeNull();
    expect(await firstMessageOf("u1", "mr-smith", 0, null)).toBe("Hola, empecemos con tu nivel");
  });

  it("is nothing without a file, with one that is missing or broken, or one without an initialPrompt", async () => {
    m.listAgents.mockResolvedValue([stored("quiet", "---\nname: quiet\ndescription: Says nothing first\n---\n\nYou help.\n"), stored("broken", "x")]);
    expect(await firstMessageOf("u1", null, 0)).toBeNull();
    expect(await firstMessageOf("u1", "nobody", 0)).toBeNull();
    expect(await firstMessageOf("u1", "broken", 0)).toBeNull();
    expect(await firstMessageOf("u1", "quiet", 0)).toBeNull();
    expect(m.listAgents).toHaveBeenCalledTimes(3);
  });
});

// Review Focus 2 and the final review's finding 8: a broken file is said once, not on every turn.
describe("warnBrokenAgentFile", () => {
  it("logs once per assistant and file", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnBrokenAgentFile("a9", "mr-smith");
    warnBrokenAgentFile("a9", "mr-smith");
    warnBrokenAgentFile("a9", "coach");
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
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

  // Review Focus 3 of delivery 2 (spec §6.6): Len wrote the agent with a skill he proposed on a card. Until the person
  // saves it the agent runs without it; once saved — a personal skill of theirs — its next turn preloads it.
  it("🔴 preloads a skill the person saved from the card, beside a bundled one, in the file's order", async () => {
    m.listAgents.mockResolvedValue([stored("gardener", "---\nname: gardener\ndescription: Helps with my plants\nskills: plant-care, language-teacher\n---\n\nYou help with plants.\n")]);
    const agent = (await loadAgentOf("u1", "gardener"))!;
    const unsaved = resolveSkills({ bundled: [skill("language-teacher")], project: [], personal: [] });
    expect(agentPreloads(agent, new Set(), unsaved).map((s) => s.skill.name)).toEqual(["language-teacher"]);
    const saved = resolveSkills({
      bundled: [skill("language-teacher")],
      project: [],
      personal: [stored("plant-care", "---\nname: plant-care\ndescription: Look after plants.\n---\n\nWater when the soil is dry.\n")],
    });
    expect(agentPreloads(agent, new Set(), saved).map((s) => s.skill.name)).toEqual(["plant-care", "language-teacher"]);
  });
});
