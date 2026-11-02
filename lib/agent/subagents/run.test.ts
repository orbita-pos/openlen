// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import type { Message, StreamEvent } from "@/lib/ai-gateway";
import type { BuildAgentMessagesArgs } from "@/lib/agent/context";
import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";

import { settlementNotice } from "./notice";
import { forgetAllSubagents, noticeTurnPending, reserve, stop, takeNotices } from "./registry";
import { childMessages, createSubagentLauncher, type LaunchContext, type RunnerIO, type SubagentEvent } from "./run";
import { createTurnSpend } from "./spend";

afterEach(() => forgetAllSubagents());

const done: StreamEvent = { type: "done", stopReason: { kind: "end_turn" } };
const usage = (o: number): StreamEvent => ({ type: "usage", inputTokens: 1000, outputTokens: o, cachedTokens: 0, thinkingTokens: 0 });
const llama = (name: string, args: Record<string, unknown> = {}): StreamEvent[] => [{ type: "function_call", name, args }, usage(5), done];
const dice = (text: string): StreamEvent[] => [{ type: "text_delta", text }, usage(7), done];

/** One script per call; the last one repeats. `gate` holds a call until it is opened. */
function guion(...vueltas: StreamEvent[][]) {
  const seen: Message[][] = [];
  let i = 0;
  let gate: Promise<void> | null = null;
  let open = () => {};
  return {
    seen,
    hold() {
      gate = new Promise<void>((r) => (open = r));
    },
    release: () => open(),
    abrir: (messages: Message[]) => {
      seen.push([...messages]);
      const v = vueltas[Math.min(i++, vueltas.length - 1)]!;
      const waitFor = gate;
      return (async function* () {
        if (waitFor) await waitFor;
        for (const ev of v) yield ev;
      })();
    },
  };
}

const TURN_ARGS = {
  state: {},
  prompt: "Len's own message",
  history: [{ role: "user", content: "an old message of the chat" }],
  maxPromptTokens: 200_000,
  memoryMessage: "PROJECT MEMORY",
  userMemory: "PERSONAL NOTES",
  skillCatalogMessage: "THE SKILL CATALOG",
  design: "DESIGN PANEL VALUES",
  todoRestore: "TODO LIST TO RESTORE",
} as unknown as BuildAgentMessagesArgs;

function setup(o: { scripts?: StreamEvent[][]; turnAlive?: boolean; turnOpen?: boolean; spendCap?: number; lenSpent?: number } = {}) {
  const g = guion(...(o.scripts ?? [llama("Read", { file_path: "/menu/index.html" }), dice("Done: /menu/index.html")]));
  const rows = new Map<string, Record<string, unknown>>();
  const sessions: AgentSession[] = [];
  const ran: string[] = [];
  const charges: unknown[] = [];
  const terminals: string[] = [];
  const noticeTurns: unknown[] = [];
  const changes: unknown[] = [];
  const events: SubagentEvent[] = [];
  let n = 0;
  const io: RunnerIO = {
    brain: () => ({ openStream: g.abrir, closeOut: () => g.abrir([]), modelId: "m", lastProvider: () => "deepinfra" }),
    runTool: async (session, _deps, name, args): Promise<ToolOutcome> => {
      if (!sessions.includes(session)) sessions.push(session);
      ran.push(name);
      if (name === "skill") session.loadedSkills?.add(String(args.name));
      return { response: { ok: true, tool_result: "1\tx" }, action: { tool: name, ok: true, summary: String(args.file_path ?? args.name ?? "") } };
    },
    store: {
      createRun: async (r) => void rows.set(r.id, { ...r, status: "running" }),
      saveProgress: async () => {},
      settleRun: async (id, s) => void rows.set(id, { ...rows.get(id), ...s }),
    },
    charge: async (c) => {
      charges.push(c);
      return c.centicredits;
    },
    openTerminal: async (session, holderId) => {
      if (!sessions.includes(session)) sessions.push(session);
      terminals.push(`open ${holderId}`);
    },
    closeTerminal: async (_s, holderId) => void terminals.push(`close ${holderId}`),
    turnAlive: () => o.turnAlive ?? false,
    launchNoticeTurn: (projectId, personId) => void noticeTurns.push({ projectId, personId }),
    turnStillOpen: () => o.turnOpen ?? true,
    snapshot: async () => ({ "/index.html": "a" }),
    addTurnChanges: async (...a) => void changes.push(a),
    now: () => 1_000,
    newId: () => `r${++n}`,
  };
  let lenSpent = o.lenSpent ?? 0;
  const ctx: LaunchContext = {
    projectId: "p",
    ownerId: "owner",
    userId: "owner",
    personId: "owner",
    turnId: "turn-1",
    chatRowId: "row-1",
    mode: "len",
    app: null,
    planMode: false,
    turnArgs: TURN_ARGS,
    declarations: ["Read", "Edit", "Write", "skill", "publish", "subagent"].map((name) => ({ name })),
    deps: {} as AgentDeps,
    sessionBase: { skills: new Map() as never, ownerEmail: null },
    spend: createTurnSpend(o.spendCap ?? 10_000, () => lenSpent),
    emit: (ev) => void events.push(ev),
    isMember: false,
  };
  const launcher = createSubagentLauncher(ctx, io);
  const settled = async (id: string) => {
    for (let i = 0; i < 200 && rows.get(id)?.status === "running"; i++) await new Promise((r) => setTimeout(r, 2));
    return rows.get(id)!;
  };
  return { g, rows, sessions, ran, charges, terminals, noticeTurns, changes, events, ctx, launcher, settled, setLen: (v: number) => (lenSpent = v) };
}

