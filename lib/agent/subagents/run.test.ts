// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import type { Message, StreamEvent } from "@/lib/ai-gateway";
import type { BuildAgentMessagesArgs } from "@/lib/agent/context";
import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";

import { settlementNotice } from "./notice";
import { withPlanSection } from "@/lib/agent/plan-mode";

import { forgetAllSubagents, isLive, liveCount, noticeTurnPending, reserve, sendToRun, stop, takeNotices } from "./registry";
import { childMessages, createSubagentLauncher, type LaunchContext, type RunnerIO, type SubagentEvent } from "./run";
import type { ConversationRun, SubagentRunRow } from "./store";
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

function setup(
  o: {
    scripts?: StreamEvent[][];
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
  const browsersClosed: AgentSession[] = [];
  const reopens: [string, string][] = [];
  const snapshots = [...(o.snapshots ?? [])];
  let n = 0;
  const io: RunnerIO = {
    brain: (tools, _runId, signal) => {
      brainSignals.push(signal);
      brainTools.push(tools);
      return { openStream: g.abrir, closeOut: () => g.abrir([]), modelId: "m", lastProvider: () => "deepinfra" };
    },
    runTool: async (session, _deps, name, args): Promise<ToolOutcome> => {
      if (!sessions.includes(session)) sessions.push(session);
      ran.push(name);
      if (name === "skill") session.loadedSkills?.add(String(args.name));
      const touched = o.touched?.[name];
      return {
        response: { ok: true, tool_result: "1\tx" },
        action: { tool: name, ok: true, summary: String(args.file_path ?? args.name ?? "") },
        ...(touched ? { ficherosTocados: touched.map((ruta) => ({ ruta, versionPrevia: null })) } : {}),
      };
    },
    store: {
      createRun: async (r) => void rows.set(r.id, { ...r, status: "running", toolUses: 0, durationMs: null, chargedCenticredits: 0, actions: [], transcript: null }),
      saveProgress: async () => {},
      settleRun: async (id, s) => void rows.set(id, { ...rows.get(id), ...s }),
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
    planMode: o.planMode ?? false,
    turnArgs: TURN_ARGS,
    lenSystemPrompt: "LEN SYSTEM PROMPT",
    forkSeed: o.forkSeed ?? [],
    declarations: ["Read", "Edit", "Write", "skill", "publish", "subagent", "send_message", "subagent_fork", "interrupt_agent", "list_agents"].map((name) => ({ name })),
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
  return { g, io, rows, reopens, sessions, ran, charges, terminals, noticeTurns, changes, events, brainSignals, brainTools, browsersClosed, ctx, launcher, settled, setLen: (v: number) => (lenSpent = v) };
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

  it("a child addressing anyone but len is refused with DeepSeek's text, and nothing reaches Len", async () => {
    const s = setup({ scripts: [llama("send_message", { agent_id: "r9", message: "psst" }), dice("ok")] });
    await s.launcher.launch({ description: "a", prompt: "b", preset: "Explore" });
    await s.settled("r1");
    expect(s.g.seen[1]!.at(-1)!.functionResponses?.[0]?.response).toMatchObject({
      ok: false,
      error: 'agent "r1" is not a resident continuable child and cannot send to parent "r9"',
    });
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
