// @vitest-environment node
//
// WAKING, AND WHAT A RESTART LEFT (spec local 2026-11-21-len-y-el-agente-conversan, §2 and decisions 9 and 10): a stored
// message starts the recipient's turn from the server — Len's, as the owner, in the project; the agent's, as itself, in
// its home — and the turn CLAIMS what is waiting when it starts, so two messages written before it began are read by one
// turn. A turn that can't run (no credits) gives its messages back; a restart wakes what was on its way, once per
// recipient. Against an in-memory mailbox and injected launchers: nothing here reaches a database or a model.
import { describe, expect, it, vi } from "vitest";

import { framingForAgent, framingForLen, rideAlongForLen } from "./policy";
import type { AgentLenMessage, HeldReason } from "./store";
import { resumeAgentLenMessages, wakeRecipient, type WakeAgent, type WakeDeps } from "./wake";

const NOW = new Date("2026-11-21T12:00:00.000Z");

/** The mailbox as the real one decides it (store.ts): what a turn claims, what a failed one gives back. */
function fakeMailbox(initial: AgentLenMessage[] = []) {
  const rows: AgentLenMessage[] = [...initial];
  const calls = {
    claims: [] as { who: string; rowId: string }[],
    released: [] as { ids: readonly string[]; reason: string }[],
    held: [] as { ids: readonly string[]; reason: HeldReason }[],
  };
  const set = (id: string, patch: Partial<AgentLenMessage>) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i >= 0) rows[i] = { ...rows[i]!, ...patch };
  };
  const claim = (pick: (r: AgentLenMessage) => boolean, rowId: string, at: Date) => {
    const taken = rows.filter((r) => pick(r) && ["pending", "delivering", "held"].includes(r.status)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const r of taken) set(r.id, { status: "delivered", deliveredAt: at });
    return taken.map((r) => ({ ...r, status: "delivered" as const, deliveredAt: at }));
  };
  const store = {
    markDelivering: vi.fn(async (id: string, at: Date) => {
      const r = rows.find((x) => x.id === id);
      if (r?.status === "pending") set(id, { status: "delivering", deliveringAt: at });
    }),
    claimForLen: vi.fn(async (projectId: string, rowId: string, at: Date) => {
      calls.claims.push({ who: `len:${projectId}`, rowId });
      return claim((r) => r.direction === "to_len" && r.projectId === projectId, rowId, at);
    }),
    claimForAgent: vi.fn(async (assistantId: string, rowId: string, at: Date) => {
      calls.claims.push({ who: `agent:${assistantId}`, rowId });
      return claim((r) => r.direction === "to_agent" && r.assistantId === assistantId, rowId, at);
    }),
    releaseToHeld: vi.fn(async (ids: readonly string[], reason: "no_credits") => {
      calls.released.push({ ids, reason });
      for (const id of ids) if (rows.find((r) => r.id === id)?.status === "delivered") set(id, { status: "held", heldReason: reason, deliveredAt: null });
    }),
    hold: vi.fn(async (ids: readonly string[], reason: HeldReason) => {
      calls.held.push({ ids, reason });
      for (const id of ids) if (["pending", "delivering"].includes(rows.find((r) => r.id === id)?.status ?? "")) set(id, { status: "held", heldReason: reason });
    }),
    toResume: vi.fn(async () => rows.filter((r) => r.status === "delivering").sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())),
  };
  return { rows, store, calls, statusOf: (id: string) => rows.find((r) => r.id === id)?.status };
}

let seq = 0;
function msg(over: Partial<AgentLenMessage> & Pick<AgentLenMessage, "id" | "direction">): AgentLenMessage {
  seq += 1;
  return {
    assistantId: "a1",
    projectId: "p1",
    text: `text of ${over.id}`,
    ownerWords: null,
    status: "pending",
    heldReason: null,
    createdAt: new Date(NOW.getTime() - 60_000 + seq * 1000),
    deliveringAt: null,
    deliveredAt: null,
    ...over,
  };
}

