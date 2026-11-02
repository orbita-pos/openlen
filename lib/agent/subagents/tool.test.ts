import { describe, expect, it } from "vitest";

import type { AgentDeps, AgentSession } from "@/lib/agent/tools";
import { isConcurrencySafe } from "@/lib/agent/tool-concurrency";

import {
  INTERRUPT_AGENT_DECLARATION,
  interruptRequestedLine,
  LIST_AGENTS_DECLARATION,
  listAgentsText,
  messageDeliveredLine,
  notYourParentError,
  SEND_MESSAGE_DECLARATION,
  SUBAGENT_DECLARATION,
  SUBAGENT_FORK_DECLARATION,
  SUBAGENT_GUIDANCE,
  toolSubagent,
  unavailableError,
} from "./tool";

const session = { projectId: "p1", userId: "u1", page: null, ownerEmail: null, imageEditsThisTurn: 0, photoSearchesThisTurn: 0, busquedasVaciasSeguidas: 0 } as AgentSession;

function launching() {
  const launched: unknown[] = [];
  const deps = {
    subagents: {
      launch: async (o: unknown) => {
        launched.push(o);
        return { ok: true as const, id: "r1" };
      },
    },
  } as unknown as AgentDeps;
  return { deps, launched };
}

describe("the subagent tool (DeepSeek's)", () => {
  it("starts one and answers with its id at once", async () => {
    const { deps, launched } = launching();
    const out = await toolSubagent(session, deps, { description: "Find the menu", prompt: "Where is the menu defined? Report paths." });
    expect(out.response).toEqual({ ok: true, tool_result: "started subagent r1" });
    expect(out.action).toMatchObject({ tool: "subagent", ok: true, summary: "Find the menu" });
    // Its card names the run, so the chat finds it again after a reload.
    expect(out.subagent).toEqual({ id: "r1", preset: "general-purpose" });
    expect(launched).toEqual([{ description: "Find the menu", prompt: "Where is the menu defined? Report paths.", preset: "general-purpose" }]);
  });

  it("takes a type", async () => {
    const { deps, launched } = launching();
    expect((await toolSubagent(session, deps, { description: "x", prompt: "y", agent_preset: "Explore" })).response.ok).toBe(true);
    expect(launched).toEqual([{ description: "x", prompt: "y", preset: "Explore" }]);
  });

  it("refuses a call without a description or a prompt, or with a type that doesn't exist", async () => {
    const { deps, launched } = launching();
    expect((await toolSubagent(session, deps, { description: "", prompt: "y" })).response).toMatchObject({ ok: false, error: "invalid_arguments" });
    expect((await toolSubagent(session, deps, { description: "x", prompt: "  " })).response).toMatchObject({ ok: false, error: "invalid_arguments" });
    expect((await toolSubagent(session, deps, { description: "x", prompt: "y", agent_preset: "Hacker" })).response).toMatchObject({ ok: false, error: "invalid_arguments" });
    expect(launched).toEqual([]);
  });

  it("says when there is no launcher", async () => {
    expect((await toolSubagent(session, {} as AgentDeps, { description: "x", prompt: "y" })).response).toMatchObject({ ok: false, error: "subagents_disabled" });
  });

  it("passes on the launcher's refusal", async () => {
    const refusing = {
      subagents: { launch: async () => ({ ok: false as const, code: "too_many_subagents" as const, message: "8 subagents are already running in this project; wait for one to finish." }) },
    } as unknown as AgentDeps;
    expect((await toolSubagent(session, refusing, { description: "x", prompt: "y" })).response).toEqual({
      ok: false,
      error: "too_many_subagents",
      message: "8 subagents are already running in this project; wait for one to finish.",
    });
  });

  it("its description is DeepSeek's (a continuable child), then the types, then our two sentences", () => {
    const d = String(SUBAGENT_DECLARATION.description);
    expect(d).toMatch(/^Delegate a self-contained task to a subagent \(a separate agent that works in its own context\)/);
    expect(d).toContain(
      "This tool starts an independently managed subagent and immediately returns its id. The runtime notifies you when it finishes. The child reports results with `send_message`; use `send_message` to steer it while running or continue its conversation after it finishes.",
    );
    expect(d).not.toContain("This backend does not accept follow-up messages.");
    expect(d).toContain("Its final message is not shown to the user: tell them what matters.");
    expect(d).toContain("Never report or guess a subagent's result before its notice arrives.");
    for (const p of ["general-purpose", "Explore", "Plan"]) expect(d).toContain(p);
  });

  it("several in one message run at once", () => {
    expect(isConcurrencySafe("subagent", { description: "x", prompt: "y" })).toBe(true);
  });
});

