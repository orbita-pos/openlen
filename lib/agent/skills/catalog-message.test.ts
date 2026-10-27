import { describe, expect, it } from "vitest";

import { SKILL_DESCRIPTION_MAX, catalogBudgetChars, catalogDigest, foldSkillsDigest, personalSkillsReminder, skillCatalogMessage } from "./catalog-message";
import type { ResolvedSkill } from "./registry";

const skill = (name: string, description = `${name} skill`): ResolvedSkill => ({
  skill: { name, description, modelInvocable: true, userInvocable: true, body: "Do it." },
  scope: "bundled",
  baseDir: `/.openlen/skills/${name}`,
});
const BIG = 100_000;

describe("skillCatalogMessage", () => {
  it("first catalog is DeepSeek's message", () => {
    const m = skillCatalogMessage([skill("office-xlsx", "Read Excel."), skill("office", "Route office work.")], null, BIG)!;
    expect(m.text).toBe(
      [
        "<system-reminder>",
        "A skill is a reusable set of task-specific instructions. The following skills are available in this session:",
        "",
        "<available_skills>",
        "- `office`: Route office work.",
        "- `office-xlsx`: Read Excel.",
        "</available_skills>",
        "",
        "If the user names a skill, or the task clearly matches a skill's description, call the `skill` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded.",
        "A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.",
        "</system-reminder>",
        "",
      ].join("\n"),
    );
    expect(m.digest).toBe(catalogDigest([skill("office-xlsx", "Read Excel."), skill("office", "Route office work.")]));
  });

  it("same skills, same digest: no message", () => {
    const skills = [skill("office")];
    expect(skillCatalogMessage(skills, catalogDigest(skills), BIG)).toBeNull();
  });

  it("changed skills: DeepSeek's replacement catalog", () => {
    const m = skillCatalogMessage([skill("office"), skill("cotizar")], catalogDigest([skill("office")]), BIG)!;
    expect(m.text.startsWith("<system-reminder>\nThe available skill catalog changed. This complete catalog replaces every earlier available-skills list in this session:\n")).toBe(true);
    expect(m.text).toContain("Use only names in this replacement catalog.");
    expect(m.text).toContain("- `cotizar`: cotizar skill");
  });

  it("all removed: DeepSeek's empty replacement", () => {
    const m = skillCatalogMessage([], catalogDigest([skill("office")]), BIG)!;
    expect(m.text).toContain("No skills are currently available through the `skill` tool. Do not use names from earlier skill catalogs.");
  });

  it("no skills and nothing known: no message", () => {
    expect(skillCatalogMessage([], null, BIG)).toBeNull();
  });

  it("descriptions are capped at 500 and escaped", () => {
    const m = skillCatalogMessage([skill("x", "a".repeat(600)), skill("y", "use <b> & go")], null, BIG)!;
    const line = m.text.split("\n").find((l) => l.startsWith("- `x`: "))!;
    expect(line.slice("- `x`: ".length).length).toBe(SKILL_DESCRIPTION_MAX);
    expect(line.endsWith("...")).toBe(true);
    expect(m.text).toContain("- `y`: use &lt;b&gt; &amp; go");
  });

  it("over budget, descriptions shrink, names stay", () => {
    const many = Array.from({ length: 60 }, (_, i) => skill(`skill-${i}`, "d".repeat(400)));
    const m = skillCatalogMessage(many, null, 2_000)!;
    for (let i = 0; i < 60; i++) expect(m.text).toContain(`- \`skill-${i}\``);
    expect(m.text.length).toBeLessThan(2_000 + 1_200);
  });

  it("byte-identical across calls", () => {
    const skills = [skill("office"), skill("office-xlsx")];
    expect(skillCatalogMessage(skills, null, BIG)!.text).toBe(skillCatalogMessage(skills, null, BIG)!.text);
  });
});

describe("personalSkillsReminder", () => {
  it("lists only the given skills, without the replacement wording", () => {
    const text = personalSkillsReminder([skill("mia", "My way.")], BIG);
    expect(text).toContain("- `mia`: My way.");
    expect(text).not.toContain("replaces");
    expect(text.startsWith("<system-reminder>\n")).toBe(true);
  });

  it("is empty without skills", () => {
    expect(personalSkillsReminder([], BIG)).toBe("");
  });
});

describe("foldSkillsDigest", () => {
  it("is the newest digest the history still carries", () => {
    expect(foldSkillsDigest([{ transcript: { skillsDigest: "a" } }, { transcript: null }, { transcript: { skillsDigest: "b" } }, { transcript: {} }])).toBe("b");
    expect(foldSkillsDigest([{ transcript: null }])).toBeNull();
  });
});

describe("catalogBudgetChars", () => {
  it("is 1% of the context window at 4 characters a token, as Claude Code", () => {
    expect(catalogBudgetChars(200_000)).toBe(8_000);
  });
});