const AGENTS: Record<string, WakeAgent> = {
  a1: { id: "a1", personId: "person-1", name: "Finanzas", homeProjectId: "home-a1", locale: "es" },
  a2: { id: "a2", personId: "person-1", name: "Ventas", homeProjectId: "home-a2", locale: null },
};
const TITLES: Record<string, string | null> = { p1: "Presupuesto", p2: "Informe", p3: null, "home-a1": "Espacio", "home-a2": "Espacio" };

type LenLaunch = Parameters<WakeDeps["launchForLen"]>[0];
type AgentLaunch = Parameters<WakeDeps["launchForAgent"]>[0];

function setup(initial: AgentLenMessage[] = [], over: Partial<WakeDeps> = {}) {
  const mailbox = fakeMailbox(initial);
  const lenLaunches: LenLaunch[] = [];
  const lenOptions: unknown[] = [];
  const agentLaunches: AgentLaunch[] = [];
  let rowSeq = 0;
  const deps: WakeDeps = {
    store: mailbox.store,
    agentOf: vi.fn(async (id: string) => AGENTS[id] ?? null),
    titlesOf: vi.fn(async (ids: readonly string[]) => new Map(ids.filter((id) => id in TITLES).map((id) => [id, TITLES[id] ?? null] as const))),
    zoneOf: vi.fn(async () => "Europe/Madrid"),
    launchForLen: (p, o) => {
      lenLaunches.push(p);
      lenOptions.push(o);
    },
    launchForAgent: (p) => void agentLaunches.push(p),
    now: () => NOW,
    newRowId: () => `row-${++rowSeq}`,
    enabled: () => true,
    ...over,
  };
  return { ...mailbox, deps, lenLaunches, lenOptions, agentLaunches };
}

const CTX_A1 = { homeProjectId: "home-a1", agentName: "Finanzas" };

describe("waking an agent: Len wrote to it", () => {
  it("🔴 an idle agent is woken in its home, as itself, with Len's message framed", async () => {
    const m = msg({ id: "m1", direction: "to_agent", text: "What is the invoice color?" });
    const t = setup([m]);
    const out = await wakeRecipient(m, CTX_A1, t.deps);
    expect(out).toBe("waking");
    expect(t.statusOf("m1")).toBe("delivering");
    expect(t.lenLaunches).toEqual([]);
    expect(t.agentLaunches).toHaveLength(1);
    const p = t.agentLaunches[0]!;
    // As its person, in its home, with the agent's id in the body: the road its scheduled tasks take.
    expect(p).toMatchObject({
      userId: "person-1",
      projectId: "home-a1",
      texto: "What is the invoice color?",
      timeZone: "Europe/Madrid",
      locale: "es",
      filaId: "row-1",
      extraBody: { assistantId: "a1" },
      origin: { kind: "len-message", projectId: "p1", projectTitle: "Presupuesto" },
    });
    // The messages are claimed when the turn STARTS, by its own chat row.
    expect(t.store.claimForAgent).not.toHaveBeenCalled();
    const resolved = await p.resolveAtStart!();
    expect(t.calls.claims).toEqual([{ who: "agent:a1", rowId: "row-1" }]);
    expect(t.store.claimForAgent).toHaveBeenCalledWith("a1", "row-1", NOW);
    expect(resolved).toEqual({
      framing: framingForAgent({ projectTitle: "Presupuesto", projectId: "p1", messages: [{ text: "What is the invoice color?" }] }),
      origin: { kind: "len-message", projectId: "p1", projectTitle: "Presupuesto" },
    });
    expect(t.statusOf("m1")).toBe("delivered");
  });

  it("falls back to the project's id when it has no title", async () => {
    const m = msg({ id: "m1", direction: "to_agent", projectId: "p3" });
    const t = setup([m]);
    await wakeRecipient(m, CTX_A1, t.deps);
    const p = t.agentLaunches[0]!;
    expect(p.origin).toEqual({ kind: "len-message", projectId: "p3", projectTitle: "p3" });
    expect((await p.resolveAtStart!())?.framing).toContain("«p3» (id: p3)");
  });

  it("falls back to «en» and UTC when it knows neither the agent's language nor the person's zone", async () => {
    const m = msg({ id: "m1", direction: "to_agent", assistantId: "a2" });
    const t = setup([m], {
      zoneOf: async () => {
        throw new Error("no prefs");
      },
    });
    await wakeRecipient(m, { homeProjectId: "home-a2", agentName: "Ventas" }, t.deps);
    expect(t.agentLaunches[0]).toMatchObject({ timeZone: "UTC", locale: "en", projectId: "home-a2", extraBody: { assistantId: "a2" } });
  });

  it("frames each project's messages with its own title and id when the claim spans several", async () => {
    const m1 = msg({ id: "m1", direction: "to_agent", projectId: "p1", text: "about the budget" });
    const m2 = msg({ id: "m2", direction: "to_agent", projectId: "p2", text: "about the report" });
    const m3 = msg({ id: "m3", direction: "to_agent", projectId: "p1", text: "more on the budget" });
    const t = setup([m1, m2, m3]);
    await wakeRecipient(m1, CTX_A1, t.deps);
    const resolved = await t.agentLaunches[0]!.resolveAtStart!();
    expect(resolved?.framing).toBe(
      [
        framingForAgent({ projectTitle: "Presupuesto", projectId: "p1", messages: [{ text: "about the budget" }, { text: "more on the budget" }] }),
        framingForAgent({ projectTitle: "Informe", projectId: "p2", messages: [{ text: "about the report" }] }),
      ].join("\n\n"),
    );
    // The row is labelled from the oldest message.
    expect(resolved?.origin).toEqual({ kind: "len-message", projectId: "p1", projectTitle: "Presupuesto" });
  });
});

