import { describe, expect, it } from "vitest";

import { invokedSkillNames, withInvokedSkills } from "./invocation";
import type { ResolvedSkill } from "./registry";
import { skillsLoadedIn } from "./tool";

const USER = new Set(["office-docx", "office-xlsx", "cotizar"]);
const skill = (name: string): ResolvedSkill => ({
  skill: { name, description: `${name} skill`, modelInvocable: true, userInvocable: true, body: `# ${name}\nDo it.` },
  scope: "bundled",
  baseDir: `/.openlen/skills/${name}`,
});

describe("invokedSkillNames", () => {
  it("finds whitespace-bounded slash names", () => {
    expect(invokedSkillNames("/office-docx hazme una carta", USER)).toEqual(["office-docx"]);
    expect(invokedSkillNames("hazme una carta con /office-docx.", USER)).toEqual(["office-docx"]);
    expect(invokedSkillNames("primero\n/cotizar 3 pasteles", USER)).toEqual(["cotizar"]);
  });

  it("ignores slash tokens inside urls, paths and code", () => {
    for (const text of ["https://x.com/office-xlsx", "a/office-xlsx", "usa `/office-xlsx` así", "5/8", "/usr/bin", "/office-xlsx/algo"]) {
      expect(invokedSkillNames(text, USER), text).toEqual([]);
    }
  });

  it("a name that is not a user-invocable skill stays prose", () => {
    expect(invokedSkillNames("/goal y /nada", USER)).toEqual([]);
  });

  it("dedupes, first seen order", () => {
    expect(invokedSkillNames("/office-xlsx y /office-docx y /office-xlsx", USER)).toEqual(["office-xlsx", "office-docx"]);
  });
});

describe("withInvokedSkills", () => {
  it("appends each skill's content after the prompt", () => {
    const text = withInvokedSkills("/office-docx hazme una carta", [skill("office-docx")]);
    expect(text.startsWith("/office-docx hazme una carta\n\n<skill_content name=\"office-docx\">\n")).toBe(true);
    expect(text).toContain("<skill_instructions>\n# office-docx\nDo it.\n</skill_instructions>");
  });

  it("nothing invoked, the prompt as it was", () => {
    expect(withInvokedSkills("hola", [])).toBe("hola");
  });

  it("an invoked skill counts as loaded", () => {
    const text = withInvokedSkills("/office-docx carta", [skill("office-docx")]);
    expect([...skillsLoadedIn([{ content: text }])]).toEqual(["office-docx"]);
  });
});
