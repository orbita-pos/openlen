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

  // THE IDLE SUMMARY (final review, finding 2): nothing comes back behind a summary written while idle, so its
  // mark names no skills and the row's own loads are forgotten with the rest: `skill` gives them whole again.
  it("a summary written while idle forgets what its row had loaded", () => {
    const idle = { messages: [{ role: "user", content: "<compacted-summary>\ns\n</compacted-summary>" }], fromTranscript: 1, trigger: "idle", preTokens: 9, postTokens: 3 };
    const rows = [{ transcript: { skillsLoaded: ["pdf"] } }, { compaction: idle, transcript: { skillsLoaded: ["game-development"] } }, { transcript: { skillsLoaded: ["cotizar"] } }];
    expect([...foldLoadedSkills(rows as never)]).toEqual(["cotizar"]);
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

// The skill tool delegates forked instructions instead of appending them to Len's own conversation.
describe("forked skills", () => {
  async function fixture(agent = "reviewer") {
    const { resolveSkills } = await import("./registry");
    const { toolSkill } = await import("./tool");
    const skills = resolveSkills({ bundled: [], project: [{ name: "summarize", text: `---\nname: summarize\ndescription: Summarizes\ncontext: fork\nagent: ${agent}\n---\nFULL SKILL BODY.`, updatedAt: new Date(0) }], personal: [] });
    const session = { skills, loadedSkills: new Set<string>() } as import("@/lib/agent/tools").AgentSession;
    const calls: unknown[] = [];
    const deps = { subagents: { typeNames: () => ["general-purpose", "reviewer"], launch: async (o: unknown) => { calls.push(o); return { ok: true, id: "r1" }; } } } as unknown as import("@/lib/agent/tools").AgentDeps;
    return { session, deps, calls, invoke: (args: Record<string, unknown> = {}) => toolSkill(session, { name: "summarize", ...args }, deps) };
  }
  it("starts a child with the task and full skill, returns its card and keeps Len unloaded", async () => {
    const f = await fixture();
    const out = await f.invoke({ args: "Summarize the home." });
    expect(f.calls).toMatchObject([{ preset: "reviewer", description: "summarize", fromSkill: "summarize", prompt: expect.stringContaining('Summarize the home.\n\n<skill_content name="summarize">') }]);
    expect(JSON.stringify(f.calls)).toContain("FULL SKILL BODY.");
    expect(out.response).toEqual({ ok: true, tool_result: 'Skill "summarize" started in subagent r1; its result arrives as a notice.' });
    expect(out.subagent).toEqual({ id: "r1", preset: "reviewer" });
    expect(out.action).toMatchObject({ tool: "skill", summary: "summarize" });
    expect(f.session.loadedSkills!.size).toBe(0);
  });
  it("refuses an unknown type before launching anything", async () => {
    const f = await fixture("unknown");
    expect((await f.invoke()).response).toMatchObject({ ok: false, message: "agent_preset must be one of: general-purpose, reviewer" });
    expect(f.calls).toEqual([]);
  });
  it("passes through the launcher's refusal", async () => {
    const f = await fixture();
    f.deps.subagents!.launch = async () => ({ ok: false, code: "no_tools", message: "No tools." });
    expect((await f.invoke()).response).toEqual({ ok: false, error: "no_tools", message: "No tools." });
  });
  it("refuses its own running skill, while other children load it inline", async () => {
    const f = await fixture();
    const { toolSkill } = await import("./tool");
    const own = { ...f.session, runningSkill: "summarize" };
    expect((await toolSkill(own, { name: "summarize" })).response).toEqual({ ok: false, error: "You are the subagent already running this skill: follow its instructions above instead of starting it again." });
    expect((await toolSkill(f.session, { name: "summarize" })).response.tool_result).toContain("FULL SKILL BODY.");
  });
  it("loads inline with the subagent switch off", async () => {
    const f = await fixture();
    const previous = process.env.OPENLEN_SUBAGENTS;
    process.env.OPENLEN_SUBAGENTS = "0";
    try { expect((await f.invoke()).response.tool_result).toContain("FULL SKILL BODY."); expect(f.calls).toEqual([]); }
    finally { if (previous === undefined) delete process.env.OPENLEN_SUBAGENTS; else process.env.OPENLEN_SUBAGENTS = previous; }
  });

  it("refreshes a fork skill's type before validation", async () => {
    const f = await fixture();
    const names = ["general-purpose"];
    Object.assign(f.deps.subagents!, { typeNames: () => names, refreshTypes: async () => { names.push("reviewer"); } });
    expect((await f.invoke()).response.ok).toBe(true);
    expect(f.calls).toHaveLength(1);
  });
});

// A SKILL LOADED AGAIN, as Claude Code does it: it compares the CONTENT the model already has with the
// content it would send, not the name. The same bytes → «already loaded above; instructions unchanged»;
// different ones → the new text, behind its re-invocation line. Len copied the line and kept only the name, so
// a skill improved mid-conversation (`propose_skills`, `learn`, a Write to /.len/skills) answered «unchanged»
// and Len went on with the old text.
describe("a skill loaded again", () => {
  async function session(body: string) {
    const { resolveSkills } = await import("./registry");
    const skills = resolveSkills({ bundled: [], project: [{ name: "cotizar", text: `---\nname: cotizar\ndescription: Quotes\n---\n${body}`, updatedAt: new Date(0) }], personal: [] });
    return { skills, loadedSkills: new Set<string>() } as import("@/lib/agent/tools").AgentSession;
  }
  const text = (o: { response: Record<string, unknown> }) => String(o.response.tool_result);

  it("the same text: Claude Code's «already loaded above; instructions unchanged»", async () => {
    const { toolSkill } = await import("./tool");
    const s = await session("QUOTE IN PESOS.");
    expect(text(await toolSkill(s, { name: "cotizar" }))).toContain("QUOTE IN PESOS.");
    expect(text(await toolSkill(s, { name: "cotizar" }))).toBe("Skill /cotizar is already loaded above; instructions unchanged.");
  });

  it("🔴 an improved skill: its new text, behind Claude Code's re-invocation line; then «unchanged» again", async () => {
    const { toolSkill } = await import("./tool");
    const s = await session("QUOTE IN PESOS.");
    await toolSkill(s, { name: "cotizar" });
    s.skills = (await session("QUOTE IN DOLLARS.")).skills;
    const again = text(await toolSkill(s, { name: "cotizar" }));
    expect(again.startsWith("(Re-invocation of /cotizar \u2014 the skill instructions were previously loaded; the arguments or dynamic output below are new.)\n\n")).toBe(true);
    expect(again).toContain("QUOTE IN DOLLARS.");
    expect(again).not.toContain("QUOTE IN PESOS.");
    expect(text(await toolSkill(s, { name: "cotizar" }))).toBe("Skill /cotizar is already loaded above; instructions unchanged.");
  });

  it("a copy whose content was never recorded (a row from before) is taken as unchanged, as before", async () => {
    const { toolSkill } = await import("./tool");
    const s = await session("QUOTE IN DOLLARS.");
    s.loadedSkills!.add("cotizar");
    expect(text(await toolSkill(s, { name: "cotizar" }))).toBe("Skill /cotizar is already loaded above; instructions unchanged.");
  });

  it("the rows the history resends say what each copy was: the latest since the last summary wins", async () => {
    const { foldSkillDigests } = await import("./tool");
    const rows = [
      { transcript: { skillsLoaded: ["pdf"], skillDigests: { pdf: "a" } } },
      { compaction: MARK, transcript: { skillsLoaded: ["cotizar"], skillDigests: { cotizar: "b" } } },
      { transcript: { skillDigests: { cotizar: "c" } } },
      { transcript: null },
    ];
    expect(Object.fromEntries(foldSkillDigests(rows as never))).toEqual({ cotizar: "c" });
  });

  it("a turn saves only the copies it gave: a new skill or a changed one", async () => {
    const { skillDigestsToSave } = await import("./tool");
    const known = new Map([["pdf", "a"], ["cotizar", "b"]]);
    expect(skillDigestsToSave(new Map([["pdf", "a"], ["cotizar", "c"], ["office", "d"]]), known)).toEqual({ skillDigests: { cotizar: "c", office: "d" } });
    expect(skillDigestsToSave(new Map(known), known)).toEqual({});
    expect(skillDigestsToSave(undefined, known)).toEqual({});
  });
});