describe("waking Len: an agent wrote to him", () => {
  it("🔴 Len is woken in the project as the owner, labelled from the agent", async () => {
    const m = msg({ id: "m1", direction: "to_len", text: "The invoice goes in blue.", ownerWords: "make it blue" });
    const t = setup([m]);
    const out = await wakeRecipient(m, CTX_A1, t.deps);
    expect(out).toBe("waking");
    expect(t.statusOf("m1")).toBe("delivering");
    expect(t.agentLaunches).toEqual([]);
    expect(t.lenLaunches).toHaveLength(1);
    const p = t.lenLaunches[0]!;
    expect(p).toMatchObject({
      userId: "person-1",
      projectId: "p1",
      texto: "The invoice goes in blue.",
      timeZone: "Europe/Madrid",
      locale: "es",
      filaId: "row-1",
      origin: { kind: "assistant", assistantId: "a1", assistantName: "Finanzas", message: true },
    });
    // Len's turn is Len's: nothing in the body says it is the agent's.
    expect(p.extraBody).toBeUndefined();
    // And a turn that read the message and wrote nothing is a turn that ran, not one that didn't.
    expect(t.lenOptions).toEqual([{ quietWhenNoReply: true }]);
    const resolved = await p.resolveAtStart!();
    expect(t.store.claimForLen).toHaveBeenCalledWith("p1", "row-1", NOW);
    // One of the messages it claimed carries the owner's words: the route lets this turn do what they ask (I2).
    expect(resolved).toEqual({
      framing: framingForLen({ agentName: "Finanzas", messages: [{ text: "The invoice goes in blue.", ownerWords: "make it blue" }] }),
      origin: { kind: "assistant", assistantId: "a1", assistantName: "Finanzas", message: true, withOwnerWords: true },
    });
  });

  // Final review, I2: what the route needs to know of the claim — whether any message carries the owner's words — rides
  // in the origin the turn starts with; without it, the turn refuses what needs them (lib/assistants/messages/woken.ts).
  it("🔴 with no owner words in any claimed message, the origin says nothing of them", async () => {
    const m1 = msg({ id: "m1", direction: "to_len", text: "The invoice is ready." });
    const m2 = msg({ id: "m2", direction: "to_len", assistantId: "a2", text: "So is the report.", ownerWords: "" });
    const t = setup([m1, m2]);
    await wakeRecipient(m1, CTX_A1, t.deps);
    const resolved = await t.lenLaunches[0]!.resolveAtStart!();
    expect(resolved?.origin).toEqual({ kind: "assistant", assistantId: "a1", assistantName: "Finanzas", message: true });
  });

  it("frames each agent's messages under its own name when two wrote before the turn started", async () => {
    const m1 = msg({ id: "m1", direction: "to_len", assistantId: "a1", text: "from finanzas" });
    const m2 = msg({ id: "m2", direction: "to_len", assistantId: "a2", text: "from ventas", ownerWords: "the owner's words" });
    const t = setup([m1, m2]);
    await wakeRecipient(m1, CTX_A1, t.deps);
    const resolved = await t.lenLaunches[0]!.resolveAtStart!();
    expect(resolved?.framing).toBe(
      rideAlongForLen([
        { agentName: "Finanzas", messages: [{ text: "from finanzas", ownerWords: null }] },
        { agentName: "Ventas", messages: [{ text: "from ventas", ownerWords: "the owner's words" }] },
      ]),
    );
    // Ventas's message carries the owner's words: one is enough.
    expect(resolved?.origin).toEqual({ kind: "assistant", assistantId: "a1", assistantName: "Finanzas", message: true, withOwnerWords: true });
  });
});

