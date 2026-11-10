import { describe, expect, it } from "vitest";

import { ASK_USER_QUESTION, REQUEST_SECRETS } from "@/lib/agent/ask-user-question";
import { buildFunctionDeclarations } from "@/lib/agent/catalog";
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
  // 🔴 Write and Edit stay (measured 10/11 in a real box: she had neither, and there her memory is read-only to bash, so
  // she could save nothing). Spec §8: «la escribe con Edit o Write»; Claude Code gives a subagent with memory Read, Write
  // and Edit for it. Her session is read-only: both refuse every file but her memory (`escribeSuMemoria`).
  it("inherits Len's tools except what builds; Write and Edit stay, for her memory", () => {
    const got = names(assistantTools(LEN));
    for (const out of ["edit_image", "toggle_module", "draft_reply", CONVERTIR_EN_APP, "publish", "undo_last_change", REQUEST_SECRETS, CREATE_GOAL, ENTER_PLAN_MODE, PROPOSE_ACTION]) {
      expect(got, out).not.toContain(out);
    }
    for (const kept of ["Read", "Glob", "Grep", "bash", "Write", "Edit", "view_page", "use_page", READ_ME, SHOW_WIDGET, PRESENT_TOOL, ASK_USER_QUESTION, ...SCHEDULE_TOOL_NAMES, "mcp__drive__search"]) {
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

// 🔴 PINNED against Len's REAL catalog, a page and an app (the route passes the same builder's output through
// `assistantTools`): when Len gains, renames or loses a tool these lists change on purpose, and the review sees what the
// assistant got or lost — and that what it never has stays out.
describe("assistantTools over Len's real catalog", () => {
  const APP = { catalogo: "2026-11", entrada: "/src/main.tsx" } as const;
  const CAPS = { functionSecrets: true, realTerminal: true, agentTypes: NO_AGENT_TYPES } as const;
  const lenOf = (app: typeof APP | null) => buildFunctionDeclarations({}, CAPS, "len", app);
  const keptOf = (app: typeof APP | null) => names(assistantTools(lenOf(app)));
  const leftOutOf = (app: typeof APP | null) => names(lenOf(app)).filter((n) => !keptOf(app).includes(n));

  it("a page", () => {
    expect(keptOf(null)).toMatchInlineSnapshot(`
      [
        "Read",
        "Edit",
        "Write",
        "view_page",
        "use_page",
        "find_photo",
        "web_search",
        "web_fetch",
        "image_search",
        "todo_write",
        "ask_user_question",
        "read_me",
        "show_widget",
        "skill",
        "present",
        "schedule_create",
        "schedule_list",
        "schedule_delete",
        "schedule_update",
        "session_search",
        "session_event_search",
        "session_event_read",
        "get_visits",
        "list_form_submissions",
        "list_messages",
        "bash",
      ]
    `);
    expect(leftOutOf(null)).toMatchInlineSnapshot(`
      [
        "toggle_module",
        "edit_image",
        "publish",
        "request_secrets",
        "connect_shopify_store",
        "enter_plan_mode",
        "exit_plan_mode",
        "get_goal",
        "create_goal",
        "update_goal",
        "subagent",
        "subagent_fork",
        "send_message",
        "interrupt_agent",
        "list_agents",
        "create_assistant",
        "undo_last_change",
        "convert_to_app",
        "draft_reply",
      ]
    `);
  });

  it("an app", () => {
    expect(keptOf(APP)).toMatchInlineSnapshot(`
      [
        "Read",
        "Edit",
        "Write",
        "view_page",
        "use_page",
        "find_photo",
        "web_search",
        "web_fetch",
        "image_search",
        "todo_write",
        "ask_user_question",
        "read_me",
        "show_widget",
        "skill",
        "present",
        "schedule_create",
        "schedule_list",
        "schedule_delete",
        "schedule_update",
        "session_search",
        "session_event_search",
        "session_event_read",
        "get_visits",
        "list_form_submissions",
        "list_messages",
        "bash",
      ]
    `);
    expect(leftOutOf(APP)).toMatchInlineSnapshot(`
      [
        "toggle_module",
        "edit_image",
        "publish",
        "request_secrets",
        "connect_shopify_store",
        "enter_plan_mode",
        "exit_plan_mode",
        "get_goal",
        "create_goal",
        "update_goal",
        "subagent",
        "subagent_fork",
        "send_message",
        "interrupt_agent",
        "list_agents",
        "create_assistant",
        "undo_last_change",
        "draft_reply",
      ]
    `);
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
  // Final review, Important 2: her memory is in every visitor's prompt (lib/assistants/visitor/definition.ts), and she
  // wasn't told.
  it("🔴 tells her that her memory is also what she knows with the page's visitors, and what to keep out of it", () => {
    const p = assistantSystemPrompt("LEN PROMPT", { name: "Lucía", tone: "friendly" });
    expect(p).toMatch(/MEMORY\.md[^\n]*\n?[^\n]*visitors/);
    expect(p).toMatch(/contact/i);
    expect(p).toMatch(/money/i);
    expect(p).toMatch(/private/i);
  });

  // Phase 4E (measured 10/11): asked what happened with her customers she called the site's tools and said nothing did.
  it("🔴 her body says her conversations with the visitors, and what she noted, are in list_messages", () => {
    const p = assistantSystemPrompt("LEN PROMPT", { name: "Lucía", tone: "friendly" });
    expect(p).toContain("Your conversations with the visitors of your owner's pages, and what you noted for them from each, are in list_messages.");
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
