import { describe, expect, it } from "vitest";

import { PERSONAL_SKILLS_DIR, PROJECT_SKILLS_DIR, isUnderSkillsDir, skillPath, skillPathOf } from "./paths";

describe("skill paths", () => {
  it("knows a project's and a person's SKILL.md", () => {
    expect(skillPathOf("/.len/skills/cotizar/SKILL.md")).toEqual({ scope: "project", name: "cotizar" });
    expect(skillPathOf("/home/user/.len/skills/x/SKILL.md")).toEqual({ scope: "personal", name: "x" });
  });

  it("a user skill is only its SKILL.md", () => {
    expect(skillPathOf("/.len/skills/x/run.py")).toBeNull();
    expect(skillPathOf("/.len/skills/x/SKILL.md/y")).toBeNull();
    expect(isUnderSkillsDir("/.len/skills/x/run.py")).toBe(true);
    expect(isUnderSkillsDir("/.len/memory/x.md")).toBe(false);
  });

  it("refuses a name that is not kebab-case", () => {
    expect(skillPathOf("/.len/skills/X Y/SKILL.md")).toBeNull();
    expect(skillPathOf("/.len/skills/Cotizar/SKILL.md")).toBeNull();
  });

  it("builds the path back", () => {
    expect(skillPath("project", "cotizar")).toBe(`${PROJECT_SKILLS_DIR}cotizar/SKILL.md`);
    expect(skillPath("personal", "x")).toBe(`${PERSONAL_SKILLS_DIR}x/SKILL.md`);
  });
});