describe("two messages, one turn", () => {
  it("🔴 two messages before the turn starts are read by one turn", async () => {
    const m1 = msg({ id: "m1", direction: "to_len", text: "first" });
    const m2 = msg({ id: "m2", direction: "to_len", text: "second" });
    const t = setup([m1, m2]);
    await wakeRecipient(m1, CTX_A1, t.deps);
    await wakeRecipient(m2, CTX_A1, t.deps);
    expect(t.lenLaunches).toHaveLength(2);
    // The first turn to start reads both; the second finds nothing left, and does not run.
    const first = await t.lenLaunches[0]!.resolveAtStart!();
    expect(first?.framing).toContain("first");
    expect(first?.framing).toContain("second");
    expect(await t.lenLaunches[1]!.resolveAtStart!()).toBeNull();
    expect(t.rows.map((r) => r.status)).toEqual(["delivered", "delivered"]);
  });

  it("the same for an agent", async () => {
    const m1 = msg({ id: "m1", direction: "to_agent", text: "first" });
    const m2 = msg({ id: "m2", direction: "to_agent", text: "second" });
    const t = setup([m1, m2]);
    await wakeRecipient(m1, CTX_A1, t.deps);
    await wakeRecipient(m2, CTX_A1, t.deps);
    expect((await t.agentLaunches[0]!.resolveAtStart!())?.framing).toMatch(/first[\s\S]*second/);
    expect(await t.agentLaunches[1]!.resolveAtStart!()).toBeNull();
  });
});

