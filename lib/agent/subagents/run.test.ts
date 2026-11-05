// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Message, StreamEvent } from "@/lib/ai-gateway";
import type { BuildAgentMessagesArgs } from "@/lib/agent/context";
import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";

import { isolationLine, settlementNotice, type WorktreeOutcome } from "./notice";
import { withPlanSection } from "@/lib/agent/plan-mode";

import { forgetAllSubagents, isLive, liveCount, noticeTurnPending, reserve, sendToRun, stop, takeNotices } from "./registry";
import { childMessages, createSubagentLauncher, type LaunchContext, type RunnerIO, type SubagentEvent } from "./run";
import type { ConversationRun, SubagentRunRow } from "./store";
import { createTurnSpend } from "./spend";
import { NO_AGENT_TYPES, resolveAgentTypes, type AgentTypeSet } from "./agent-registry";

afterEach(() => { forgetAllSubagents(); vi.unstubAllEnvs(); });

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

function setup(
  o: {
    /** A tool project (spec local 2026-11-04-herramientas-hechas-por-len, §4.8). */
    tool?: boolean;
    scripts?: StreamEvent[][];
    agentTypes?: AgentTypeSet;
    skills?: AgentSession["skills"];
    turnAlive?: boolean;
    turnOpen?: boolean;
    spendCap?: number;
    lenSpent?: number;
    snapshots?: Record<string, string>[];
    touched?: Record<string, string[]>;
    /** Runs left out of the current conversation (an archived one). */
    archived?: string[];
    onCloseTerminal?: () => void;
    forkSeed?: Message[];
    /** The database fails when a settled run is reopened. */
    reopenFails?: boolean;
    planMode?: boolean;
    loopExtras?: RunnerIO["loopExtras"];
    /** What Read answers, by path ("1\tx" otherwise). */
    readResults?: Record<string, string>;
    /** Phase 4: how an isolated child's copy is made and comes back. */
    worktree?: { fail?: boolean; outcome?: WorktreeOutcome; changes?: { before: Record<string, string>; after: Record<string, string> } | null };
  } = {},
) {
  const g = guion(...(o.scripts ?? [llama("Read", { file_path: "/menu/index.html" }), dice("Done: /menu/index.html")]));
  const rows = new Map<string, Record<string, unknown>>();
  const sessions: AgentSession[] = [];
  const ran: string[] = [];
  const charges: unknown[] = [];
  const terminals: string[] = [];
  const noticeTurns: unknown[] = [];
  const changes: unknown[] = [];
  const events: SubagentEvent[] = [];
  const brainSignals: (AbortSignal | undefined)[] = [];
  const brainTools: Record<string, unknown>[][] = [];
  const brainEfforts: unknown[] = [];
  const closeOuts: Message[][] = [];
  const logs: string[] = [];
  const browsersClosed: AgentSession[] = [];
  const reopens: [string, string][] = [];
  const saves: Record<string, unknown>[] = [];
  const flushes: (() => Promise<void>)[] = [];
  const snapshots = [...(o.snapshots ?? [])];
  const worktreesMade: { parentId: string; ownerId: string; runId: string }[] = [];
  /** Each finish, with what was true when it ran: the notices already queued, its slot, the terminals closed. */
  const finishes: { w: unknown; session: AgentSession; noticesBefore: number; liveBefore: boolean; terminalsBefore: string[] }[] = [];
  let n = 0;
  let copies = 0;
  const io: RunnerIO = {
    addWorktree: async (w) => {
      if (o.worktree?.fail) throw new Error("no space");
      worktreesMade.push(w);
      return { copyId: `copy-${++copies}`, branch: `worktree-agent-${w.runId}${copies > 1 ? `-${copies}` : ""}`, base: "b".repeat(40) };
    },
    finishWorktree: async ({ w, session }) => {
      const id = String(session.terminalHolderId);
      finishes.push({ w, session, noticesBefore: takeNotices("p").length, liveBefore: isLive("p", id), terminalsBefore: [...terminals] });
      return { outcome: o.worktree?.outcome ?? { state: "brought", files: ["/src/a.ts"] }, changes: o.worktree?.changes ?? null };
    },
    log: (line) => void logs.push(line),
    brain: (tools, _runId, signal, effort) => {
      brainEfforts.push(effort);
      brainSignals.push(signal);
      brainTools.push(tools);
      return { openStream: g.abrir, closeOut: (m) => { closeOuts.push(m); return g.abrir(m); }, modelId: "m", lastProvider: () => "deepinfra" };
    },
    runTool: async (session, _deps, name, args): Promise<ToolOutcome> => {
      if (!sessions.includes(session)) sessions.push(session);
      ran.push(name);
      if (name === "skill") session.loadedSkills?.add(String(args.name));
      const touched = o.touched?.[name];
      return {
        response: { ok: true, tool_result: (name === "Read" && o.readResults?.[String(args.file_path)]) || "1\tx" },
        action: { tool: name, ok: true, summary: String(args.file_path ?? args.name ?? "") },
        ...(touched ? { ficherosTocados: touched.map((ruta) => ({ ruta, versionPrevia: null })) } : {}),
      };
    },
    store: {
      createRun: async (r) => void rows.set(r.id, { ...r, status: "running", toolUses: 0, durationMs: null, chargedCenticredits: 0, actions: [], transcript: null }),
      saveProgress: async (id, p) => void saves.push({ id, ...p }),
      settleRun: async (id, s) => void rows.set(id, { ...rows.get(id), ...s }),
      setWorktree: async (id, w) => void rows.set(id, { ...rows.get(id), worktreeCopyId: w.copyId, worktreeBranch: w.branch, worktreeBase: w.base, worktreeOutcome: null }),
      setWorktreeOutcome: async (id, outcome) => void rows.set(id, { ...rows.get(id), worktreeOutcome: outcome }),
      reopenRun: async (id, personId) => {
        if (o.reopenFails) throw new Error("the database is down");
        const r = rows.get(id);
        if (!r || r.status === "running") return false;
        reopens.push([id, personId]);
        rows.set(id, { ...r, status: "running", personId });
        return true;
      },
      runsOfCurrentConversation: async (projectId) =>
        [...rows.values()].filter((r) => r.projectId === projectId && !o.archived?.includes(String(r.id))) as unknown as ConversationRun[],
      runOfCurrentConversation: async (projectId, id) => {
        const r = rows.get(id);
        return r && r.projectId === projectId && !o.archived?.includes(id) ? (r as unknown as SubagentRunRow) : null;
      },
    },
    charge: async (c) => {
      charges.push(c);
      return c.centicredits;
    },
    openTerminal: async (session, holderId) => {
      if (!sessions.includes(session)) sessions.push(session);
      terminals.push(`open ${holderId}`);
    },
    closeTerminal: async (_s, holderId) => {
      terminals.push(`close ${holderId}`);
      o.onCloseTerminal?.();
    },
    turnAlive: () => o.turnAlive ?? false,
    launchNoticeTurn: (projectId, personId) => void noticeTurns.push({ projectId, personId }),
    turnStillOpen: () => o.turnOpen ?? true,
    snapshot: async () => snapshots.shift() ?? { "/index.html": "a" },
    closeBrowser: async (session) => void browsersClosed.push(session),
    addTurnChanges: async (...a) => void changes.push(a),
    flushOnExit: (flush) => {
      flushes.push(flush);
      return () => {};
    },
    ...(o.loopExtras ? { loopExtras: o.loopExtras } : {}),
    now: () => 1_000,
    newId: () => `r${++n}`,
  };
  let lenSpent = o.lenSpent ?? 0;
  const ctx: LaunchContext = {
    agentTypes: o.agentTypes ?? NO_AGENT_TYPES,
    projectId: "p",
    ownerId: "owner",
    userId: "owner",
    personId: "owner",
    turnId: "turn-1",
    chatRowId: "row-1",
    mode: "len",
    app: null,
    planMode: o.planMode ?? false,
    turnArgs: TURN_ARGS,
    lenSystemPrompt: "LEN SYSTEM PROMPT",
    forkSeed: o.forkSeed ?? [],
    declarations: ["Read", "Edit", "Write", "skill", "publish", "subagent", "send_message", "subagent_fork", "interrupt_agent", "list_agents"].map((name) => ({ name })),
    deps: {} as AgentDeps,
    sessionBase: { skills: o.skills ?? new Map() as never, ownerEmail: null, ...(o.tool ? { tool: true } : {}) },
    spend: createTurnSpend(o.spendCap ?? 10_000, () => lenSpent),
    emit: (ev) => void events.push(ev),
    isMember: false,
  };
  const launcher = createSubagentLauncher(ctx, io);
  const settled = async (id: string) => {
    for (let i = 0; i < 200 && rows.get(id)?.status === "running"; i++) await new Promise((r) => setTimeout(r, 2));
    return rows.get(id)!;
  };
  return { g, io, rows, reopens, saves, flushes, sessions, ran, charges, terminals, noticeTurns, changes, events, brainSignals, brainTools, brainEfforts, closeOuts, logs, browsersClosed, worktreesMade, finishes, ctx, launcher, settled, setLen: (v: number) => (lenSpent = v) };
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

  // DeepSeek's Creator activation (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): an output schema declares
  // structured_output, whose call ends the run; delivered to the caller, no notice reaches Len.
  const READY = { type: "object", properties: { ready: { type: "boolean" } }, required: ["ready"] } as const;
  it("with an output schema: structured_output is declared, its call ends the run with no further model call", async () => {
    const s = setup({ scripts: [llama("structured_output", { ready: true })] });
    const settledWith: unknown[] = [];
    await s.launcher.launch({ description: "Crear", prompt: "Build it", preset: "general-purpose", outputSchema: READY, delivery: "caller", onSettled: async (r) => void settledWith.push(r) });
    const row = await s.settled("r1");
    expect(row.status).toBe("completed");
    expect(s.brainTools[0]!.map((t) => (t as { name: string }).name)).toContain("structured_output");
    expect(s.ran).not.toContain("structured_output");
    for (let i = 0; i < 50 && settledWith.length === 0; i++) await new Promise((r) => setTimeout(r, 2));
    expect(settledWith).toEqual([{ id: "r1", status: "completed", structured: { ready: true }, finalText: "" }]);
  });

  it("delivered to the caller: no notice for Len and no turn woken", async () => {
    const s = setup({ scripts: [llama("structured_output", { ready: false }), dice("Falta saber el horario.")] });
    await s.launcher.launch({ description: "Crear", prompt: "Build it", preset: "general-purpose", outputSchema: READY, delivery: "caller", onSettled: async () => {} });
    await s.settled("r1");
    expect(takeNotices("p")).toEqual([]);
    expect(s.noticeTurns).toEqual([]);
  });

  it("a structured_output that doesn't fit the schema is refused and the run goes on", async () => {
    const s = setup({ scripts: [llama("structured_output", { ready: "yes" }), llama("structured_output", { ready: true })] });
    const settledWith: { structured: unknown }[] = [];
    await s.launcher.launch({ description: "Crear", prompt: "Build it", preset: "general-purpose", outputSchema: READY, delivery: "caller", onSettled: async (r) => void settledWith.push(r as { structured: unknown }) });
    await s.settled("r1");
    for (let i = 0; i < 50 && settledWith.length === 0; i++) await new Promise((r) => setTimeout(r, 2));
    expect(settledWith[0]?.structured).toEqual({ ready: true });
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
    // Its brain listened to its own stop: the model call is cut too, not only the loop.
    expect(s.brainSignals[0]?.aborted).toBe(true);
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

  it("in a tool project, a child knows it is one (its publish installs; its eyes open the installed tool)", async () => {
    const s = setup({ tool: true, scripts: [dice("ok")] });
    await s.launcher.launch({ description: "a", prompt: "b", preset: "general-purpose" });
    await s.settled("r1");
    expect(s.sessions[0]!.tool).toBe(true);
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
    // A child never proposes a «Crear» card (spec local 2026-11-04-herramientas-hechas-por-len, §4.10).
    expect(child.isSubagent).toBe(true);
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
    // Only the files the child wrote: what others changed meanwhile is not its undo.
    const closed = setup({
      turnOpen: false,
      scripts: [llama("Write", { file_path: "/a.html" }), dice("Done")],
      snapshots: [
        { "/a.html": "1", "/b.html": "1" },
        { "/a.html": "2", "/b.html": "changed by another turn" },
      ],
      touched: { Write: ["/a.html"] },
    });
    await closed.launcher.launch({ description: "a", prompt: "b", preset: "general-purpose" });
    await closed.settled("r1");
    expect(closed.changes).toEqual([["p", "row-1", { "/a.html": "1" }, { "/a.html": "2" }]]);
    // A child that wrote nothing adds nothing.
    forgetAllSubagents();
    const reader = setup({ turnOpen: false });
    await reader.launcher.launch({ description: "a", prompt: "b", preset: "Explore" });
    await reader.settled("r1");
    expect(reader.changes).toEqual([]);
  });

  it("while it runs, its spend counts for the other children and for Len; when it ends, what it was charged", async () => {
    const s = setup({ scripts: [llama("Read", { file_path: "/a" }), dice("Done")] });
    const tracked: [string, number][] = [];
    const track = s.ctx.spend.track.bind(s.ctx.spend);
    (s.ctx.spend as { track: typeof track }).track = (id, c) => {
      tracked.push([id, c]);
      track(id, c);
    };
    await s.launcher.launch({ description: "a", prompt: "b", preset: "Explore" });
    await s.settled("r1");
    expect(tracked.length).toBeGreaterThan(0);
    expect(tracked.every(([id, c]) => id === "r1" && c > 0)).toBe(true);
    const charged = (s.charges[0] as { centicredits: number }).centicredits;
    expect(s.ctx.spend.children()).toBe(charged);
    expect(s.ctx.spend.over(10_000 - charged - 1)).toBe(false);
  });

  it("its browser tab closes when it ends", async () => {
    const s = setup();
    await s.launcher.launch({ description: "a", prompt: "b", preset: "Explore" });
    await s.settled("r1");
    expect(s.browsersClosed).toHaveLength(1);
    expect(s.browsersClosed[0]).toBe(s.sessions[0]);
  });
});

describe("continuable children (phase 2)", () => {
  const user = (m: Message[]) => m.filter((x) => x.role === "user").map((x) => (typeof x.content === "string" ? x.content : ""));

  it("a message from Len reaches the running child at its next step, as Agent len sent a message", async () => {
    const s = setup({ scripts: [llama("Read", { file_path: "/a" }), dice("Done")] });
    s.g.hold();
    await s.launcher.launch({ description: "a", prompt: "b", preset: "general-purpose" });
    sendToRun("r1", "Also check the footer.");
    s.g.release();
    await s.settled("r1");
    expect(user(s.g.seen[1]!)).toContain("Agent len sent a message: Also check the footer.");
  });

  it("the child's send_message reaches Len as a notice, wakes him, and the settlement omits the closing message", async () => {
    const s = setup({ scripts: [llama("send_message", { agent_id: "len", message: "Found: /menu/index.html:12" }), dice("Found: /menu/index.html:12")] });
    await s.launcher.launch({ description: "a", prompt: "b", preset: "Explore" });
    await s.settled("r1");
    const notices = takeNotices("p");
    expect(notices.map((n) => n.text)).toEqual([
      "Agent r1 sent a message: Found: /menu/index.html:12",
      "Background subagent r1 finished and will do no further work unless you send it more.\n\nIt sent you a message just before finishing, so its closing message is omitted.",
    ]);
    // A message does not settle the run: Len marks only the settlement delivered.
    expect(notices[0]).toMatchObject({ id: "r1", message: true });
    expect(notices[1]!.message).toBeUndefined();
    expect(s.ran).not.toContain("send_message");
    expect(s.noticeTurns).toHaveLength(1);
    expect(s.g.seen[1]!.at(-1)!.functionResponses?.[0]?.response).toMatchObject({ ok: true, tool_result: "message delivered to agent len" });
  });

  it("a tool call after its message brings the closing message back", async () => {
    const s = setup({ scripts: [llama("send_message", { agent_id: "len", message: "Half done" }), llama("Read", { file_path: "/b" }), dice("All done")] });
    await s.launcher.launch({ description: "a", prompt: "b", preset: "Explore" });
    await s.settled("r1");
    expect(takeNotices("p").at(-1)!.text).toContain("Its closing message:\nAll done");
  });

  it("a refused call after its message brings the closing message back too (DeepSeek: any logged call voids it)", async () => {
    const s = setup({ scripts: [llama("send_message", { agent_id: "len", message: "Half done" }), llama("publish", { subdomain: "x" }), dice("All done")] });
    await s.launcher.launch({ description: "a", prompt: "b", preset: "Explore" });
    await s.settled("r1");
    expect(s.ran).not.toContain("publish");
    expect(takeNotices("p").at(-1)!.text).toContain("Its closing message:\nAll done");
  });

  it("a child addressing anyone but len gets DeepSeek's answers: one of Len's children belongs to another parent, anyone else is unavailable", async () => {
    const s = setup({ scripts: [llama("send_message", { agent_id: "r9", message: "psst" }), llama("send_message", { agent_id: "r1", message: "me" }), dice("ok")] });
    await s.launcher.launch({ description: "a", prompt: "b", preset: "Explore" });
    await s.settled("r1");
    expect(s.g.seen[1]!.at(-1)!.functionResponses?.[0]?.response).toMatchObject({ ok: false, error: 'subagent "r9" is unavailable' });
    expect(s.g.seen[2]!.at(-1)!.functionResponses?.[0]?.response).toMatchObject({ ok: false, error: 'subagent "r1" belongs to another parent session' });
    expect(takeNotices("p").map((n) => n.text.startsWith("Agent r1 sent"))).toEqual([false]);
  });

  it("the saved transcript is the whole conversation but the system prompt", async () => {
    const s = setup();
    await s.launcher.launch({ description: "a", prompt: "Find the menu.", preset: "Explore" });
    const row = await s.settled("r1");
    const t = row.transcript as Message[];
    expect(t.some((m) => m.role === "system")).toBe(false);
    expect(t.some((m) => m.role === "user" && String(m.content).includes("Find the menu."))).toBe(true);
    expect(t.at(-1)).toMatchObject({ role: "assistant", content: "Done: /menu/index.html" });
  });
});

describe("waking an idle child (phase 2)", () => {
  const until = async (cond: () => boolean) => {
    for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 2));
  };

  it("an idle child resumes from its transcript with Len's message and settles again", async () => {
    const s = setup({ scripts: [dice("First pass done"), dice("Footer done too")] });
    await s.launcher.launch({ description: "Fix", prompt: "Fix the header.", preset: "general-purpose" });
    await s.settled("r1");
    takeNotices("p");
    expect(await s.launcher.send({ id: "r1", message: "Now the footer." })).toEqual({ ok: true, resumed: true, preset: "general-purpose", description: "Fix" });
    const row = await s.settled("r1");
    const second = s.g.seen[1]!;
    expect(second[0]!.role).toBe("system");
    expect(String(second[0]!.content)).toContain("LEN SYSTEM PROMPT");
    expect(second.some((m) => m.role === "user" && String(m.content).includes("Fix the header."))).toBe(true);
    expect(second.some((m) => m.role === "assistant" && m.content === "First pass done")).toBe(true);
    expect(second.at(-1)).toEqual({ role: "user", content: "Agent len sent a message: Now the footer." });
    expect(row.status).toBe("completed");
    expect(takeNotices("p").map((n) => n.text)).toEqual([
      "Background subagent r1 finished and will do no further work unless you send it more.\n\nIts closing message:\nFooter done too",
    ]);
  });

  it("🔴 a «Crear» card's creator can't be messaged or woken by Len: its result is the card's", async () => {
    const s = setup({ scripts: [dice("Built")] });
    const ready = { type: "object", properties: { ready: { type: "boolean" } }, required: ["ready"] } as const;
    const r = await s.launcher.launch({ description: "Crear", prompt: "Build it", preset: "creator", outputSchema: ready, delivery: "caller", onSettled: async () => {} });
    expect(r).toMatchObject({ ok: true });
    await s.settled("r1");
    expect(await s.launcher.send({ id: "r1", message: "Now publish it." })).toMatchObject({ ok: false, code: "unavailable" });
    expect(s.g.seen).toHaveLength(1);
  });

  it("a running child gets Len's message in its inbox instead", async () => {
    const s = setup({ scripts: [llama("Read", { file_path: "/a" }), dice("Done")] });
    s.g.hold();
    await s.launcher.launch({ description: "a", prompt: "b", preset: "general-purpose" });
    expect(await s.launcher.send({ id: "r1", message: "Hurry." })).toEqual({ ok: true, resumed: false, preset: "general-purpose", description: "a" });
    s.g.release();
    await s.settled("r1");
    expect(s.g.seen[1]!.some((m) => m.content === "Agent len sent a message: Hurry.")).toBe(true);
  });

  it("the woken run adds to the row's counts, and counts against the current turn's slots and cap", async () => {
    const s = setup({ scripts: [llama("Read", { file_path: "/a" }), dice("One"), llama("Read", { file_path: "/b" }), dice("Two")] });
    await s.launcher.launch({ description: "a", prompt: "b", preset: "general-purpose" });
    const first = { ...(await s.settled("r1")) };
    await s.launcher.send({ id: "r1", message: "Again." });
    const second = await s.settled("r1");
    expect(second.toolUses).toBe((first.toolUses as number) + 1);
    expect(second.chargedCenticredits as number).toBeGreaterThan(first.chargedCenticredits as number);
    expect(second.actions as unknown[]).toHaveLength(2);
    // Its usage is both passes', like its charge.
    expect((second.usage as { inputTokens: number }).inputTokens).toBe(2 * (first.usage as { inputTokens: number }).inputTokens);
    for (let i = 0; i < 8; i++) reserve("p", `x${i}`, new AbortController());
    expect(await s.launcher.send({ id: "r1", message: "x" })).toMatchObject({ ok: false, code: "too_many_subagents" });
    forgetAllSubagents();
    s.setLen(10_000);
    expect(await s.launcher.send({ id: "r1", message: "x" })).toMatchObject({ ok: false, code: "turn_budget_reached" });
  });

  it("🔴 a message at the very moment it settles wakes it again: nothing is lost", async () => {
    let once = true;
    const s = setup({
      scripts: [dice("Done"), dice("Got it")],
      onCloseTerminal: () => {
        if (once) sendToRun("r1", "One more thing.");
        once = false;
      },
    });
    await s.launcher.launch({ description: "a", prompt: "b", preset: "general-purpose" });
    await until(() => s.g.seen.length === 2 && s.rows.get("r1")?.status === "completed");
    expect(s.g.seen[1]!.at(-1)).toEqual({ role: "user", content: "Agent len sent a message: One more thing." });
    // One activation (DeepSeek: pending input holds the settlement): Len hears once, when it is really done.
    expect(takeNotices("p").map((n) => n.text)).toEqual([settlementNotice({ id: "r1", stopReason: "completed", closingText: "Got it" })]);
    expect(s.events.filter((e) => e.status === "completed")).toHaveLength(1);
  });

  it("🔴 a stop sticks: what Len sent meanwhile waits in its transcript for the next wake", async () => {
    const s = setup({ scripts: [llama("Read", { file_path: "/a" }), dice("Done"), dice("Footer done")] });
    s.g.hold();
    await s.launcher.launch({ description: "a", prompt: "b", preset: "general-purpose" });
    // While its first call is out: the message waits in its inbox for the next step.
    await until(() => s.g.seen.length === 1);
    expect(await s.launcher.send({ id: "r1", message: "Also the footer." })).toMatchObject({ ok: true, resumed: false });
    expect(await s.launcher.interrupt("r1")).toBe(true);
    s.g.release();
    await until(() => s.rows.get("r1")?.status === "aborted" && !isLive("p", "r1"));
    await new Promise((r) => setTimeout(r, 20));
    expect(s.rows.get("r1")!.status).toBe("aborted");
    expect(s.g.seen).toHaveLength(1);
    expect(takeNotices("p").map((n) => n.text)).toEqual([expect.stringContaining("was stopped")]);
    expect((s.rows.get("r1")!.transcript as Message[]).at(-1)).toEqual({ role: "user", content: "Agent len sent a message: Also the footer." });
    // The next wake carries it, before the new message.
    expect(await s.launcher.send({ id: "r1", message: "Go on." })).toMatchObject({ ok: true, resumed: true });
    await s.settled("r1");
    expect(s.g.seen[1]!.slice(-2)).toEqual([
      { role: "user", content: "Agent len sent a message: Also the footer." },
      { role: "user", content: "Agent len sent a message: Go on." },
    ]);
  });

  it("a woken run whose row can't be reopened gives its slot back", async () => {
    const s = setup({ scripts: [dice("Done")], reopenFails: true });
    await s.launcher.launch({ description: "a", prompt: "b", preset: "general-purpose" });
    await s.settled("r1");
    await expect(s.launcher.send({ id: "r1", message: "Again." })).rejects.toThrow("the database is down");
    expect(isLive("p", "r1")).toBe(false);
    expect(liveCount("p")).toBe(0);
  });

  it("a message as it settles, with its row unreachable: it settles, frees its slot and keeps the message for the next wake", async () => {
    let once = true;
    const s = setup({
      scripts: [dice("Done"), dice("Got it")],
      reopenFails: true,
      onCloseTerminal: () => {
        if (once) sendToRun("r1", "One more thing.");
        once = false;
      },
    });
    await s.launcher.launch({ description: "a", prompt: "b", preset: "general-purpose" });
    await until(() => s.rows.get("r1")?.status === "completed" && !isLive("p", "r1"));
    await new Promise((r) => setTimeout(r, 20));
    expect(isLive("p", "r1")).toBe(false);
    expect(s.g.seen).toHaveLength(1);
    expect(takeNotices("p").map((n) => n.text)).toEqual([settlementNotice({ id: "r1", stopReason: "completed", closingText: "Done" })]);
    expect((s.rows.get("r1")!.transcript as Message[]).at(-1)).toEqual({ role: "user", content: "Agent len sent a message: One more thing." });
  });

  it("a woken run runs as, and is recorded for, the person who woke it: their ■ stops it", async () => {
    const s = setup({ scripts: [dice("One"), dice("Two")] });
    await s.launcher.launch({ description: "a", prompt: "b", preset: "general-purpose" });
    await s.settled("r1");
    const member = createSubagentLauncher({ ...s.ctx, personId: "m2" }, s.io);
    expect(await member.send({ id: "r1", message: "Again." })).toMatchObject({ ok: true, resumed: true });
    await s.settled("r1");
    expect(s.reopens).toEqual([["r1", "m2"]]);
    expect(s.rows.get("r1")!.personId).toBe("m2");
  });

  it("progress is saved with its duration, and only when something changed (a fork's conversation is large)", async () => {
    const s = setup({ scripts: [dice("Done")] });
    s.g.hold();
    await s.launcher.launch({ description: "a", prompt: "b", preset: "general-purpose" });
    await until(() => s.g.seen.length === 1);
    await s.flushes[0]!();
    await s.flushes[0]!();
    expect(s.saves).toHaveLength(1);
    expect(s.saves[0]).toMatchObject({ id: "r1", durationMs: 0, toolUses: 0 });
    s.g.release();
    await s.settled("r1");
  });

  it("a child that summarized is saved, and woken, from what it saw after the summary — not its whole record", async () => {
    // Its own head (Len's prompt and the platform notes) is ~9k tokens: the summary comes after two reads, the first one big.
    const s = setup({
      readResults: { "/a": "W".repeat(40_000) },
      scripts: [
        llama("Read", { file_path: "/a" }),
        [{ type: "function_call", name: "Read", args: { file_path: "/b" } }, { type: "usage", inputTokens: 60_000, outputTokens: 5, cachedTokens: 0, thinkingTokens: 0 }, done],
        dice("SUMMARY OF THE WORK"),
        dice("Done"),
        dice("Footer done"),
      ],
      loopExtras: () => ({ compaction: { policy: { thresholdTokens: 25_000, retainTokens: 5 }, firstIndex: 2 } }),
    });
    await s.launcher.launch({ description: "a", prompt: "Fix it.", preset: "general-purpose" });
    const row = await s.settled("r1");
    const saved = row.transcript as Message[];
    expect(saved.some((m) => JSON.stringify(m).includes("WWWW"))).toBe(false);
    expect(saved.some((m) => JSON.stringify(m).includes("SUMMARY OF THE WORK"))).toBe(true);
    expect(saved.at(-1)).toMatchObject({ role: "assistant", content: "Done" });
    takeNotices("p");
    await s.launcher.send({ id: "r1", message: "Now the footer." });
    await s.settled("r1");
    expect(s.g.seen.at(-1)!.slice(1, -1)).toEqual(saved);
  });

  it("a child of an archived conversation tells Len nothing: neither its messages nor how it ended", async () => {
    const s = setup({ scripts: [llama("send_message", { agent_id: "len", message: "halfway" }), dice("Done")], archived: ["r1"] });
    await s.launcher.launch({ description: "a", prompt: "b", preset: "general-purpose" });
    await s.settled("r1");
    await until(() => !isLive("p", "r1"));
    expect(takeNotices("p")).toEqual([]);
    expect(s.noticeTurns).toEqual([]);
    expect(s.g.seen[1]!.at(-1)!.functionResponses?.[0]?.response).toMatchObject({ ok: false, error: "direct parent is not live; the message was not delivered" });
  });

  it("a child keeps the scope it started with: launched in plan mode it wakes read-only; and Len in plan mode wakes no writer", async () => {
    const s = setup({ scripts: [dice("One"), dice("Two"), dice("Three"), dice("Four")], planMode: true });
    await s.launcher.launch({ description: "a", prompt: "b", preset: "general-purpose" });
    await s.settled("r1");
    expect(s.rows.get("r1")).toMatchObject({ planMode: true });
    const outOfPlan = createSubagentLauncher({ ...s.ctx, planMode: false }, s.io);
    await outOfPlan.send({ id: "r1", message: "Now write it." });
    await s.settled("r1");
    const names = (i: number) => s.brainTools[i]!.map((d) => d.name);
    expect(names(1)).not.toContain("Edit");
    await outOfPlan.launch({ description: "w", prompt: "c", preset: "general-purpose" });
    await s.settled("r2");
    expect(names(2)).toContain("Edit");
    const inPlan = createSubagentLauncher({ ...s.ctx, planMode: true }, s.io);
    await inPlan.send({ id: "r2", message: "More." });
    await s.settled("r2");
    expect(names(3)).not.toContain("Edit");
  });

  it("a run saved before its task was kept in the transcript (phase 1) wakes with its task first", async () => {
    const s = setup({ scripts: [dice("Done"), dice("Footer done")] });
    await s.launcher.launch({ description: "a", prompt: "Fix the header.", preset: "general-purpose" });
    await s.settled("r1");
    s.rows.set("r1", { ...s.rows.get("r1")!, transcript: [{ role: "assistant", content: "Header fixed." }] });
    await s.launcher.send({ id: "r1", message: "Now the footer." });
    await s.settled("r1");
    const woken = s.g.seen[1]!;
    const i = woken.findIndex((m) => m.content === "Header fixed.");
    expect(i).toBeGreaterThan(1);
    expect(woken.slice(1, i).some((m) => m.role === "user" && m.content.includes("Fix the header."))).toBe(true);
    expect(woken.at(-1)).toEqual({ role: "user", content: "Agent len sent a message: Now the footer." });
  });

  it("an unknown child, or one of an archived conversation, is unavailable", async () => {
    const s = setup({ archived: ["r1"] });
    await s.launcher.launch({ description: "a", prompt: "b", preset: "general-purpose" });
    await s.settled("r1");
    expect(await s.launcher.send({ id: "r1", message: "x" })).toEqual({ ok: false, code: "unavailable", message: 'subagent "r1" is unavailable' });
    expect(await s.launcher.send({ id: "nope", message: "x" })).toMatchObject({ ok: false, code: "unavailable" });
  });
});

