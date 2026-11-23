import { describe, expect, it } from "vitest";

import {
  DELEGATION_SCOPE_STATEMENT,
  SUBAGENT_PRESETS,
  childSystemPrompt,
  childToolDeclarations,
  OUT_FOR_READ_ONLY,
  isReadOnly,
  omitsLenMd,
  type SubagentPreset,
} from "./presets";

const all = [
  "Read", "Edit", "MultiEdit", "Write", "Grep", "Glob", "bash", "view_page", "use_page", "skill", "web_search", "publish", "ask_user_question",
  "request_secrets", "present", "show_widget", "undo_last_change", "subagent", "schedule_create", "enter_plan_mode", "create_goal",
  "edit_image", "toggle_module", "convert_to_app", "draft_reply", "create_deliverable", "list_deliverables",
  "send_message", "subagent_fork", "interrupt_agent", "list_agents", "propose_action", "mcp__empleados__add_employee",
  "suggest_connectors", "mcp__cal__authenticate", "mcp__cal__list_events", "propose_skills", "message_agent", "read_widget_context",
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

  // TOOLS MADE BY LEN, PHASE 4 (spec local 2026-11-04-herramientas-hechas-por-len, §4.7; plan decision 4): an installed
  // tool's operations write the person's production — the main turn only, never a child (Explore and Plan are read-only).
  it("no child, of any type or a custom one, gets an installed tool's operations", () => {
    for (const p of SUBAGENT_PRESETS) expect(names(p).filter((n) => String(n).startsWith("mcp__"))).toEqual([]);
  });

  // What the visuals shared rides with the person's message to the main turn (spec local 2026-11-22-visuales-de-verdad): a
  // child has no visual of its own and no state to read.
  it("no child reads what the visuals shared", () => {
    for (const p of SUBAGENT_PRESETS) expect(names(p)).not.toContain("read_widget_context");
  });

  it("no child proposes a «Crear» card (DeepSeek: «Cards are offered in the main conversation only»)", () => {
    for (const p of SUBAGENT_PRESETS) expect(names(p)).not.toContain("propose_action");
  });

  // The person is shown a Connect card (spec local 2026-11-17-oauth-de-conectores-mcp, §5.5, §6), and a child's events
  // never reach the person: a child told «the person is shown a card» would say so to nobody.
  it("🔴 no child offers a connector or signs in to one: suggest_connectors and mcp__<server>__authenticate are the main conversation's", async () => {
    const { SUGGEST_CONNECTORS_TOOL } = await import("@/lib/mcp-connectors/tool-names");
    expect(SUGGEST_CONNECTORS_TOOL).toBe("suggest_connectors");
    for (const p of SUBAGENT_PRESETS) {
      for (const plan of [false, true]) {
        expect(names(p, plan)).not.toContain(SUGGEST_CONNECTORS_TOOL);
        expect(names(p, plan)).not.toContain("mcp__cal__authenticate");
      }
    }
  });

  // Final review I2 (spec local 2026-11-19-agentes-para-todos, §6.6): the review card of the person's skills is drawn under
  // the main conversation's answer; a child told «shown to the person» would send Len to tell them of a card that isn't there.
  it("🔴 no child proposes skills: propose_skills is the main conversation's", () => {
    for (const p of SUBAGENT_PRESETS) {
      for (const plan of [false, true]) expect(names(p, plan)).not.toContain("propose_skills");
    }
  });

  // Len and the agent talk (spec local 2026-11-21-len-y-el-agente-conversan): a message to the person's agent wakes it, and
  // its answer wakes Len in the project's chat — never the child that wrote. Only the main conversation writes to it.
  it("🔴 no child writes to the person's agents: message_agent is the main conversation's", async () => {
    const { MESSAGE_AGENT } = await import("@/lib/assistants/messages/tool");
    expect(MESSAGE_AGENT).toBe("message_agent");
    for (const p of SUBAGENT_PRESETS) {
      for (const plan of [false, true]) expect(names(p, plan)).not.toContain(MESSAGE_AGENT);
    }
  });

  it("children keep send_message (to Len) and lose subagent_fork, interrupt_agent and list_agents (depth 1)", () => {
    for (const p of SUBAGENT_PRESETS) {
      expect(names(p)).toContain("send_message");
      for (const gone of ["subagent_fork", "interrupt_agent", "list_agents"]) expect(names(p)).not.toContain(gone);
    }
  });

  it("general-purpose writes and loads skills", () => {
    expect(names("general-purpose")).toEqual(expect.arrayContaining(["Edit", "MultiEdit", "Write", "bash", "skill", "edit_image"]));
  });

  it("Explore and Plan read, use the terminal and load skills, but write nothing", () => {
    for (const p of ["Explore", "Plan"] as const) {
      for (const w of ["Edit", "MultiEdit", "Write", "edit_image", "toggle_module", "convert_to_app", "draft_reply", "create_deliverable"]) expect(names(p)).not.toContain(w);
      expect(names(p)).toEqual(expect.arrayContaining(["Read", "Grep", "bash", "skill", "view_page", "list_deliverables"]));
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

  it("each type tells the child that Len gets what it sends with send_message and its final message", () => {
    for (const p of SUBAGENT_PRESETS) {
      const prompt = childSystemPrompt("LEN", p, "x");
      expect(prompt).toContain("send_message");
      expect(prompt).not.toMatch(/only your final message reaches Len/i);
    }
  });

  it("each type has its own section", () => {
    const g = childSystemPrompt("P", "general-purpose", "x");
    const e = childSystemPrompt("P", "Explore", "x");
    const pl = childSystemPrompt("P", "Plan", "x");
    expect(new Set([g, e, pl]).size).toBe(3);
  });
});

// Custom definitions obey the same child boundary as the built-in types.
describe("custom child types", () => {
  it("keeps built-in tools and prompts byte for byte", async () => {
    const p = await import("./presets");
    const { NO_AGENT_TYPES } = await import("./agent-registry");
    for (const preset of SUBAGENT_PRESETS) {
      const type = p.childTypeOf(preset, NO_AGENT_TYPES)!;
      expect(p.childToolsFor(all, type, false)).toEqual(childToolDeclarations(all, preset, false));
      expect(p.childSystemPromptFor("LEN", type, "guide")).toBe(childSystemPrompt("LEN", preset, "guide"));
    }
  });
  it("uses its allow-list minus disallowed tools and the universal child restrictions", async () => {
    const p = await import("./presets");
    const { resolveAgentTypes } = await import("./agent-registry");
    const types = resolveAgentTypes({ project: [{ name: "reviewer", text: "---\nname: reviewer\ndescription: Reviews\ntools: Read, Edit, Write, publish, skill\ndisallowedTools: Edit\nomitLenMd: true\n---\nCustom instructions.", updatedAt: new Date(0) }], personal: [] });
    const type = p.childTypeOf("reviewer", types)!;
    expect(p.childToolsFor(all, type, false).map((d) => d.name)).toEqual(["Read", "Write", "skill"]);
    expect(p.childToolsFor(all, type, true).map((d) => d.name)).toEqual(["Read", "skill"]);
    const open = resolveAgentTypes({ project: [{ name: "helper", text: "---\nname: helper\ndescription: Helps\nomitLenMd: true\n---\nHelp.", updatedAt: new Date(0) }], personal: [] });
    const helper = p.childTypeOf("helper", open)!;
    expect(p.childToolsFor(all, helper, false).map((d) => d.name)).not.toContain("suggest_connectors");
    expect(p.childToolsFor(all, helper, false).map((d) => d.name)).not.toContain("mcp__cal__authenticate");
    expect(p.omitsLenMdFor(type)).toBe(true);
    expect(p.isReadOnlyFor(type, false)).toBe(false);
    const prompt = p.childSystemPromptFor("LEN\n- guide", type, "guide");
    expect(prompt).toContain("LEN\n\nSUBAGENT — REVIEWER:\nCustom instructions.");
    expect(prompt.endsWith(DELEGATION_SCOPE_STATEMENT)).toBe(true);
  });
});

// A BUNDLED TYPE THAT ONLY READS (len-review): the server decides, never the prompt. Like Explore and Plan, it loses
// every tool that writes, and its session is read-only, so Write, Edit, git/gh/supabase/stripe writes and what a
// command changes are refused (lib/agent/terminal/read-only-commands.ts).
describe("a bundled read-only type (len-review)", () => {
  const everything = [...OUT_FOR_READ_ONLY, "Read", "Grep", "Glob", "bash", "skill", "send_message", "list_deliverables", "inspect_deliverable"].map((name) => ({ name }));

  it("🔴 is read-only without plan mode, and general-purpose types around it are not", async () => {
    const p = await import("./presets");
    const { NO_AGENT_TYPES } = await import("./agent-registry");
    expect(p.isReadOnlyFor(p.childTypeOf("len-review", NO_AGENT_TYPES)!, false)).toBe(true);
    expect(p.isReadOnlyFor(p.childTypeOf("len-design", NO_AGENT_TYPES)!, false)).toBe(false);
    expect(p.isReadOnlyFor(p.childTypeOf("len-office", NO_AGENT_TYPES)!, false)).toBe(false);
  });

  it("🔴 is not offered any tool that writes (the deliverable writes included), exactly like Explore", async () => {
    const p = await import("./presets");
    const { NO_AGENT_TYPES } = await import("./agent-registry");
    const given = p.childToolsFor(everything, p.childTypeOf("len-review", NO_AGENT_TYPES)!, false).map((d) => d.name);
    for (const out of OUT_FOR_READ_ONLY) expect(given, String(out)).not.toContain(out);
    expect(given).toEqual(expect.arrayContaining(["Read", "Grep", "Glob", "bash", "skill", "send_message", "list_deliverables", "inspect_deliverable"]));
  });

  it("a custom type is read-only only when its own file says so", async () => {
    const p = await import("./presets");
    const { resolveAgentTypes } = await import("./agent-registry");
    const types = resolveAgentTypes({
      project: [
        { name: "auditor", text: "---\nname: auditor\ndescription: Audits\nreadOnly: true\n---\nOnly look.", updatedAt: new Date(0) },
        { name: "builder", text: "---\nname: builder\ndescription: Builds\n---\nBuild it.", updatedAt: new Date(0) },
      ],
      personal: [],
    });
    expect(p.isReadOnlyFor(p.childTypeOf("auditor", types)!, false)).toBe(true);
    expect(p.childToolsFor(everything, p.childTypeOf("auditor", types)!, false).map((d) => d.name)).not.toContain("create_deliverable");
    expect(p.isReadOnlyFor(p.childTypeOf("builder", types)!, false)).toBe(false);
    expect(p.childToolsFor(everything, p.childTypeOf("builder", types)!, false).map((d) => d.name)).toContain("create_deliverable");
  });
});
