import { describe, expect, it } from "vitest";

import { SKILL_BODY_MAX, parseSkillFile } from "./skill-file";
import { skillsEnabled } from "./enabled";

const file = (front: string, body = "# Body") => `---\n${front}\n---\n\n${body}\n`;

describe("parseSkillFile", () => {
  it("parses name, description and body", () => {
    const r = parseSkillFile(file("name: office-xlsx\ndescription: Read Excel."), "office-xlsx");
    expect(r).toEqual({ ok: true, skill: { name: "office-xlsx", description: "Read Excel.", modelInvocable: true, userInvocable: true, body: "# Body" } });
  });

  it("parses CRLF, BOM and quoted values", () => {
    const text = `﻿${file('name: office-xlsx\ndescription: "Read: Excel."')}`.replace(/\n/g, "\r\n");
    const r = parseSkillFile(text, "office-xlsx");
    expect(r.ok && r.skill.description).toBe("Read: Excel.");
    expect(r.ok && r.skill.body).toBe("# Body");
  });

  it("appends when_to_use to the description", () => {
    const r = parseSkillFile(file("name: cotizar\ndescription: How I quote.\nwhen_to_use: When asked for a price."), "cotizar");
    expect(r.ok && r.skill.description).toBe("How I quote. When asked for a price.");
  });

  it("accepts the boolean spellings", () => {
    for (const v of ["true", "yes", "on", "1", "True"]) {
      const r = parseSkillFile(file(`name: x\ndescription: d\ndisable-model-invocation: ${v}`), "x");
      expect(r.ok && r.skill.modelInvocable, v).toBe(false);
    }
    const r = parseSkillFile(file("name: x\ndescription: d\nuser-invocable: no"), "x");
    expect(r.ok && r.skill.userInvocable).toBe(false);
  });

  it("drops the skill when an invocation key is not a boolean", () => {
    expect(parseSkillFile(file("name: x\ndescription: d\ndisable-model-invocation: maybe"), "x").ok).toBe(false);
  });

  it("rejects a name that is not kebab-case or does not match the folder", () => {
    const wrong = parseSkillFile(file("name: b\ndescription: d"), "a");
    expect(wrong.ok).toBe(false);
    expect(!wrong.ok && wrong.error).toContain('"a"');
    expect(parseSkillFile(file("name: Office_XLSX\ndescription: d"), null).ok).toBe(false);
  });

  it("ignores unknown Claude Code keys", () => {
    expect(parseSkillFile(file("name: x\ndescription: d\nallowed-tools: Bash"), "x").ok).toBe(true);
  });

  it("rejects a skill without a description or a body", () => {
    expect(parseSkillFile(file("name: x"), "x").ok).toBe(false);
    expect(parseSkillFile(file("name: x\ndescription: d", ""), "x").ok).toBe(false);
  });

  it("rejects a credential in the skill", () => {
    const r = parseSkillFile(file("name: x\ndescription: d", `use ghp_${"a".repeat(36)}`), "x");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("GitHub token");
  });

  it("rejects a body over SKILL_BODY_MAX", () => {
    expect(parseSkillFile(file("name: x\ndescription: d", "a".repeat(SKILL_BODY_MAX + 1)), "x").ok).toBe(false);
  });
});

describe("skillsEnabled", () => {
  it("is off only with OPENLEN_SKILLS=0", () => {
    expect(skillsEnabled({})).toBe(true);
    expect(skillsEnabled({ OPENLEN_SKILLS: "1" })).toBe(true);
    expect(skillsEnabled({ OPENLEN_SKILLS: "0" })).toBe(false);
  });
});
