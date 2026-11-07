import { describe, expect, it } from "vitest";

import { ASK_USER_QUESTION, REQUEST_SECRETS } from "@/lib/agent/ask-user-question";
import { CONVERTIR_EN_APP } from "@/lib/agent/convertir-en-app";
import { CREATE_GOAL } from "@/lib/agent/goal-tools";
import { ENTER_PLAN_MODE } from "@/lib/agent/plan-mode";
import { SCHEDULE_TOOL_NAMES } from "@/lib/agent/schedule-tools";
import { PRESENT_TOOL } from "@/lib/agent/skills/present";
import { SUBAGENT_TOOL } from "@/lib/agent/subagents/enabled";
import { SUBAGENT_GUIDANCE } from "@/lib/agent/subagents/tool";
import { HIDDEN_AGENT_TYPES, RESERVED_AGENT_TYPES } from "@/lib/agent/subagents/agent-paths";
import { NO_AGENT_TYPES } from "@/lib/agent/subagents/agent-registry";
import { ASSISTANT_AGENT_TYPE } from "@/lib/agent/subagents/bundled-types";
import { READ_ME, SHOW_WIDGET } from "@/lib/agent/visuals/widget";
import { PROPOSE_ACTION } from "@/lib/tools/cards/types";

import { assistantSystemPrompt, assistantTools } from "./agent";

const LEN = [
  "Read", "Glob", "Grep", "bash", "view_page", "use_page", "Write", "Edit", "edit_image", "toggle_module", "draft_reply",
  CONVERTIR_EN_APP, "publish", "undo_last_change", REQUEST_SECRETS, CREATE_GOAL, ENTER_PLAN_MODE, PROPOSE_ACTION,
  READ_ME, SHOW_WIDGET, PRESENT_TOOL, ASK_USER_QUESTION, SUBAGENT_TOOL, ...SCHEDULE_TOOL_NAMES, "mcp__drive__search",
].map((name) => ({ name, description: name }));

const names = (decls: readonly Record<string, unknown>[]) => decls.map((d) => String(d.name));

describe("assistantTools", () => {
  it("inherits Len's tools except what builds", () => {
    const got = names(assistantTools(LEN));
    for (const out of ["Write", "Edit", "edit_image", "toggle_module", "draft_reply", CONVERTIR_EN_APP, "publish", "undo_last_change", REQUEST_SECRETS, CREATE_GOAL, ENTER_PLAN_MODE, PROPOSE_ACTION]) {
      expect(got, out).not.toContain(out);
    }
    for (const kept of ["Read", "Glob", "Grep", "bash", "view_page", "use_page", READ_ME, SHOW_WIDGET, PRESENT_TOOL, ASK_USER_QUESTION, ...SCHEDULE_TOOL_NAMES, "mcp__drive__search"]) {
      expect(got, kept).toContain(kept);
    }
  });

  it("launches no subagents in phase 1: their notices would wake Len in the project chat", () => {
    expect(names(assistantTools(LEN))).not.toContain(SUBAGENT_TOOL);
  });

  it("gets a tool Len gains tomorrow without touching its definition", () => {
    expect(names(assistantTools([...LEN, { name: "brand_new_tool" }]))).toContain("brand_new_tool");
  });

  it("keeps Len's order, so the cached prefix of the tools is Len's minus some", () => {
    const got = names(assistantTools(LEN));
    expect(got).toEqual(names(LEN).filter((n) => got.includes(n)));
  });
});

describe("assistantSystemPrompt", () => {
  it("puts its name, tone and memory after Len's prompt, and is not a subagent", () => {
    const p = assistantSystemPrompt("LEN PROMPT", { name: "Lucía", tone: "friendly" });
    expect(p.startsWith("LEN PROMPT\n\n")).toBe(true);
    expect(p).toContain("Your name is Lucía");
    expect(p).toContain("warm and friendly");
    expect(p).toContain("~/.assistant/MEMORY.md");
    expect(p).not.toContain("delegated subagent");
  });
  it("drops Len's subagent guidance: it has no subagent tools to follow it with", () => {
    const p = assistantSystemPrompt(`LEN PROMPT\n- ${SUBAGENT_GUIDANCE}\n- another rule`, { name: "Lucía", tone: "friendly" });
    expect(p).not.toContain(SUBAGENT_GUIDANCE);
    expect(p).toContain("- another rule");
  });

  it("says each tone", () => {
    expect(assistantSystemPrompt("L", { name: "A", tone: "formal" })).toContain("formal and polite");
    expect(assistantSystemPrompt("L", { name: "A", tone: "playful" })).toContain("playful and light");
  });
});

describe("the assistant type", () => {
  it("is hidden from Len's subagent list and reserved", () => {
    expect(ASSISTANT_AGENT_TYPE.name).toBe("assistant");
    expect(NO_AGENT_TYPES.names()).not.toContain("assistant");
    expect(HIDDEN_AGENT_TYPES.has("assistant")).toBe(true);
    expect(RESERVED_AGENT_TYPES.has("assistant")).toBe(true);
  });
});
