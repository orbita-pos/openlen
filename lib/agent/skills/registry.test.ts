import { describe, expect, it } from "vitest";

import { resolveSkills } from "./registry";
import type { BundledSkill } from "./bundled";
import type { SkillDefinition } from "./skill-file";

const def = (name: string, o: Partial<SkillDefinition> = {}): SkillDefinition => ({
  name,
  description: `${name} skill`,
  modelInvocable: true,
  userInvocable: true,
  body: "Do it.",
  ...o,
});
const bundled = (name: string): BundledSkill => ({ skill: def(name), baseDir: `/.openlen/skills/${name}` });
const stored = (name: string, extra = "", description = `${name} skill`) => ({
  name,
  text: `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\nDo it.\n`,
  updatedAt: new Date(0),
});

describe("resolveSkills", () => {
  it("personal wins over project on the same name", () => {
    const set = resolveSkills({ bundled: [], project: [stored("cotizar", "", "project one")], personal: [stored("cotizar", "", "mine")] });
    expect(set.get("cotizar")?.scope).toBe("personal");
    expect(set.get("cotizar")?.skill.description).toBe("mine");
    expect(set.all.length).toBe(1);
  });

  it("a user skill cannot take a bundled name", () => {
    const set = resolveSkills({ bundled: [bundled("office-xlsx")], project: [stored("office-xlsx")], personal: [] });
    expect(set.get("office-xlsx")?.scope).toBe("bundled");
    expect(set.refused).toEqual([expect.objectContaining({ name: "office-xlsx", scope: "project", reason: "reserved" })]);
  });

  it("an invalid stored skill is refused, not thrown", () => {
    const set = resolveSkills({ bundled: [], project: [{ name: "rota", text: "no frontmatter", updatedAt: new Date(0) }], personal: [] });
    expect(set.all).toEqual([]);
    expect(set.refused[0]).toEqual(expect.objectContaining({ name: "rota", reason: "invalid" }));
  });

  it("modelInvocable and userInvocable apply the four policies", () => {
    const set = resolveSkills({
      bundled: [],
      project: [
        stored("both"),
        stored("model-only", "user-invocable: false\n"),
        stored("user-only", "disable-model-invocation: true\n"),
        stored("neither", "disable-model-invocation: true\nuser-invocable: false\n"),
      ],
      personal: [],
    });
    expect(set.modelInvocable().map((s) => s.skill.name)).toEqual(["both", "model-only"]);
    expect(set.userInvocable().map((s) => s.skill.name)).toEqual(["both", "user-only"]);
  });

  it("all is sorted by name", () => {
    const set = resolveSkills({ bundled: [bundled("office")], project: [stored("zeta"), stored("alfa")], personal: [stored("medio")] });
    expect(set.all.map((s) => s.skill.name)).toEqual(["alfa", "medio", "office", "zeta"]);
  });

  it("baseDir is the skill's folder", () => {
    const set = resolveSkills({ bundled: [bundled("office-xlsx")], project: [stored("cotizar")], personal: [stored("mia")] });
    expect(set.get("office-xlsx")?.baseDir).toBe("/.openlen/skills/office-xlsx");
    expect(set.get("cotizar")?.baseDir).toBe("/.len/skills/cotizar");
    expect(set.get("mia")?.baseDir).toBe("/home/user/.len/skills/mia");
  });
});
