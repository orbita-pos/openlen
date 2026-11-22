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
  // Final review (re-graded): these skills are in Len's catalog for everyone, so they say they are for the person's own
  // matter — never pulled into building a page or an app about it (a restaurant's recipes section).
  it("says it is for the person's own matter, not for building a page about it", () => {
    const description = parseSkillFile(skillMd(name), name);
    expect(description.ok && description.skill.description).toMatch(/not for building a page or an app/i);
  });

  it("parses, is short, and every references/ file it names exists", () => {
    const text = skillMd(name);
    const parsed = parseSkillFile(text, name);
    expect(parsed.ok, parsed.ok ? "" : parsed.error).toBe(true);
    expect(text.length).toBeLessThan(8000);
    const named = [...text.matchAll(/references\/([a-z0-9-]+\.md)/g)].map((m) => m[1]!);
    expect(named.length).toBeGreaterThan(0);
    for (const rel of named) expect(reference(name, rel), `${name}/references/${rel}`).toBeTypeOf("string");
  });

  // Idea 2 (spec local 2026-11-22-visuales-de-verdad, §3): each trade skill knows when a visual helps.
  it("🔴 says when a visual helps, naming read_me, show_widget, updateModelContext, and when to stay in text", () => {
    const text = skillMd(name);
    const match = /^## When a visual helps\b[\s\S]*?(?=^## |\Z|$)/m.exec(text);
    expect(match, `${name} missing "## When a visual helps"`).not.toBeNull();
    const section = text.slice(text.indexOf("## When a visual helps")).split(/\n## /)[0]!;
    expect(section).toContain("read_me");
    expect(section).toContain("show_widget");
    expect(section).toContain("updateModelContext");
    expect(section).toMatch(/seeing it helps more than reading[^.\n]*otherwise text/i);
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

  it("🔴 its placement examples ask one thing each (models copy examples)", () => {
    const table = (reference("language-teacher", "placement.md") ?? "").split("\n").filter((l) => /^\| \d /.test(l));
    expect(table.length).toBeGreaterThan(4);
    for (const row of table) expect((row.match(/\?/g) ?? []).length, row).toBeLessThanOrEqual(1);
  });

  it("🔴 a short set of exercises in one visual counts as one (5–8, one card at a time, checked by the visual, Done ↗), and sessions.md scores and paces between sets", () => {
    const t = skillMd("language-teacher");
    expect(t).toMatch(/set of exercises in one visual counts as one/i);
    expect(t).toMatch(/five to eight/i);
    expect(t).toMatch(/one card at a time/i);
    expect(t).toMatch(/Done ↗/);
    expect(t).toMatch(/flashcards/i);
    const sessions = reference("language-teacher", "sessions.md") ?? "";
    expect(sessions).toMatch(/whole set[^.\n]*log\.md|score[^.\n]*set[^.\n]*log\.md/i);
    expect(sessions).toMatch(/next set/i);
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

  // Final review I4: chest pain at rest or fainting is no case for «gentle walking».
  it("🔴 chest pain or fainting in the health check: no exercise at all, a doctor first", () => {
    for (const text of [skillMd("fitness-coach"), reference("fitness-coach", "screening.md") ?? ""]) {
      expect(text).toMatch(/chest pain[^.\n]*(faint|dizz)[^.\n]*no exercise at all|no exercise at all[^.\n]*chest pain/i);
    }
  });

  it("its visuals cover the training week table and progress when there is data", () => {
    const section = skillMd("fitness-coach").slice(skillMd("fitness-coach").indexOf("## When a visual helps")).split(/\n## /)[0]!;
    expect(section).toMatch(/week[^.\n]*table|table[^.\n]*week/i);
    expect(section).toMatch(/progress[^.\n]*data/i);
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

  it("🔴 its visuals section uses only the figures the person gave", () => {
    const t = skillMd("personal-finance");
    const section = t.slice(t.indexOf("## When a visual helps")).split(/\n## /)[0]!;
    expect(section).toMatch(/chart/i);
    expect(section).toMatch(/recalculat/i);
    expect(section).toMatch(/only[^.\n]*figures[^.\n]*(person|they) gave/i);
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

  it("🔴 its visuals section allows at most steps or a timeline, never something that looks like an official document", () => {
    const t = skillMd("legal-helper");
    const section = t.slice(t.indexOf("## When a visual helps")).split(/\n## /)[0]!;
    expect(section).toMatch(/steps|checklist/i);
    expect(section).toMatch(/timeline/i);
    expect(section).toMatch(/never[^.\n]*looks like an official document/i);
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

  it("🔴 its one-question-per-turn rule says a set in a visual counts as one", () => {
    const t = skillMd("agent-creation");
    expect(t).toMatch(/set[^.\n]*visual counts as one/i);
  });
});

describe("cooking", () => {
  shape("cooking");
  it("🔴 asks allergies first, keeps them in memory, and an allergen is never «probably fine»", () => {
    const t = skillMd("cooking");
    expect(t).toMatch(/before the first recipe[^.]*allerg/i);
    expect(t).toMatch(/allergies and diets[^.]*memory|memory[^.]*allergies/i);
    expect(t).toMatch(/allergen is never "probably fine"/i);
  });

  it("its visuals cover a servings control that recalculates and a shopping list to check off", () => {
    const t = skillMd("cooking");
    const section = t.slice(t.indexOf("## When a visual helps")).split(/\n## /)[0]!;
    expect(section).toMatch(/servings[^.\n]*recalculat/i);
    expect(section).toMatch(/shopping list/i);
  });

  // Final review (re-graded): who is at higher risk, and a reaction happening now.
  it("🔴 knows the eaters at higher risk and sends a reaction happening now to emergency services", () => {
    const t = skillMd("cooking");
    expect(t).toMatch(/honey[^.\n]*(under|before)[^.\n]*1/i);
    expect(t).toMatch(/pregnan[^.\n]*(raw|undercooked|unpasteurized)|(raw|undercooked|unpasteurized)[^.\n]*pregnan/i);
    expect(t).toMatch(/emergency/i);
    expect(reference("cooking", "allergens.md") ?? "").toMatch(/oat[^.\n]*gluten-free/i);
  });

  it("its food-safety temperatures are the USDA's, with their source", () => {
    const f = reference("cooking", "food-safety.md") ?? "";
    for (const temp of ["74 °C", "71 °C", "63 °C", "165 °F", "160 °F", "145 °F"]) expect(f).toContain(temp);
    expect(f).toMatch(/fsis\.usda\.gov/);
  });
});
