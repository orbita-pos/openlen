// THE CONTRACT OF `propose_skills` (spec local 2026-11-19-agentes-para-todos, §6.6), as Claude Code 2.1.329's: up to three
// proposals, a new skill with its whole SKILL.md, an improvement of one of the person's own skills with edits on the
// SKILL.md it read, name and description from the fields. Nothing here writes: the card does, when the person saves.
import { describe, expect, it } from "vitest";

import {
  applyEdits,
  checkSkillText,
  MAX_PROPOSALS,
  resolveProposals,
  skillFingerprint,
  type ReadState,
} from "./proposals";
import { MAX_SKILLS_PER_SCOPE } from "./skill-file";

const BODY = "# Plant care\n\nWater when the top two centimetres of soil are dry.";
const fileOf = (name: string, description: string, body = BODY, extra = "") =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n${body}\n`;

const BUNDLED = new Set(["cooking", "language-teacher"]);
const CURRENT = fileOf("plant-care", "Look after the person's plants.");

function ctx(o: { personal?: Record<string, string>; readState?: (name: string) => ReadState } = {}) {
  return {
    personal: new Map(Object.entries(o.personal ?? { "plant-care": CURRENT })),
    bundled: BUNDLED,
    readState: o.readState ?? (() => "read" as const),
  };
}

const newOne = (over: Record<string, unknown> = {}) => ({
  name: "bread-baking",
  kind: "new",
  description: "Bake bread at home with the person, step by step.",
  skillMd: fileOf("bread-baking", "whatever the model put here", "# Bread\n\nKnead ten minutes."),
  ...over,
});

const improvement = (over: Record<string, unknown> = {}) => ({
  name: "plant-care",
  kind: "improvement",
  target: "plant-care",
  description: "Look after the person's plants.",
  edits: [{ old_string: "two centimetres", new_string: "three centimetres" }],
  ...over,
});

const errorOf = (input: unknown, c = ctx()) => {
  const r = resolveProposals(input, c);
  if (r.ok) throw new Error("expected a refusal");
  return r.error;
};

describe("applyEdits", () => {
  it("applies them in order on the running text, with CRLF read as LF", () => {
    const r = applyEdits("a\r\nb\r\nc", [
      { old_string: "b", new_string: "B" },
      { old_string: "B\nc", new_string: "BC" },
    ]);
    expect(r).toEqual({ ok: true, text: "a\nBC" });
  });

  it("says which edit (1-based) misses its text, and whether it was repeated", () => {
    expect(applyEdits("abc", [{ old_string: "a", new_string: "x" }, { old_string: "zz", new_string: "y" }])).toEqual({ ok: false, edit: 2, repeated: false });
    expect(applyEdits("abab", [{ old_string: "ab", new_string: "x" }])).toEqual({ ok: false, edit: 1, repeated: true });
  });
});

describe("skillFingerprint", () => {
  it("is the same for CRLF and LF, and changes with the text", () => {
    expect(skillFingerprint("a\r\nb")).toBe(skillFingerprint("a\nb"));
    expect(skillFingerprint("a\nb")).not.toBe(skillFingerprint("a\nc"));
    expect(skillFingerprint("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("resolveProposals", () => {
  it("🔴 a new skill is saved with the name and description of its fields; other frontmatter keys are not kept", () => {
    const r = resolveProposals({ proposals: [newOne({ skillMd: fileOf("bread-baking", "x", "# Bread\n\nKnead ten minutes.", "when_to_use: always\n") })] }, ctx());
    expect(r).toEqual({
      ok: true,
      proposals: [
        {
          name: "bread-baking",
          kind: "new",
          target: null,
          description: "Bake bread at home with the person, step by step.",
          skillMd: "---\nname: bread-baking\ndescription: Bake bread at home with the person, step by step.\n---\n\n# Bread\n\nKnead ten minutes.\n",
          base: null,
        },
      ],
    });
  });

  it("🔴 an improvement applies its edits to the SKILL.md it read, and keeps the fingerprint of that text as its base", () => {
    const r = resolveProposals({ proposals: [improvement()] }, ctx());
    if (!r.ok) throw new Error(r.error);
    expect(r.proposals[0]!.skillMd).toContain("three centimetres");
    expect(r.proposals[0]!.skillMd).toMatch(/^---\nname: plant-care\ndescription: Look after the person's plants\.\n---\n/);
    expect(r.proposals[0]!.base).toBe(skillFingerprint(CURRENT));
    expect(r.proposals[0]!.target).toBe("plant-care");
  });

  it("an improvement may send the whole SKILL.md instead of edits", () => {
    const r = resolveProposals({ proposals: [improvement({ edits: undefined, skillMd: fileOf("plant-care", "x", "# Plants\n\nNew text.") })] }, ctx());
    if (!r.ok) throw new Error(r.error);
    expect(r.proposals[0]!.skillMd).toContain("New text.");
  });

  it("takes one to three proposals", () => {
    expect(MAX_PROPOSALS).toBe(3);
    expect(errorOf({ proposals: [] })).toMatch(/one to 3/i);
    const four = ["a-one", "a-two", "a-three", "a-four"].map((name) => newOne({ name }));
    expect(errorOf({ proposals: four })).toMatch(/one to 3/i);
    expect(errorOf({})).toMatch(/proposals/);
  });

  it("refuses two proposals with the same name, and an improvement renamed away from its target", () => {
    expect(errorOf({ proposals: [newOne(), newOne()] })).toMatch(/same name/);
    expect(errorOf({ proposals: [improvement({ name: "plants" })] })).toMatch(/keeps the name of its target/);
  });

  it("refuses a name that isn't lowercase words joined by '-', is too long, or names claude or anthropic", () => {
    expect(errorOf({ proposals: [newOne({ name: "Bread Baking" })] })).toMatch(/lowercase/);
    expect(errorOf({ proposals: [newOne({ name: `a${"-b".repeat(40)}` })] })).toMatch(/64/);
    expect(errorOf({ proposals: [newOne({ name: "claude-helper" })] })).toMatch(/claude/);
    expect(errorOf({ proposals: [newOne({ name: "my-anthropic-notes" })] })).toMatch(/anthropic/);
  });

  it("🔴 one of OpenLen's own names is never the person's: a new skill under a name of its own", () => {
    const e = errorOf({ proposals: [newOne({ name: "cooking" })] });
    expect(e).toMatch(/OpenLen's own/);
    expect(e).toMatch(/name of its own/);
    expect(errorOf({ proposals: [improvement({ name: "cooking", target: "cooking" })] })).toMatch(/OpenLen's own/);
  });

  it("🔴 a NEW skill with the name of one the person has is refused: it is an improvement with target", () => {
    expect(errorOf({ proposals: [newOne({ name: "plant-care" })] })).toMatch(/improvement.*target/);
  });

  it("a new skill needs its SKILL.md and takes no edits", () => {
    expect(errorOf({ proposals: [newOne({ skillMd: undefined })] })).toMatch(/skillMd/);
    expect(errorOf({ proposals: [newOne({ edits: [{ old_string: "a", new_string: "b" }] })] })).toMatch(/no edits/);
  });

  it("an improvement needs a target that is one of the person's own skills, and edits or skillMd", () => {
    expect(errorOf({ proposals: [improvement({ target: undefined })] })).toMatch(/target/);
    expect(errorOf({ proposals: [improvement({ name: "orchids", target: "orchids" })] })).toMatch(/your own skills|one of theirs|their own/);
    expect(errorOf({ proposals: [improvement({ edits: undefined })] })).toMatch(/edits or skillMd/);
  });

  it("🔴 an improvement reads the current SKILL.md first, and reads it again if it changed", () => {
    expect(errorOf({ proposals: [improvement()] }, ctx({ readState: () => "unread" }))).toContain("read ~/.len/skills/plant-care/SKILL.md first");
    expect(errorOf({ proposals: [improvement()] }, ctx({ readState: () => "stale" }))).toMatch(/changed since you read it/);
  });

  it("an edit that misses says which one", () => {
    expect(errorOf({ proposals: [improvement({ edits: [{ old_string: "nowhere", new_string: "x" }] })] })).toMatch(/edit 1/);
  });

  it("refuses a description too long, or with angle brackets", () => {
    expect(errorOf({ proposals: [newOne({ description: "x".repeat(1025) })] })).toMatch(/1024/);
    expect(errorOf({ proposals: [newOne({ description: "Use it for <plants>" })] })).toMatch(/angle brackets/);
  });

  it("refuses a SKILL.md with no instructions below its frontmatter", () => {
    expect(errorOf({ proposals: [newOne({ skillMd: "---\nname: bread-baking\ndescription: x\n---\n\n" })] })).toMatch(/no instructions/);
  });

  it("🔴 refuses a skill carrying a credential", () => {
    expect(errorOf({ proposals: [newOne({ skillMd: fileOf("bread-baking", "x", "Use sk-abcdefghijklmnopqrstuvwxyz123456 to order flour.") })] })).toMatch(/API key/);
  });

  it("refuses more new skills than the person may keep", () => {
    const full = Object.fromEntries(Array.from({ length: MAX_SKILLS_PER_SCOPE }, (_, i) => [`s-${i}`, fileOf(`s-${i}`, "x")]));
    expect(errorOf({ proposals: [newOne()] }, ctx({ personal: full }))).toMatch(new RegExp(String(MAX_SKILLS_PER_SCOPE)));
  });
});

describe("checkSkillText", () => {
  it("is null for a skill that can be saved under that name, and says why otherwise", () => {
    expect(checkSkillText("plant-care", CURRENT, BUNDLED)).toBeNull();
    expect(checkSkillText("plant-care", fileOf("other", "x"), BUNDLED)).toMatch(/plant-care/);
    expect(checkSkillText("cooking", fileOf("cooking", "x"), BUNDLED)).toMatch(/OpenLen's own/);
  });
});