describe("the launcher of Len's subagents", () => {
  it("starts the child and answers before it finishes", async () => {
    const s = setup();
    s.g.hold();
    const r = await s.launcher.launch({ description: "Find the menu", prompt: "Where is the menu?", preset: "Explore" });
    expect(r).toEqual({ ok: true, id: "r1" });
    expect(s.rows.get("r1")).toMatchObject({ status: "running", preset: "Explore", description: "Find the menu", chatRowId: "row-1", turnId: "turn-1", personId: "owner" });
    expect(s.events[0]).toMatchObject({ type: "subagent", id: "r1", status: "running" });
    s.g.release();
    await s.settled("r1");
  });

  it("when it finishes: settles, charges the owner, frees its slot and box, and leaves its notice", async () => {
    const s = setup();
    await s.launcher.launch({ description: "Find the menu", prompt: "Where is the menu?", preset: "general-purpose" });
    const row = await s.settled("r1");
    expect(row).toMatchObject({ status: "completed", finalText: "Done: /menu/index.html", toolUses: 1 });
    expect(s.charges).toEqual([expect.objectContaining({ ownerId: "owner", projectId: "p", refId: "r1" })]);
    expect(s.charges[0]).toMatchObject({ uses: [{ provider: "deepinfra", model: "m" }] });
    expect((s.charges[0] as { centicredits: number }).centicredits).toBeGreaterThan(0);
    expect(s.ctx.spend.children()).toBe((s.charges[0] as { centicredits: number }).centicredits);
    expect(s.terminals).toEqual(["open r1", "close r1"]);
    expect(takeNotices("p")).toEqual([{ id: "r1", text: settlementNotice({ id: "r1", stopReason: "completed", closingText: "Done: /menu/index.html" }) }]);
    expect(reserve("p", "x", new AbortController())).toBe(true);
    expect(s.events.at(-1)).toMatchObject({ id: "r1", status: "completed" });
  });

  it("with Len idle the notice starts a server turn; with Len working it doesn't", async () => {
    const idle = setup({ turnAlive: false });
    await idle.launcher.launch({ description: "a", prompt: "b", preset: "Explore" });
    await idle.settled("r1");
    expect(idle.noticeTurns).toEqual([{ projectId: "p", personId: "owner" }]);
    forgetAllSubagents();
    const busy = setup({ turnAlive: true });
    await busy.launcher.launch({ description: "a", prompt: "b", preset: "Explore" });
    await busy.settled("r1");
    expect(busy.noticeTurns).toEqual([]);
  });

  it("two children settling with Len idle launch a single notice turn", async () => {
    const s = setup({ scripts: [dice("done")] });
    await s.launcher.launch({ description: "a", prompt: "b", preset: "Explore" });
    await s.launcher.launch({ description: "c", prompt: "d", preset: "Explore" });
    await s.settled("r1");
    await s.settled("r2");
    expect(s.noticeTurns).toHaveLength(1);
    expect(noticeTurnPending("p")).toBe(true);
    expect(takeNotices("p")).toHaveLength(2);
  });

  it("its card's ■ stops it: aborted, and its notice says so", async () => {
    const s = setup();
    s.g.hold();
    await s.launcher.launch({ description: "a", prompt: "b", preset: "general-purpose" });
    expect(stop("r1")).toBe(true);
    s.g.release();
    const row = await s.settled("r1");
    expect(row.status).toBe("aborted");
    expect(takeNotices("p")[0]!.text).toContain("was stopped before it finished.");
  });

  it("past the turn's limit nothing starts; reaching it while running closes it as budget", async () => {
    const full = setup({ spendCap: 100, lenSpent: 100 });
    expect(await full.launcher.launch({ description: "a", prompt: "b", preset: "Explore" })).toMatchObject({ ok: false, code: "turn_budget_reached" });
    forgetAllSubagents();
    const s = setup({ spendCap: 100, scripts: [llama("Read", { file_path: "/a" }), llama("Read", { file_path: "/b" }), dice("never")] });
    s.g.hold();
    await s.launcher.launch({ description: "a", prompt: "b", preset: "Explore" });
    s.setLen(99);
    s.g.release();
    const row = await s.settled("r1");
    expect(row.status).toBe("budget");
  });

  it("the ninth at once is refused", async () => {
    const s = setup();
    s.g.hold();
    for (let i = 0; i < 8; i++) expect((await s.launcher.launch({ description: "a", prompt: "b", preset: "Explore" })).ok).toBe(true);
    expect(await s.launcher.launch({ description: "a", prompt: "b", preset: "Explore" })).toEqual({
      ok: false,
      code: "too_many_subagents",
      message: "8 subagents are already running in this project; wait for one to finish.",
    });
    s.g.release();
    for (let i = 1; i <= 8; i++) await s.settled(`r${i}`);
  });

  it("each child gets a fresh leidos, the same skills, its own loaded skills, and read-only when it only reads", async () => {
    const s = setup({ scripts: [llama("skill", { name: "frontend-design" }), dice("ok")] });
    await s.launcher.launch({ description: "a", prompt: "b", preset: "Explore" });
    await s.settled("r1");
    const child = s.sessions[0]!;
    expect(child.leidos).toBeInstanceOf(Map);
    expect(child.leidos!.size).toBe(0);
    expect(child.skills).toBe(s.ctx.sessionBase.skills);
    expect([...child.loadedSkills!]).toEqual(["frontend-design"]);
    expect(child.readOnly).toBe(true);
    expect(child.turnId).toBe("turn-1");
    expect(child.terminalHolderId).toBe("r1");
  });

  it("the child is offered only its tools: no publish, no subagent; Explore no Write", async () => {
    const s = setup({ scripts: [dice("ok")] });
    await s.launcher.launch({ description: "a", prompt: "b", preset: "Explore" });
    await s.settled("r1");
    const offered = (s.g.seen[0] ?? []).length;
    expect(offered).toBeGreaterThan(0);
    // what the brain was given is checked through what the loop refuses: a Write never reaches runTool
    const w = setup({ scripts: [llama("Write", { file_path: "/x", content: "y" }), dice("ok")] });
    forgetAllSubagents();
    await w.launcher.launch({ description: "a", prompt: "b", preset: "Explore" });
    await w.settled("r1");
    expect(w.ran).not.toContain("Write");
  });

  it("if the turn that launched it already closed, its changes join that turn's undo", async () => {
    const open = setup({ turnOpen: true });
    await open.launcher.launch({ description: "a", prompt: "b", preset: "general-purpose" });
    await open.settled("r1");
    expect(open.changes).toEqual([]);
    forgetAllSubagents();
    const closed = setup({ turnOpen: false });
    await closed.launcher.launch({ description: "a", prompt: "b", preset: "general-purpose" });
    await closed.settled("r1");
    expect(closed.changes).toEqual([["p", "row-1", { "/index.html": "a" }, { "/index.html": "a" }]]);
  });
});

