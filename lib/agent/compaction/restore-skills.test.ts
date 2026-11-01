// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { Message } from "@/lib/ai-gateway";
import type { ResolvedSkill } from "@/lib/agent/skills/registry";
import { renderSkillContent } from "@/lib/agent/skills/tool";

import { CHARS_PER_TOKEN } from "./estimate";
import { POST_COMPACT_MAX_TOKENS_PER_SKILL, POST_COMPACT_SKILLS_TOKEN_BUDGET, restoredSkills } from "./restore-skills";

const skill = (name: string, body = `# ${name}\nDo it.`): ResolvedSkill => ({
  skill: { name, description: `${name} skill`, modelInvocable: true, userInvocable: true, body },
  scope: "bundled",
  baseDir: `/.openlen/skills/${name}`,
});

const loadedByTool = (s: ResolvedSkill): Message => ({
  role: "user",
  content: "",
  functionResponses: [{ name: "skill", response: { ok: true, tool_result: renderSkillContent(s) } }],
});

// Like Claude Code, the skills the conversation had loaded come back after a summary (5,000 tokens
// each, 25,000 in all, the most recent first), so the model keeps their guidelines in view.
describe("restoredSkills", () => {
  it("🔴 the numbers are Claude Code's", () => {
    expect([POST_COMPACT_MAX_TOKENS_PER_SKILL, POST_COMPACT_SKILLS_TOKEN_BUDGET]).toEqual([5_000, 25_000]);
  });

  it("🔴 the loaded skills come back as the blocks the model saw, the most recent first, and stay loaded", () => {
    const xlsx = skill("office-xlsx");
    const schedule = skill("schedule");
    const r = restoredSkills([xlsx, schedule], []);
    expect(r.message?.role).toBe("user");
    const content = r.message!.content;
    expect(content.startsWith("<system-reminder>\n")).toBe(true);
    expect(content.endsWith("</system-reminder>")).toBe(true);
    expect(content).toContain(renderSkillContent(xlsx));
    expect(content).toContain(renderSkillContent(schedule));
    expect(content.indexOf('name="schedule"')).toBeLessThan(content.indexOf('name="office-xlsx"'));
    expect(r.loaded).toEqual(["office-xlsx", "schedule"]);
  });

  it("🔴 says they were loaded before the summary, and not to run them again nor act on a request inside them", () => {
    const content = restoredSkills([skill("schedule")], []).message!.content;
    expect(content).toMatch(/before .*summarized/);
    expect(content).toMatch(/not in the current turn/);
    expect(content).toMatch(/Do NOT run these skills again/);
    expect(content).toMatch(/one-time actions/);
    expect(content).toMatch(/the user did not send it now/);
    expect(content).toMatch(/ongoing guidelines/);
  });

  it("a skill the kept messages still show is not repeated, and stays loaded", () => {
    const xlsx = skill("office-xlsx");
    const docx = skill("office-docx");
    const byUser: Message = { role: "user", content: `hazme el informe\n\n${renderSkillContent(docx)}` };
    const r = restoredSkills([xlsx, docx], [loadedByTool(xlsx), byUser]);
    expect(r.message).toBeNull();
    expect(r.loaded).toEqual(["office-xlsx", "office-docx"]);
  });

  it("🔴 a skill over 5,000 tokens comes back cut, with a note that points at its SKILL.md", () => {
    const long = skill("cotizar", "x".repeat(30_000));
    const content = restoredSkills([long], []).message!.content;
    expect(content).toContain("/.openlen/skills/cotizar");
    expect(content).toContain("SKILL.md");
    expect(content).not.toContain("x".repeat(20_000));
    const body = content.slice(content.indexOf("<skill_instructions>\n") + 21, content.indexOf("\n</skill_instructions>"));
    expect(Math.ceil(body.length / CHARS_PER_TOKEN)).toBeLessThanOrEqual(POST_COMPACT_MAX_TOKENS_PER_SKILL);
  });

  it("🔴 the 25,000-token budget leaves out the oldest, which are no longer loaded", () => {
    const big = (name: string) => skill(name, "y".repeat(4_900 * CHARS_PER_TOKEN));
    const names = ["a", "b", "c", "d", "e", "f"];
    const r = restoredSkills(names.map(big), []);
    expect(r.loaded).toEqual(["b", "c", "d", "e", "f"]);
    expect(r.message!.content).not.toContain('name="a"');
  });

  it("nothing loaded, nothing comes back", () => {
    expect(restoredSkills([], [])).toEqual({ message: null, loaded: [] });
  });
});