describe("the control tools' declarations and answers (DeepSeek's words)", () => {
  const params = (d: Record<string, unknown>) => (d.parameters as { properties: Record<string, { description?: string; enum?: string[] }>; required?: string[] });

  it("the guidance names both delegation tools", () => {
    expect(SUBAGENT_GUIDANCE).toBe(
      "Start independent delegations with `subagent` or `subagent_fork` together in one assistant message and continue useful work while they run. When only waiting for their results remains, end your turn instead of sleeping or polling; the next result starts a new turn.",
    );
  });

  it("subagent_fork: a child that inherits the completed turns", () => {
    expect(SUBAGENT_FORK_DECLARATION.name).toBe("subagent_fork");
    expect(String(SUBAGENT_FORK_DECLARATION.description)).toBe(
      "Delegate a task to a subagent that inherits this conversation: a child agent seeded with all completed turns so far (it does not see the current in-flight turn). Use this when the subtask builds on this conversation's context — a follow-up analysis, a review, a continuation — without consuming this conversation's context for the work itself. You receive its result, not its intermediate steps. This tool starts an independently managed subagent and immediately returns its id. The runtime notifies you when it finishes. The child reports results with `send_message`; use `send_message` to steer it while running or continue its conversation after it finishes. Its final message is not shown to the user: tell them what matters. Never report or guess a subagent's result before its notice arrives.",
    );
    const p = params(SUBAGENT_FORK_DECLARATION);
    expect(p.properties.prompt!.description).toBe("The task for the subagent. It already sees this conversation's completed turns, so build on them freely and state only what is new.");
    expect(p.properties.description!.description).toBe("A short (3-5 word) description of the delegated task, for display.");
    expect(p.properties).not.toHaveProperty("agent_preset");
    expect(p.required).toEqual(["description", "prompt"]);
  });

  it("send_message", () => {
    expect(SEND_MESSAGE_DECLARATION.name).toBe("send_message");
    expect(SEND_MESSAGE_DECLARATION.description).toBe(
      "Send a message to an agent. A working agent receives it at its next step; an idle agent starts a new turn with it. Returns delivery confirmation, not the agent's answer.",
    );
    const p = params(SEND_MESSAGE_DECLARATION);
    expect(p.properties.agent_id!.description).toBe("The agent id of your direct continuable child, or your direct parent when you are a resident continuable child.");
    expect(p.properties.message!.description).toBe("The message to deliver to the agent.");
    expect(p.required).toEqual(["agent_id", "message"]);
    expect(messageDeliveredLine("abc")).toBe("message delivered to agent abc");
  });

  it("interrupt_agent", () => {
    expect(INTERRUPT_AGENT_DECLARATION.name).toBe("interrupt_agent");
    expect(INTERRUPT_AGENT_DECLARATION.description).toBe(
      "Ask a subagent to stop its current work. This call returns without waiting for it to stop. You can continue a local direct child's conversation later with send_message. External executions stop permanently and cannot receive follow-ups. Subagents it started will keep running.",
    );
    const p = params(INTERRUPT_AGENT_DECLARATION);
    expect(p.properties.agent_id!.description).toBe("The id of an agent created under you: your direct child or a deeper descendant.");
    expect(p.required).toEqual(["agent_id"]);
    expect(interruptRequestedLine("abc")).toBe("interrupt requested for agent abc");
  });

  it("list_agents, and its rows for both scopes", () => {
    expect(LIST_AGENTS_DECLARATION.name).toBe("list_agents");
    expect(LIST_AGENTS_DECLARATION.description).toBe(
      "List subagents you started, with their ids, labels, and status. running means it is working; inactive means it is not currently working. You will be notified when a subagent finishes; there is no need to keep checking its status. Use send_message to continue the conversation.",
    );
    const p = params(LIST_AGENTS_DECLARATION);
    expect(p.properties.scope!.enum).toEqual(["children", "descendants"]);
    expect(p.properties.scope!.description).toBe(
      "children (default) lists direct children, which accept send_message in any status. descendants lists the whole tree below you with each entry's parent session id and depth; entries deeper than 1 accept only interrupt_agent.",
    );
    const rows = [
      { id: "a1", label: "Find the menu", status: "running" as const },
      { id: "b2", label: "Fix the footer", status: "inactive" as const },
    ];
    expect(listAgentsText(rows, "children")).toBe("a1 [running] — Find the menu\nb2 [inactive] — Fix the footer");
    expect(listAgentsText(rows, "descendants")).toBe("a1 [running] parent=len depth=1 — Find the menu\nb2 [inactive] parent=len depth=1 — Fix the footer");
    expect(listAgentsText([], "children")).toBe("(no subagents)");
  });

  it("the errors", () => {
    expect(unavailableError("abc")).toBe('subagent "abc" is unavailable');
    expect(notYourParentError("abc", "xyz")).toBe('agent "abc" is not a resident continuable child and cannot send to parent "xyz"');
  });
});