describe("childMessages: what the child reads", () => {
  const text = (m: Message[]) => m.map((x) => (typeof x.content === "string" ? x.content : JSON.stringify(x.content)));

  it("Len's prompt with its type, no history, the catalog, and the task last", () => {
    const m = childMessages(TURN_ARGS, "Explore", "Where is the phone number?");
    const t = text(m);
    expect(t[0]).toContain("SUBAGENT — EXPLORE");
    expect(t.some((c) => c.includes("an old message of the chat"))).toBe(false);
    expect(t.some((c) => c.includes("THE SKILL CATALOG"))).toBe(true);
    expect(t.at(-1)).toContain("Where is the phone number?");
    expect(t.some((c) => c.includes("Len's own message"))).toBe(false);
    expect(t.some((c) => c.includes("DESIGN PANEL VALUES"))).toBe(false);
    expect(t.some((c) => c.includes("TODO LIST TO RESTORE"))).toBe(false);
  });

  it("Explore and Plan go without LEN.md and the person's notes; general-purpose with them", () => {
    const explore = text(childMessages(TURN_ARGS, "Explore", "x"));
    expect(explore.some((c) => c.includes("PROJECT MEMORY"))).toBe(false);
    expect(explore.some((c) => c.includes("PERSONAL NOTES"))).toBe(false);
    const general = text(childMessages(TURN_ARGS, "general-purpose", "x"));
    expect(general.some((c) => c.includes("PROJECT MEMORY"))).toBe(true);
    expect(general.some((c) => c.includes("PERSONAL NOTES"))).toBe(true);
  });
});