describe("a turn that couldn't run", () => {
  it("🔴 a turn that couldn't run leaves its messages held (no credits)", async () => {
    const m1 = msg({ id: "m1", direction: "to_len", text: "first" });
    const m2 = msg({ id: "m2", direction: "to_len", text: "second" });
    const t = setup([m1, m2]);
    await wakeRecipient(m1, CTX_A1, t.deps);
    const p = t.lenLaunches[0]!;
    await p.resolveAtStart!();
    await p.fail({ motivo: "you ran out of credits", code: "no_credits" }, false);
    // Only what this turn's own claim returned goes back, as held: they wait for the recipient's next turn.
    expect(t.calls.released).toEqual([{ ids: ["m1", "m2"], reason: "no_credits" }]);
    expect(t.calls.held).toEqual([]);
    expect(t.rows.map((r) => [r.status, r.heldReason])).toEqual([
      ["held", "no_credits"],
      ["held", "no_credits"],
    ]);
  });

  it("gives back only the messages its own claim returned, never another turn's", async () => {
    const m1 = msg({ id: "m1", direction: "to_agent" });
    const other = msg({ id: "m9", direction: "to_agent", assistantId: "a2", status: "delivered", deliveredAt: NOW });
    const t = setup([m1, other]);
    await wakeRecipient(m1, CTX_A1, t.deps);
    const p = t.agentLaunches[0]!;
    await p.resolveAtStart!();
    await p.fail({ motivo: "x", code: "no_credits" }, false);
    expect(t.calls.released).toEqual([{ ids: ["m1"], reason: "no_credits" }]);
    expect(t.statusOf("m9")).toBe("delivered");
  });

  it("a turn that failed before it started, with nothing claimed, holds the message that woke it", async () => {
    const m = msg({ id: "m1", direction: "to_agent" });
    const t = setup([m]);
    await wakeRecipient(m, CTX_A1, t.deps);
    await t.agentLaunches[0]!.fail(null, false);
    expect(t.calls.released).toEqual([]);
    expect(t.calls.held).toEqual([{ ids: ["m1"], reason: "no_credits" }]);
    expect(t.statusOf("m1")).toBe("held");
  });

  it("a turn cut in the middle has read its messages: nothing goes back", async () => {
    const m = msg({ id: "m1", direction: "to_len" });
    const t = setup([m]);
    await wakeRecipient(m, CTX_A1, t.deps);
    const p = t.lenLaunches[0]!;
    await p.resolveAtStart!();
    await p.fail({ motivo: "cut" }, true);
    expect(t.calls.released).toEqual([]);
    expect(t.calls.held).toEqual([]);
    expect(t.statusOf("m1")).toBe("delivered");
  });
});

describe("the waker's own failures", () => {
  it("an agent that no longer exists wakes nothing and the message stays as it was", async () => {
    const m = msg({ id: "m1", direction: "to_len", assistantId: "gone" });
    const t = setup([m]);
    await expect(wakeRecipient(m, CTX_A1, t.deps)).rejects.toThrow(/no longer exists/);
    expect(t.lenLaunches).toEqual([]);
    expect(t.agentLaunches).toEqual([]);
    expect(t.statusOf("m1")).toBe("pending");
  });
});

