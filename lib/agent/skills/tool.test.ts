import { describe, expect, it } from "vitest";

import { skillsLoadedIn } from "./tool";

describe("skillsLoadedIn", () => {
  it("finds the skills a resent history already shows in full", () => {
    const history = [
      { role: "user", content: 'hola\n\n<skill_content name="office-docx">\n<skill_resources>' },
      { role: "assistant", content: "", functionCalls: [{ name: "skill", args: { name: "office-xlsx" } }] },
      { role: "user", content: "", functionResponses: [{ name: "skill", response: { ok: true, tool_result: '<skill_content name="office-xlsx">\n…' } }] },
      { role: "user", content: "", functionResponses: [{ name: "skill", response: { ok: true, tool_result: "Skill /office-pptx is already loaded above; instructions unchanged." } }] },
      { role: "user", content: "", functionResponses: [{ name: "skill", response: { ok: false, error: 'skill "x" is unknown or no longer available' } }] },
    ];
    expect([...skillsLoadedIn(history)].sort()).toEqual(["office-docx", "office-xlsx"]);
  });

  it("an empty history knows none", () => {
    expect(skillsLoadedIn([]).size).toBe(0);
  });
});