describe("forks (phase 2)", () => {
  const SEED: Message[] = [
    { role: "system", content: "LEN SYSTEM PROMPT" },
    { role: "user", content: "Make me a bakery page." },
    { role: "assistant", content: "Done: hero, menu and contact." },
  ];

  it("🔴 a fork's request starts with Len's system prompt, tools and completed turns, byte for byte", async () => {
    const s = setup({ forkSeed: SEED });
    expect(await s.launcher.fork({ description: "Review", prompt: "Review what we built and propose the next step." })).toEqual({ ok: true, id: "r1" });
    await s.settled("r1");
    const first = s.g.seen[0]!;
    expect(first.slice(0, SEED.length)).toEqual(SEED);
    const task = String(first.at(-1)!.content);
    expect(first.at(-1)!.role).toBe("user");
    expect(task.startsWith("Review what we built and propose the next step.")).toBe(true);
    expect(task).toContain("You are a delegated subagent: your permission scope was fixed when you were started");
    expect(task).toContain('Your parent agent id is "len".');
    expect(s.brainTools[0]).toEqual(s.ctx.declarations);
    expect(s.rows.get("r1")).toMatchObject({ forked: true, preset: "general-purpose" });
  });

  it("🔴 in plan mode a fork's request starts with Len's system prompt as he sends it: with the plan section", async () => {
    const s = setup({ forkSeed: SEED, planMode: true });
    await s.launcher.fork({ description: "Review", prompt: "Review it." });
    await s.settled("r1");
    const first = s.g.seen[0]!;
    expect(first[0]).toEqual(withPlanSection(SEED, true)[0]);
    expect(first[0]).not.toEqual(SEED[0]);
    expect(first.slice(1, SEED.length)).toEqual(SEED.slice(1));
  });

  it("a fork whose inherited conversation is over the summary threshold summarizes it before its first call (Len summarizes first only above it)", async () => {
    const LONG: Message[] = [
      { role: "system", content: "LEN SYSTEM PROMPT" },
      { role: "user", content: "Make me a bakery page." },
      { role: "assistant", content: "A".repeat(8000) },
      { role: "user", content: "Add a menu." },
      { role: "assistant", content: "B".repeat(8000) },
    ];
    const s = setup({
      forkSeed: LONG,
      scripts: [dice("SUMMARY OF THE CHAT"), dice("Done")],
      loopExtras: () => ({ compaction: { policy: { thresholdTokens: 4000, retainTokens: 5 }, firstIndex: 2 } }),
    });
    await s.launcher.fork({ description: "Review", prompt: "Review it." });
    await s.settled("r1");
    expect(s.g.seen).toHaveLength(2);
    expect(s.g.seen[1]!.some((m) => m.content.includes("AAAA"))).toBe(false);
    expect(s.g.seen[1]!.some((m) => m.content.includes("SUMMARY OF THE CHAT"))).toBe(true);
    expect(s.rows.get("r1")!.finalText).toBe("Done");
  });

  it("a fork's saved conversation keeps no photos: they travel with its requests, never to the database", async () => {
    const seed: Message[] = [
      { role: "system", content: "LEN SYSTEM PROMPT" },
      { role: "user", content: "Use this photo.", images: [{ mimeType: "image/png", dataBase64: "iVBORw0KGgo=" }] },
      { role: "assistant", content: "Done." },
    ];
    const s = setup({ forkSeed: seed });
    await s.launcher.fork({ description: "a", prompt: "b" });
    const row = await s.settled("r1");
    expect(s.g.seen[0]![1]!.images).toHaveLength(1);
    expect((row.transcript as Message[]).some((m) => m.images)).toBe(false);
    expect((row.transcript as Message[])[0]).toEqual({ role: "user", content: "Use this photo." });
  });

  it("🔴 a fork is refused publish and subagent though they are declared to it", async () => {
    const s = setup({ forkSeed: SEED, scripts: [llama("publish", { subdomain: "x" }), llama("subagent", { description: "a", prompt: "b" }), dice("ok")] });
    await s.launcher.fork({ description: "a", prompt: "b" });
    await s.settled("r1");
    expect(s.ran).toEqual([]);
    for (const i of [1, 2]) {
      expect(s.g.seen[i]!.at(-1)!.functionResponses?.[0]?.response).toMatchObject({ ok: false, error: "This agent does not have that tool." });
    }
  });

  it("a fork woken by Len resumes with Len's system prompt and his declarations", async () => {
    const s = setup({ forkSeed: SEED, scripts: [dice("First"), dice("Second")] });
    await s.launcher.fork({ description: "a", prompt: "b" });
    await s.settled("r1");
    await s.launcher.send({ id: "r1", message: "And the footer?" });
    await s.settled("r1");
    expect(s.g.seen[1]![0]).toEqual({ role: "system", content: "LEN SYSTEM PROMPT" });
    expect(s.g.seen[1]!.slice(1, SEED.length)).toEqual(SEED.slice(1));
    expect(s.brainTools[1]).toEqual(s.ctx.declarations);
  });
});