describe("what a restart left", () => {
  it("a restart wakes what was being delivered, once per recipient", async () => {
    const rows = [
      msg({ id: "m1", direction: "to_agent", assistantId: "a1", projectId: "p1", status: "delivering", deliveringAt: NOW }),
      msg({ id: "m2", direction: "to_agent", assistantId: "a1", projectId: "p2", status: "delivering", deliveringAt: NOW }),
      msg({ id: "m3", direction: "to_len", assistantId: "a1", projectId: "p1", status: "delivering", deliveringAt: NOW }),
      msg({ id: "m4", direction: "to_len", assistantId: "a2", projectId: "p1", status: "delivering", deliveringAt: NOW }),
      msg({ id: "m5", direction: "to_len", assistantId: "a2", projectId: "p2", status: "delivering", deliveringAt: NOW }),
      // Held ones never wake anything by themselves.
      msg({ id: "m6", direction: "to_agent", assistantId: "a2", projectId: "p1", status: "held", heldReason: "cap" }),
    ];
    const t = setup(rows);
    expect(await resumeAgentLenMessages(NOW, t.deps)).toBe(3);
    expect(t.store.toResume).toHaveBeenCalledWith(NOW);
    // The agent a1 once (for both projects), Len once in p1 (for both agents), once in p2.
    expect(t.agentLaunches.map((p) => [p.projectId, p.extraBody])).toEqual([["home-a1", { assistantId: "a1" }]]);
    expect(t.lenLaunches.map((p) => p.projectId)).toEqual(["p1", "p2"]);
    expect(t.statusOf("m6")).toBe("held");
    // And each turn reads everything that is waiting for its recipient.
    const agentRead = await t.agentLaunches[0]!.resolveAtStart!();
    expect(agentRead?.framing).toContain("about «Presupuesto»");
    expect(agentRead?.framing).toContain("about «Informe»");
    const lenRead = await t.lenLaunches[0]!.resolveAtStart!();
    expect(lenRead?.framing).toContain("Finanzas");
    expect(lenRead?.framing).toContain("Ventas");
  });

  it("a deleted agent's message wakes nothing", async () => {
    const rows = [
      msg({ id: "m1", direction: "to_agent", assistantId: "gone", status: "delivering", deliveringAt: NOW }),
      msg({ id: "m2", direction: "to_len", assistantId: "gone", status: "delivering", deliveringAt: NOW }),
    ];
    const t = setup(rows);
    expect(await resumeAgentLenMessages(NOW, t.deps)).toBe(0);
    expect(t.lenLaunches).toEqual([]);
    expect(t.agentLaunches).toEqual([]);
  });

  it("a message about a project that no longer exists wakes nothing for Len", async () => {
    const rows = [msg({ id: "m1", direction: "to_len", projectId: "deleted-project", status: "delivering", deliveringAt: NOW })];
    const t = setup(rows);
    expect(await resumeAgentLenMessages(NOW, t.deps)).toBe(0);
    expect(t.lenLaunches).toEqual([]);
  });

  it("with agents off, what was on its way is kept, not woken", async () => {
    const rows = [
      msg({ id: "m1", direction: "to_agent", status: "delivering", deliveringAt: NOW }),
      msg({ id: "m2", direction: "to_len", status: "delivering", deliveringAt: NOW }),
    ];
    const t = setup(rows, { enabled: () => false });
    expect(await resumeAgentLenMessages(NOW, t.deps)).toBe(0);
    expect(t.lenLaunches).toEqual([]);
    expect(t.agentLaunches).toEqual([]);
    expect(t.calls.held).toEqual([{ ids: ["m1", "m2"], reason: "agents_off" }]);
  });

  it("one recipient failing to wake does not stop the others", async () => {
    const rows = [
      msg({ id: "m1", direction: "to_agent", assistantId: "a1", status: "delivering", deliveringAt: NOW }),
      msg({ id: "m2", direction: "to_agent", assistantId: "a2", status: "delivering", deliveringAt: NOW }),
    ];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = setup(rows, {
      zoneOf: vi.fn(async () => "UTC"),
      launchForAgent: vi.fn((p: AgentLaunch) => {
        if (p.projectId === "home-a1") throw new Error("queue exploded");
        t.agentLaunches.push(p);
      }),
    });
    expect(await resumeAgentLenMessages(NOW, t.deps)).toBe(1);
    expect(t.agentLaunches.map((p) => p.projectId)).toEqual(["home-a2"]);
    warn.mockRestore();
  });

  // Final review, m7 (M4-5): the group's turn is woken from its first message, but every message of the group was on its
  // way. A turn that fails before its claim gives them ALL back as held, not only the first: the others would stay
  // delivering until a later restart expired them.
  it("🔴 a resumed group whose turn fails before its claim holds every message of the group", async () => {
    const rows = [
      msg({ id: "m1", direction: "to_len", assistantId: "a1", projectId: "p1", status: "delivering", deliveringAt: NOW }),
      msg({ id: "m2", direction: "to_len", assistantId: "a2", projectId: "p1", status: "delivering", deliveringAt: NOW }),
      msg({ id: "m3", direction: "to_agent", assistantId: "a1", projectId: "p1", status: "delivering", deliveringAt: NOW }),
      msg({ id: "m4", direction: "to_agent", assistantId: "a1", projectId: "p2", status: "delivering", deliveringAt: NOW }),
    ];
    const t = setup(rows);
    expect(await resumeAgentLenMessages(NOW, t.deps)).toBe(2);
    await t.lenLaunches[0]!.fail(null, false);
    await t.agentLaunches[0]!.fail(null, false);
    expect(t.calls.held).toEqual([
      { ids: ["m1", "m2"], reason: "no_credits" },
      { ids: ["m3", "m4"], reason: "no_credits" },
    ]);
    expect(t.rows.map((r) => r.status)).toEqual(["held", "held", "held", "held"]);
  });

  it("nothing to resume wakes nothing", async () => {
    const t = setup([]);
    expect(await resumeAgentLenMessages(NOW, t.deps)).toBe(0);
    expect(t.store.hold).not.toHaveBeenCalled();
  });
});

