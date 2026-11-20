// THE JOB SKILLS (spec local 2026-11-19-agentes-para-todos, §6.5): what an agent of the person's knows of its job. Each one
// parses, keeps its SKILL.md short with the rest in references/ that exist, and carries the lines that keep it inside
// its job — a job agent never plays the lawyer, the adviser, the doctor (spec §3, anti-objectives).
import { describe, expect, it } from "vitest";

import { bundledSkillFiles } from "./bundled";
import { parseSkillFile } from "./skill-file";

const FILES = bundledSkillFiles();
const skillMd = (name: string) => FILES[`/.openlen/skills/${name}/SKILL.md`] ?? "";
const reference = (name: string, rel: string) => FILES[`/.openlen/skills/${name}/references/${rel}`];

function shape(name: string) {
  it("parses, is short, and every references/ file it names exists", () => {
    const text = skillMd(name);
    const parsed = parseSkillFile(text, name);
    expect(parsed.ok, parsed.ok ? "" : parsed.error).toBe(true);
    expect(text.length).toBeLessThan(8000);
    const named = [...text.matchAll(/references\/([a-z0-9-]+\.md)/g)].map((m) => m[1]!);
    expect(named.length).toBeGreaterThan(0);
    for (const rel of named) expect(reference(name, rel), `${name}/references/${rel}`).toBeTypeOf("string");
  });
}

describe("language-teacher", () => {
  shape("language-teacher");
  it("🔴 asks one question per turn (the real turn of 20/11 asked two), and its level is an estimate", () => {
    const t = skillMd("language-teacher");
    expect(t).toMatch(/one question (per turn|at a time)/i);
    expect(t).toMatch(/never two/i);
    expect(t).toMatch(/estimate, not a certificate/i);
  });
});

describe("fitness-coach", () => {
  shape("fitness-coach");
  it("🔴 screens before any plan, stops on pain, and is not a medical professional", () => {
    const t = skillMd("fitness-coach");
    for (const sign of [/chest pain/i, /dizz/i, /pregnan/i, /injur/i, /surgery/i, /heart/i]) expect(t).toMatch(sign);
    expect(t).toMatch(/doctor/i);
    expect(t).toMatch(/stop[^.\n]*pain|pain[^.\n]*stop/i);
    expect(t).toMatch(/not a (doctor|medical professional|physiotherapist)/i);
  });
});

describe("personal-finance", () => {
  shape("personal-finance");
  it("🔴 never picks a security or product, is no licensed adviser, and marks what it didn't check", () => {
    const t = skillMd("personal-finance");
    expect(t).toMatch(/never recommend[^.\n]*(specific|particular)[^.\n]*(stock|security|fund|product|crypto)/i);
    expect(t).toMatch(/not a licensed/i);
    expect(t).toMatch(/\[VERIFY/);
    expect(t).toMatch(/tax[^.\n]*country|country[^.\n]*tax/i);
    expect(t).toMatch(/starting balance|what (they|the person) (has|have) now/i);
  });
});

describe("legal-helper", () => {
  shape("legal-helper");
  it("🔴 is no lawyer, asks the country first, flags deadlines at once, and sends high stakes to a lawyer", () => {
    const t = skillMd("legal-helper");
    expect(t).toMatch(/not a lawyer/i);
    expect(t).toMatch(/country/i);
    expect(t).toMatch(/deadline/i);
    for (const stake of [/eviction/i, /court/i, /criminal/i, /immigration/i]) expect(t).toMatch(stake);
    expect(t).toMatch(/\[VERIFY/);
    expect(t).toMatch(/Urgent/);
  });
});

// Len makes the agents (spec §6.3, §6.6): the five buttons map to their skills; any other job gets a skill Len writes and
// proposes on the card before the agent's file names it.
describe("agent-creation", () => {
  it("🔴 gives each of the five jobs its skill", () => {
    const t = skillMd("agent-creation");
    for (const [job, skill] of [
      [/language/i, "language-teacher"],
      [/fitness|training|coach/i, "fitness-coach"],
      [/money|finance|budget/i, "personal-finance"],
      [/legal|lease|contract/i, "legal-helper"],
      [/cook|recipe|meal/i, "cooking"],
    ] as const) {
      const line = t.split("\n").find((l) => l.includes(`\`${skill}\``)) ?? "";
      expect(line, skill).toMatch(job);
    }
  });

  it("🔴 for any other job, proposes its skill with propose_skills before writing the agent's file", () => {
    const t = skillMd("agent-creation");
    expect(t).toContain("propose_skills");
    expect(t.indexOf("propose_skills")).toBeLessThan(t.indexOf("## 3. Write the file"));
    expect(t).toMatch(/card/i);
  });
});

describe("cooking", () => {
  shape("cooking");
  it("🔴 asks allergies first, keeps them in memory, and an allergen is never «probably fine»", () => {
    const t = skillMd("cooking");
    expect(t).toMatch(/allerg/i);
    expect(t).toMatch(/memory/i);
    expect(t).toMatch(/probably fine/i);
  });

  it("its food-safety temperatures are the USDA's, with their source", () => {
    const f = reference("cooking", "food-safety.md") ?? "";
    for (const temp of ["74 °C", "71 °C", "63 °C", "165 °F", "160 °F", "145 °F"]) expect(f).toContain(temp);
    expect(f).toMatch(/fsis\.usda\.gov/);
  });
});
