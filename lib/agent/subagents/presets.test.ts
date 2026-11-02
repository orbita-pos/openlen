import { describe, expect, it } from "vitest";

import {
  DELEGATION_SCOPE_STATEMENT,
  SUBAGENT_PRESETS,
  childSystemPrompt,
  childToolDeclarations,
  isReadOnly,
  omitsLenMd,
  type SubagentPreset,
} from "./presets";

const all = [
  "Read", "Edit", "Write", "Grep", "Glob", "bash", "view_page", "use_page", "skill", "web_search", "publish", "ask_user_question",
  "request_secrets", "present", "show_widget", "undo_last_change", "subagent", "schedule_create", "enter_plan_mode", "create_goal",
  "edit_image", "toggle_module", "convert_to_app", "draft_reply", "create_artifact", "list_artifacts",
].map((name) => ({ name }));
const names = (p: SubagentPreset, plan = false) => childToolDeclarations(all, p, plan).map((d) => d.name);

describe("the three subagent types (Claude Code's) and what each child gets", () => {
  it("no child has the tools that talk to the user or change the session", () => {
    for (const p of SUBAGENT_PRESETS) {
      for (const gone of ["publish", "ask_user_question", "request_secrets", "present", "show_widget", "undo_last_change", "subagent", "schedule_create", "enter_plan_mode", "create_goal"]) {
        expect(names(p)).not.toContain(gone);
      }
    }
  });

  it("general-purpose writes and loads skills", () => {
    expect(names("general-purpose")).toEqual(expect.arrayContaining(["Edit", "Write", "bash", "skill", "edit_image"]));
  });

  it("Explore and Plan read, use the terminal and load skills, but write nothing", () => {
    for (const p of ["Explore", "Plan"] as const) {
      for (const w of ["Edit", "Write", "edit_image", "toggle_module", "convert_to_app", "draft_reply", "create_artifact"]) expect(names(p)).not.toContain(w);
      expect(names(p)).toEqual(expect.arrayContaining(["Read", "Grep", "bash", "skill", "view_page", "list_artifacts"]));
    }
  });

  it("in plan mode general-purpose writes nothing either (the child keeps its parent's mode)", () => {
    expect(names("general-purpose", true)).not.toContain("Write");
    expect(isReadOnly("general-purpose", true)).toBe(true);
    expect(isReadOnly("general-purpose", false)).toBe(false);
    expect(isReadOnly("Explore", false)).toBe(true);
  });

  it("Explore and Plan go without LEN.md, like Claude Code's without CLAUDE.md", () => {
    expect(omitsLenMd("Explore")).toBe(true);
    expect(omitsLenMd("Plan")).toBe(true);
    expect(omitsLenMd("general-purpose")).toBe(false);
  });

  it("the child's prompt is Len's without the delegation line, then its type, then DeepSeek's scope statement", () => {
    const guidance = "Start independent delegations with `subagent` together…";
    const sys = childSystemPrompt(`You are Len.\n- ${guidance}\n- Another rule.`, "Explore", guidance);
    expect(sys).not.toContain("Start independent delegations");
    expect(sys).toContain("You are Len.\n- Another rule.");
    expect(sys.endsWith(DELEGATION_SCOPE_STATEMENT)).toBe(true);
    expect(DELEGATION_SCOPE_STATEMENT).toBe(
      "You are a delegated subagent: your permission scope was fixed when you were started and cannot be widened from inside this session — operations that require approval are rejected automatically. When the job needs access beyond that scope, do not retry the denied operation; state the limitation in your reply so the delegating agent can handle it.",
    );
  });

  it("each type has its own section", () => {
    const g = childSystemPrompt("P", "general-purpose", "x");
    const e = childSystemPrompt("P", "Explore", "x");
    const pl = childSystemPrompt("P", "Plan", "x");
    expect(new Set([g, e, pl]).size).toBe(3);
  });
});