describe("Len stops and lists his children (phase 2)", () => {
  it("interrupt stops a running child of the current conversation; an idle or foreign one isn't touched", async () => {
    const s = setup({ scripts: [llama("Read", { file_path: "/a" }), dice("never")] });
    s.g.hold();
    await s.launcher.launch({ description: "a", prompt: "b", preset: "general-purpose" });
    expect(await s.launcher.interrupt("r1")).toBe(true);
    s.g.release();
    expect((await s.settled("r1")).status).toBe("aborted");
    expect(await s.launcher.interrupt("r1")).toBe(false);
    expect(await s.launcher.interrupt("nope")).toBe(false);
  });

  it("interrupt leaves alone a live child of an archived conversation", async () => {
    const s = setup({ archived: ["r1"], scripts: [llama("Read", { file_path: "/a" }), dice("Done")] });
    s.g.hold();
    await s.launcher.launch({ description: "a", prompt: "b", preset: "general-purpose" });
    expect(await s.launcher.interrupt("r1")).toBe(false);
    s.g.release();
    expect((await s.settled("r1")).status).toBe("completed");
  });

  it("list: the current conversation's children, running or inactive", async () => {
    const s = setup({ archived: ["r3"], scripts: [dice("Done"), llama("Read", { file_path: "/a" }), dice("Done")] });
    await s.launcher.launch({ description: "First", prompt: "b", preset: "general-purpose" });
    await s.settled("r1");
    s.g.hold();
    await s.launcher.launch({ description: "Second", prompt: "b", preset: "Explore" });
    await s.launcher.launch({ description: "Archived", prompt: "b", preset: "Explore" });
    expect(await s.launcher.list()).toEqual([
      { id: "r1", label: "First", status: "inactive" },
      { id: "r2", label: "Second", status: "running" },
    ]);
    s.g.release();
    await s.settled("r2");
    await s.settled("r3");
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
    // DeepSeek's return guidance closes the task: the child reports to "len" with send_message.
    expect(t.at(-1)).toContain('Your parent agent id is "len". Before you finish, send your result to that agent with send_message');
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

const customTypes = (front = "tools: Read, Write, Edit", body = "Only review this task.") => resolveAgentTypes({ project: [{ name: "reviewer", text: `---\nname: reviewer\ndescription: Reviews\n${front}\n---\n${body}`, updatedAt: new Date(0) }], personal: [] });

describe("launching custom types", () => {
  it("runs with its section and tools, keeping its name on the row, and wakes with them again", async () => {
    const s = setup({ agentTypes: customTypes("tools: Read"), scripts: [llama("Read"), dice("Reviewed.")] });
    expect(await s.launcher.launch({ description: "Review", prompt: "Check.", preset: "reviewer" as never })).toMatchObject({ ok: true });
    await s.settled("r1");
    expect(s.rows.get("r1")?.preset).toBe("reviewer");
    expect(s.brainTools[0].map((d) => d.name)).toEqual(["Read"]);
    expect(s.g.seen[0][0].content).toContain("SUBAGENT — REVIEWER:\nOnly review this task.");
    await s.launcher.send({ id: "r1", message: "Check again." });
    await s.settled("r1");
    expect(s.brainTools[1].map((d) => d.name)).toEqual(["Read"]);
    expect(s.g.seen.at(-1)![0].content).toContain("SUBAGENT — REVIEWER:");
  });
  it("a type with no usable tools is refused without a row or work", async () => {
    const s = setup({ agentTypes: customTypes("tools: publish, missing") });
    expect(await s.launcher.launch({ description: "Review", prompt: "Check.", preset: "reviewer" as never })).toEqual({ ok: false, code: "no_tools", message: 'agent type "reviewer" leaves the subagent no tools to work with' });
    expect(s.rows.size).toBe(0);
    expect(liveCount("p")).toBe(0);
    expect(s.g.seen).toEqual([]);
  });
  it("plan mode makes even a custom writer read-only", async () => {
    const s = setup({ planMode: true, agentTypes: customTypes(), scripts: [llama("Write"), llama("Read"), dice("ok")] });
    await s.launcher.launch({ description: "Review", prompt: "Check.", preset: "reviewer" as never });
    await s.settled("r1");
    expect(s.ran).not.toContain("Write");
    expect(s.sessions[0].readOnly).toBe(true);
  });
  it("a deleted type cannot be restored as general-purpose", async () => {
    const s = setup({ agentTypes: customTypes("tools: Read"), scripts: [dice("ok")] });
    await s.launcher.launch({ description: "Review", prompt: "Check.", preset: "reviewer" as never });
    await s.settled("r1");
    const next = createSubagentLauncher({ ...s.ctx, agentTypes: NO_AGENT_TYPES }, s.io);
    const count = s.g.seen.length;
    expect(await next.send({ id: "r1", message: "Again." })).toMatchObject({ ok: false, message: 'subagent "r1" has no agent preset projection for restoration' });
    expect(s.g.seen).toHaveLength(count);
    expect(liveCount("p")).toBe(0);
  });
  it("omitLenMd leaves the project and person's notes out of its initial messages", async () => {
    const s = setup({ agentTypes: customTypes("tools: Read\nomitLenMd: true"), scripts: [dice("ok")] });
    const launcher = createSubagentLauncher({ ...s.ctx, turnArgs: { ...s.ctx.turnArgs, memoryMessage: "PROJECT NOTES", userMemory: "PERSON NOTES" } }, s.io);
    await launcher.launch({ description: "Review", prompt: "Check.", preset: "reviewer" as never });
    await s.settled("r1");
    expect(JSON.stringify(s.g.seen[0])).not.toMatch(/PROJECT NOTES|PERSON NOTES/);
  });
});

describe("a custom type's effort and call limit", () => {
  it("passes its effort to its brain", async () => {
    const s = setup({ agentTypes: customTypes("tools: Read\neffort: high"), scripts: [dice("ok")] });
    await s.launcher.launch({ description: "Review", prompt: "Check.", preset: "reviewer" });
    await s.settled("r1");
    expect(s.brainEfforts).toEqual(["high"]);
  });
  it("two model calls with tools are followed by a tools-off closing call and turn_limit", async () => {
    const s = setup({ agentTypes: customTypes("tools: Read\nmaxTurns: 2"), scripts: [llama("Read"), llama("Read"), dice("Two pages checked; third left.")] });
    await s.launcher.launch({ description: "Review", prompt: "Check.", preset: "reviewer" });
    const row = await s.settled("r1");
    expect(s.ran).toEqual(["Read", "Read"]);
    expect(s.closeOuts).toHaveLength(1);
    expect(s.closeOuts[0].at(-1)?.content).toBe("You have reached this agent's turn limit. Do not call any more tools: answer now with what you did, what you found and what is left undone.");
    expect(row.status).toBe("turn_limit");
    expect(takeNotices("p")[0].text).toContain("stopped at its turn limit before it finished.");
    expect(row.finalText).toBe("Two pages checked; third left.");
  });
  it("a built-in keeps running without a custom turn limit", async () => {
    const s = setup({ scripts: [llama("Read"), llama("Read"), llama("Read"), dice("Done")] });
    await s.launcher.launch({ description: "Read", prompt: "Check.", preset: "general-purpose" });
    expect((await s.settled("r1")).status).toBe("completed");
    expect(s.closeOuts).toEqual([]);
  });
});

async function preloadSkills() {
  const { resolveSkills } = await import("@/lib/agent/skills/registry");
  return resolveSkills({ bundled: [], project: ["alpha", "beta", "hidden"].map((name) => ({ name, text: `---\nname: ${name}\ndescription: ${name}\n${name === "hidden" ? "disable-model-invocation: true\n" : ""}---\nFULL ${name} INSTRUCTIONS.`, updatedAt: new Date(0) })), personal: [] });
}

describe("skills preloaded in a custom child", () => {
  it("loads their full bodies in the listed order immediately before the task, without adding them on a wake", async () => {
    const s = setup({ agentTypes: customTypes("tools: Read, skill\nskills: beta, alpha"), skills: await preloadSkills(), scripts: [dice("ok")] });
    await s.launcher.launch({ description: "Review", prompt: "THE TASK", preset: "reviewer" });
    await s.settled("r1");
    const first = s.g.seen[0];
    expect(first.at(-3)?.content).toContain('skill_content name="beta"');
    expect(first.at(-3)?.content).toContain("FULL beta INSTRUCTIONS.");
    expect(first.at(-2)?.content).toContain('skill_content name="alpha"');
    expect(first.at(-1)?.content).toContain("THE TASK");
    await s.launcher.send({ id: "r1", message: "Again." });
    await s.settled("r1");
    expect(s.g.seen.at(-1)!.filter((m) => m.content.startsWith('<skill_content name="beta"'))).toHaveLength(1);
  });
  it("a preloaded skill already counts as loaded when the child invokes it", async () => {
    const { toolSkill, alreadyLoaded } = await import("@/lib/agent/skills/tool");
    const s = setup({ agentTypes: customTypes("tools: Read, skill\nskills: alpha"), skills: await preloadSkills(), scripts: [llama("skill", { name: "alpha" }), dice("ok")] });
    const answers: unknown[] = [];
    s.io.runTool = async (session, _deps, _name, args) => { const out = await toolSkill(session, args); answers.push(out.response); return out; };
    await s.launcher.launch({ description: "Review", prompt: "Check.", preset: "reviewer" });
    await s.settled("r1");
    expect(answers).toEqual([{ ok: true, tool_result: alreadyLoaded("alpha") }]);
  });
  it("skips and logs missing or hidden skills, and all skills when disabled, without telling the model", async () => {
    for (const disabled of [false, true]) {
      vi.stubEnv("OPENLEN_SKILLS", disabled ? "0" : "1");
      forgetAllSubagents();
      const s = setup({ agentTypes: customTypes("tools: Read\nskills: missing, hidden, alpha"), skills: await preloadSkills(), scripts: [dice("ok")] });
      await s.launcher.launch({ description: "Review", prompt: "Check.", preset: "reviewer" });
      await s.settled("r1");
      const text = JSON.stringify(s.g.seen[0]);
      expect(text).not.toMatch(/FULL hidden|skill_content.*missing/);
      expect(s.logs.join("\n")).toContain("missing");
      expect(s.logs.join("\n")).toContain("hidden");
      if (disabled) { expect(text).not.toContain("FULL alpha"); expect(s.logs.join("\n")).toContain("alpha"); }
    }
  });
});

it("a child launched by a fork skill knows the skill it is running, also after a wake", async () => {
  const s = setup({ scripts: [llama("Read"), dice("ok")] });
  await s.launcher.launch({ description: "summarize", prompt: "Skill instructions.", preset: "general-purpose", fromSkill: "summarize" } as never);
  await s.settled("r1");
  expect(s.sessions[0].runningSkill).toBe("summarize");
  await s.launcher.send({ id: "r1", message: "Again." });
  await s.settled("r1");
  // Force a tool in the next activation so the session becomes observable.
  expect((s.rows.get("r1")!.transcript as (Message & { runningSkill?: string })[]).some((m) => m.runningSkill === "summarize")).toBe(true);
});

it("refreshes a deleted custom type before waking its idle run", async () => {
  const s = setup({ agentTypes: customTypes("tools: Read"), scripts: [dice("ok")] });
  let current = s.ctx.agentTypes;
  let next = current;
  const launcher = createSubagentLauncher({ ...s.ctx, get agentTypes() { return current; }, refreshAgentTypes: async () => { current = next; } } as LaunchContext, s.io);
  await launcher.launch({ description: "Review", prompt: "Check.", preset: "reviewer" });
  await s.settled("r1");
  next = NO_AGENT_TYPES;
  const calls = s.g.seen.length;
  expect(await launcher.send({ id: "r1", message: "Again." })).toMatchObject({ ok: false, message: 'subagent "r1" has no agent preset projection for restoration' });
  expect(s.g.seen).toHaveLength(calls);
});

it("a turn-limited close-out keeps its closing report after an earlier message to Len", async () => {
  const s = setup({ agentTypes: customTypes("tools: send_message\nmaxTurns: 1"), scripts: [llama("send_message", { agent_id: "len", message: "Initial finding." }), dice("Another file is still unchecked.")] });
  await s.launcher.launch({ description: "Review", prompt: "Check.", preset: "reviewer" });
  expect((await s.settled("r1")).status).toBe("turn_limit");
  expect(takeNotices("p").at(-1)!.text).toContain("Its closing message:\nAnother file is still unchecked.");
});

it("launching len-office preloads office and the project's brand", async () => {
  const { resolveSkills } = await import("@/lib/agent/skills/registry");
  const skills = resolveSkills({ bundled: [], project: ["office", "brand"].map((name) => ({ name, text: `---\nname: ${name}\ndescription: ${name}\n---\nFULL ${name} INSTRUCTIONS.`, updatedAt: new Date(0) })), personal: [] });
  const s = setup({ agentTypes: resolveAgentTypes({ project: [], personal: [] }), skills, scripts: [dice("ok")] });
  await s.launcher.launch({ description: "Menu", prompt: "Make the Word.", preset: "len-office" });
  await s.settled("r1");
  const first = s.g.seen[0];
  expect(first[0]!.content).toContain("SUBAGENT — LEN-OFFICE:");
  expect(first.some((m) => m.content.includes('skill_content name="office"'))).toBe(true);
  expect(first.some((m) => m.content.includes('skill_content name="brand"'))).toBe(true);
  expect(first.some((m) => m.content.startsWith("Already loaded skills: office, brand."))).toBe(true);
});

it("tells a child which skills are already loaded before its task, without listing skipped skills", async () => {
  const s = setup({ agentTypes: customTypes("tools: Read, skill\nskills: beta, missing, hidden, alpha"), skills: await preloadSkills(), scripts: [dice("ok")] });
  await s.launcher.launch({ description: "Review", prompt: "THE TASK", preset: "reviewer" });
  await s.settled("r1");
  const notice = s.g.seen[0].find((m) => m.content.startsWith("Already loaded skills:"));
  expect(notice?.content).toBe("Already loaded skills: beta, alpha. Their full instructions follow below and are active for this task. Follow them directly; do not call skill to load them again.");
  expect(s.g.seen[0].indexOf(notice!)).toBeLessThan(s.g.seen[0].length - 1);
});

const until = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 2));
};

describe("an isolated child (phase 4)", () => {
  it("a retained dirty copy cannot be orphaned by waking it in another copy", async () => {
    const s = setup({ scripts: [dice("Done")], worktree: { outcome: { state: "kept", branch: "b", copyId: "copy-1" } } });
    await s.launcher.launch({ description: "Edit", prompt: "Edit", preset: "general-purpose", isolation: "worktree" });
    await s.settled("r1");
    expect(await s.launcher.send({ id: "r1", message: "more" })).toMatchObject({ ok: false, code: "unavailable" });
    expect(s.worktreesMade).toHaveLength(1);
  });
  it("does not make a copy if creating its recovery row fails", async () => {
    const s = setup();
    s.io.store.createRun = async () => { throw new Error("row failed"); };
    await expect(s.launcher.launch({ description: "Edit", prompt: "Edit", preset: "general-purpose", isolation: "worktree" })).rejects.toThrow("row failed");
    expect(s.worktreesMade).toHaveLength(0);
    expect(liveCount("p")).toBe(0);
  });
  it("does not start and discards the unused copy if its metadata fails", async () => {
    const s = setup();
    s.io.store.setWorktree = async () => { throw new Error("metadata failed"); };
    await expect(s.launcher.launch({ description: "Edit", prompt: "Edit", preset: "general-purpose", isolation: "worktree" })).rejects.toThrow("metadata failed");
    expect(s.g.seen).toHaveLength(0);
    expect(s.finishes).toHaveLength(1);
    expect(liveCount("p")).toBe(0);
  });
  it("stays running through finalization and durably keeps messages received there", async () => {
    const s = setup({ scripts: [dice("Done")] });
    let releaseFinish = () => {};
    const gate = new Promise<void>(r => { releaseFinish = r; });
    let finishing = false;
    s.io.finishWorktree = async () => { finishing = true; await gate; return { outcome: { state: "nothing" }, changes: null }; };
    await s.launcher.launch({ description: "Edit", prompt: "Edit", preset: "general-purpose", isolation: "worktree" });
    await until(() => finishing);
    expect(s.rows.get("r1")?.status).toBe("running");
    const nextTurnLauncher = createSubagentLauncher(s.ctx, s.io);
    await nextTurnLauncher.send({ id: "r1", message: "Next task received during merge" });
    expect(JSON.stringify(s.rows.get("r1")?.transcript ?? s.saves.at(-1)?.transcript)).toContain("Next task received during merge");
    releaseFinish();
    await s.settled("r1");
    expect(JSON.stringify(s.rows.get("r1")?.transcript)).toContain("Next task received during merge");
    expect(takeNotices("p").at(-1)?.text).toContain("saved for its next activation");
  });
  it("an isolated child works in its copy", async () => {
    const s = setup({ scripts: [llama("Read", { file_path: "/src/a.ts" }), dice("Done")] });
    await s.launcher.launch({ description: "Edit a", prompt: "Change a.", preset: "general-purpose", isolation: "worktree" });
    await s.settled("r1");
    expect(s.worktreesMade).toEqual([{ parentId: "p", ownerId: "owner", runId: "r1" }]);
    expect(s.sessions.length).toBeGreaterThan(0);
    for (const session of s.sessions) expect(session).toMatchObject({ projectId: "copy-1", parentProjectId: "p" });
    expect(String(s.g.seen[0].at(-1)!.content).endsWith(isolationLine("worktree-agent-r1"))).toBe(true);
    expect(s.rows.get("r1")).toMatchObject({ worktreeCopyId: "copy-1", worktreeBranch: "worktree-agent-r1" });
  });

  it("its outcome reaches Len", async () => {
    const s = setup({ scripts: [dice("Done")] });
    await s.launcher.launch({ description: "Edit a", prompt: "Change a.", preset: "general-purpose", isolation: "worktree" });
    await s.settled("r1");
    await until(() => s.events.at(-1)?.status !== "running");
    expect(s.finishes).toHaveLength(1);
    const f = s.finishes[0]!;
    // After its terminal closed, and before its notice and its slot.
    expect(f.terminalsBefore).toContain("close r1");
    expect(f.noticesBefore).toBe(0);
    expect(f.liveBefore).toBe(true);
    expect(f.session).toMatchObject({ projectId: "p" });
    expect(f.session.parentProjectId).toBeUndefined();
    expect(s.rows.get("r1")!.worktreeOutcome).toEqual({ state: "brought", files: ["/src/a.ts"] });
    expect(takeNotices("p").at(-1)!.text.endsWith("\n\nIts changes are now in your files: /src/a.ts.")).toBe(true);
    expect(s.events.at(-1)).toMatchObject({ status: "completed", worktree: { state: "brought" } });
  });

  it("a stopped isolated child still brings", async () => {
    const s = setup({ scripts: [llama("Read"), dice("Done")] });
    s.g.hold();
    await s.launcher.launch({ description: "Edit a", prompt: "Change a.", preset: "general-purpose", isolation: "worktree" });
    await until(() => s.g.seen.length > 0);
    stop("r1");
    s.g.release();
    expect((await s.settled("r1")).status).toBe("aborted");
    await until(() => s.finishes.length > 0);
    expect(s.finishes).toHaveLength(1);
  });

  it("a read-only child ignores isolation", async () => {
    const s = setup({ scripts: [dice("Found")] });
    await s.launcher.launch({ description: "Find", prompt: "Where?", preset: "Explore", isolation: "worktree" });
    await s.settled("r1");
    expect(s.worktreesMade).toEqual([]);
    expect(s.logs.join("\n")).toContain("isolation ignored: read-only");
    forgetAllSubagents();
    const p = setup({ planMode: true, scripts: [dice("Planned")] });
    await p.launcher.launch({ description: "Plan", prompt: "How?", preset: "general-purpose", isolation: "worktree" });
    await p.settled("r1");
    expect(p.worktreesMade).toEqual([]);
  });

  it("without git it runs in the folder", async () => {
    vi.stubEnv("OPENLEN_GIT", "0");
    const s = setup({ scripts: [dice("Done")] });
    await s.launcher.launch({ description: "Edit a", prompt: "Change a.", preset: "general-purpose", isolation: "worktree" });
    await s.settled("r1");
    expect(s.worktreesMade).toEqual([]);
    expect(s.logs.join("\n")).toContain("git disabled");
  });

  it("a type's file can ask for it", async () => {
    const s = setup({ agentTypes: customTypes("tools: Read, Write\nisolation: worktree"), scripts: [dice("Done")] });
    await s.launcher.launch({ description: "Review", prompt: "Check.", preset: "reviewer" });
    await s.settled("r1");
    expect(s.worktreesMade).toHaveLength(1);
  });

  // Like Claude Code's «Failed to create worktree», it says what failed and suggests nothing: «start it without
  // isolation» sent Len to write in the shared folder, next to the children isolation was keeping apart.
  it("a copy that can't be made refuses the launch, without sending Len to the shared folder", async () => {
    const s = setup({ worktree: { fail: true }, scripts: [dice("Done")] });
    expect(await s.launcher.launch({ description: "Edit a", prompt: "Change a.", preset: "general-purpose", isolation: "worktree" })).toEqual({
      ok: false,
      code: "worktree_failed",
      message: "The subagent's own copy of the project could not be made, so it did not start.",
    });
    expect(liveCount("p")).toBe(0);
    expect((await s.launcher.launch({ description: "Edit a", prompt: "Change a.", preset: "general-purpose" })).ok).toBe(true);
  });

  it("a fork can be isolated", async () => {
    const s = setup({ forkSeed: [{ role: "system", content: "LEN SYSTEM PROMPT" }], scripts: [dice("Done")] });
    await s.launcher.fork({ description: "Fork", prompt: "Go on.", isolation: "worktree" });
    await s.settled("r1");
    expect(s.worktreesMade).toHaveLength(1);
    expect(String(s.g.seen[0].at(-1)!.content)).toContain(isolationLine("worktree-agent-r1"));
  });

  it("waking an isolated child makes a new copy", async () => {
    const s = setup({ scripts: [dice("Done")] });
    await s.launcher.launch({ description: "Edit a", prompt: "Change a.", preset: "general-purpose", isolation: "worktree" });
    await s.settled("r1");
    await until(() => s.finishes.length > 0 && !isLive("p", "r1"));
    expect((await s.launcher.send({ id: "r1", message: "Also b." })).ok).toBe(true);
    await s.settled("r1");
    expect(s.worktreesMade).toHaveLength(2);
    const woken = s.g.seen.at(-1)!;
    expect(woken.findIndex((m) => String(m.content).startsWith(isolationLine("worktree-agent-r1-2")))).toBeGreaterThan(0);
  });

  it("a brought change undoes with its turn", async () => {
    const changes = { before: { "/src/a.ts": "old" }, after: { "/src/a.ts": "new" } };
    const s = setup({ turnOpen: false, worktree: { changes }, scripts: [dice("Done")] });
    await s.launcher.launch({ description: "Edit a", prompt: "Change a.", preset: "general-purpose", isolation: "worktree" });
    await s.settled("r1");
    await until(() => s.changes.length > 0);
    expect(s.changes).toEqual([["p", "row-1", changes.before, changes.after]]);
  });
});
