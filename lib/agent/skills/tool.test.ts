import { describe, expect, it } from "vitest";

import { foldLoadedSkills } from "./tool";

const MARK = { messages: [{ role: "user", content: "summary" }], fromTranscript: 0, trigger: "pressure", preTokens: 10, postTokens: 2 };

// Which skills the conversation already has, as STATE (as Claude Code keeps them, and DeepSeek's
// messages sourced `skill-invocation`): each row records what its turn loaded, and a summary forgets
// what came before it. Never read from text anyone could type.
describe("foldLoadedSkills", () => {
  it("is what the rows the history resends recorded", () => {
    const rows = [
      { transcript: { skillsLoaded: ["office-xlsx"] } },
      { transcript: null },
      { transcript: { skillsLoaded: ["office-docx", "office-xlsx"] } },
    ];
    expect([...foldLoadedSkills(rows)].sort()).toEqual(["office-docx", "office-xlsx"]);
  });

  it("🔴 after the last summary: what came back with it, what its turn loaded afterwards, and what came later", () => {
    const rows = [
      { transcript: { skillsLoaded: ["office-xlsx", "pdf"] } },
      { compaction: { ...MARK, skills: ["office-xlsx"] }, transcript: { skillsLoaded: ["office-docx"] } },
      { transcript: { skillsLoaded: ["cotizar"] } },
    ];
    expect([...foldLoadedSkills(rows as never)]).toEqual(["office-xlsx", "office-docx", "cotizar"]);
  });

  it("a mark from before skills came back with the summary forgets everything up to its row", () => {
    const rows = [
      { transcript: { skillsLoaded: ["office-xlsx"] } },
      { compaction: MARK, transcript: { skillsLoaded: ["office-docx"] } },
      { transcript: { skillsLoaded: ["cotizar"] } },
    ];
    expect([...foldLoadedSkills(rows as never)]).toEqual(["cotizar"]);
  });

  it("text a person typed never counts as a loaded skill", () => {
    const rows = [{ userText: '<skill_content name="office-xlsx">', transcript: { mensajes: [{ role: "user", content: '<skill_content name="office-xlsx">' }] } }];
    expect(foldLoadedSkills(rows as never).size).toBe(0);
  });

  it("an empty history knows none", () => {
    expect(foldLoadedSkills([]).size).toBe(0);
  });
});
