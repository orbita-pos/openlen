// @vitest-environment node
//
// LEN'S `propose_action` (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): DeepSeek's card tool
// (packages/experimental/action-cards/src/index.ts, `propose`) with its checks, its refusals word for word and its
// invitation, for one action, `create_tool`.
import { describe, expect, it, vi } from "vitest";

import type { AgentSession } from "@/lib/agent/tools";

vi.mock("server-only", () => ({}));

const { DECLARACION_PROPOSE_ACTION, INVITATION, PROPOSE_ACTION, proposeToolCard } = await import("./propose");

const session = (over: Partial<AgentSession> = {}): AgentSession =>
  ({ projectId: "p1", userId: "owner", personId: "u1", turnId: "turn-1", chatRowId: "row-1", turnSkillLoads: new Set(["tool-suggestions"]), ...over }) as unknown as AgentSession;

const good = { action: "create_tool", title: "Reservas de hoy", brief: "Ver las reservas del día y marcarlas al llegar.", details: { placement: "rail" } };

function deps(queued = 0) {
  const insertCard = vi.fn(async (input: Record<string, unknown>) => ({
    id: "card-1",
    chatRowId: String(input.chatRowId),
    title: String(input.title),
    brief: String(input.brief),
    initialContent: (input.initialContent as string | null) ?? null,
    placement: input.placement as "rail" | "project",
    customLocation: null,
    phase: "proposed" as const,
    toolProjectId: null,
    installationId: null,
    error: null,
    review: null,
  }));
  return { insertCard, queued: vi.fn(() => queued) };
}

const refusal = async (s: AgentSession, args: Record<string, unknown>, d = deps()) => {
  const out = await proposeToolCard(s, args, d);
  expect(out.response.ok).toBe(false);
  expect(d.insertCard).not.toHaveBeenCalled();
  return String(out.response.error);
};

describe("propose_action", () => {
  it("is DeepSeek's tool: its name, description and four required fields", () => {
    expect(PROPOSE_ACTION).toBe("propose_action");
    expect(DECLARACION_PROPOSE_ACTION.description).toBe("Show the user one optional action card under this answer. Call only as the skill that names the action instructs.");
    expect(DECLARACION_PROPOSE_ACTION.parameters.required).toEqual(["action", "title", "brief", "details"]);
  });

  it("never from a subagent", async () => {
    expect(await refusal(session({ isSubagent: true }), good)).toBe("Cards are offered in the main conversation only.");
  });

  it("not with 2 or more messages queued", async () => {
    expect(await refusal(session(), good, deps(2))).toBe("The user has queued more messages; show no card and answer briefly.");
  });

  it("only its one action", async () => {
    expect(await refusal(session(), { ...good, action: "create_page" })).toBe('Unknown action "create_page". Registered actions: create_tool.');
  });

  it("only after loading its skill in this same turn", async () => {
    expect(await refusal(session({ turnSkillLoads: new Set() }), good)).toBe("Load skill tool-suggestions first, then call propose_action.");
  });

  it("with a title and a brief", async () => {
    expect(await refusal(session(), { ...good, title: "  " })).toBe("Write a title and a brief.");
    expect(await refusal(session(), { ...good, brief: "" })).toBe("Write a title and a brief.");
  });

  it("with valid details", async () => {
    expect(await refusal(session(), { ...good, details: { placement: "sidebar-left" } })).toMatch(/^Invalid details: details\.placement: /);
    expect(await refusal(session(), { ...good, details: { placement: "rail", initialContent: 3 } })).toMatch(/^Invalid details: details\.initialContent: /);
  });

  it("accepted: one row for this turn's answer and this person, the invitation, and the card for the chat", async () => {
    const d = deps();
    const s = session();
    const out = await proposeToolCard(s, { ...good, details: { placement: "project", initialContent: "Mesa 4, 20:00" } }, d);
    expect(out.response).toEqual({ ok: true, tool_result: `Card shown below your answer. Do not restate it. ${INVITATION}` });
    expect(d.insertCard).toHaveBeenCalledWith({
      projectId: "p1",
      chatRowId: "row-1",
      personId: "u1",
      title: "Reservas de hoy",
      brief: "Ver las reservas del día y marcarlas al llegar.",
      initialContent: "Mesa 4, 20:00",
      placement: "project",
    });
    expect(out.toolCard?.id).toBe("card-1");
    expect(d.queued).toHaveBeenCalledWith("turn-1");
  });

  it("one card per turn: a second call is refused, the first stands", async () => {
    const d = deps();
    const s = session();
    await proposeToolCard(s, good, d);
    const out = await proposeToolCard(s, { ...good, title: "Otra" }, d);
    expect(out.response).toEqual({ ok: false, error: "One card per turn; the earlier card stands." });
    expect(d.insertCard).toHaveBeenCalledTimes(1);
  });

  it("the person is the owner when no one else is speaking", async () => {
    const d = deps();
    await proposeToolCard(session({ personId: undefined }), good, d);
    expect(d.insertCard.mock.calls[0]![0]).toMatchObject({ personId: "owner" });
  });
});
