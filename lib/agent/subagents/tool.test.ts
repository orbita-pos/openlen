import { describe, expect, it } from "vitest";

import type { AgentDeps, AgentSession } from "@/lib/agent/tools";
import { isConcurrencySafe } from "@/lib/agent/tool-concurrency";

import { SUBAGENT_DECLARATION, toolSubagent } from "./tool";

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

  it("its description is DeepSeek's, then the types, then our two sentences", () => {
    const d = String(SUBAGENT_DECLARATION.description);
    expect(d).toMatch(/^Delegate a self-contained task to a subagent \(a separate agent that works in its own context\)/);
    expect(d).toContain("This backend does not accept follow-up messages.");
    expect(d).toContain("Its final message is not shown to the user: tell them what matters.");
    expect(d).toContain("Never report or guess a subagent's result before its notice arrives.");
    for (const p of ["general-purpose", "Explore", "Plan"]) expect(d).toContain(p);
  });

  it("several in one message run at once", () => {
    expect(isConcurrencySafe("subagent", { description: "x", prompt: "y" })).toBe(true);
  });
});
