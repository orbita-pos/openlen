import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentSession } from "@/lib/agent/tools";

import { MESSAGE_CAP, MESSAGE_MAX } from "./policy";
import type { AgentLenMessage, HeldReason, MessageDirection } from "./store";
import { MESSAGE_AGENT, MESSAGE_AGENT_DECLARATION, MESSAGE_LEN, MESSAGE_LEN_DECLARATION, runSendMessage, type MessageStore, type Waker } from "./tool";

// `message_len` and `message_agent` (spec local 2026-11-21-len-y-el-agente-conversan, §1, §6 and decisions 8, 9 and 11):
// the two sides of one conversation. The agent writes to Len about a project it serves or started; Len writes to an agent
// related to the project. `runSendMessage` validates, resolves the recipient, writes the message to the mailbox, enforces
// the cap and hands it to a waker. Against an in-memory mailbox: the tests never reach a database, and nothing wakes for
// real. (Not `send_message`: that is Len's subagent tool.)

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

interface Fake extends MessageStore {
  readonly messages: AgentLenMessage[];
  readonly held: { ids: readonly string[]; reason: HeldReason }[];
  /** When the person last wrote, as the fake answers it. */
  personAt: Date | null;
  readonly lastPersonCalls: [string, string, string][];
  /** What `hold` and `messagesSince` throw, when set: the mailbox failing after the message was written. */
  holdError: Error | null;
  countError: Error | null;
}

/** A mailbox that counts as the real one: every non-expired message of the pair after `since`, in either direction. */
function fakeStore(): Fake {
  let clock = Date.UTC(2026, 10, 21, 12, 0, 0);
  const messages: AgentLenMessage[] = [];
  const held: Fake["held"] = [];
  const lastPersonCalls: Fake["lastPersonCalls"] = [];
  const fake: Fake = {
    messages,
    held,
    personAt: null,
    lastPersonCalls,
    holdError: null,
    countError: null,
    async addMessage(m) {
      clock += 1000;
      const row: AgentLenMessage = {
        id: `m${messages.length + 1}`,
        assistantId: m.assistantId,
        projectId: m.projectId,
        direction: m.direction,
        text: m.text,
        ownerWords: m.ownerWords,
        status: "pending",
        heldReason: null,
        createdAt: new Date(clock),
        deliveringAt: null,
        deliveredAt: null,
      };
      messages.push(row);
      return row;
    },
    async lastPersonMessageAt(assistantId, projectId, homeProjectId) {
      lastPersonCalls.push([assistantId, projectId, homeProjectId]);
      return fake.personAt;
    },
    async messagesSince(assistantId, projectId, since) {
      if (fake.countError) throw fake.countError;
      return messages.filter((m) => m.assistantId === assistantId && m.projectId === projectId && m.status !== "expired" && (!since || m.createdAt > since)).length;
    },
    async hold(ids, reason) {
      if (fake.holdError) throw fake.holdError;
      held.push({ ids, reason });
    },
  };
  return fake;
}

/** n messages already exchanged by the pair (a1, p1), alternating sides. */
async function exchanged(store: Fake, n: number, assistantId = "a1", projectId = "p1"): Promise<void> {
  for (let i = 0; i < n; i++) {
    const direction: MessageDirection = i % 2 === 0 ? "to_len" : "to_agent";
    await store.addMessage({ assistantId, projectId, direction, text: `earlier ${i}`, ownerWords: null });
  }
}

const waking: Waker = async () => "waking";

function agentSession(extra: Partial<NonNullable<AgentSession["assistant"]>> = {}, session: Partial<AgentSession> = {}): AgentSession {
  return {
    projectId: "home",
    userId: "u1",
    mensajeDelUsuario: "tell Len the invoice goes in blue",
    assistant: { id: "a1", name: "Finanzas", projects: [{ id: "p1", title: "Presupuesto" }], ...extra },
    ...session,
  } as unknown as AgentSession;
}

const LEN_SESSION = {
  projectId: "p1",
  userId: "u1",
  relatedAgents: [
    { id: "a1", name: "Finanzas", homeProjectId: "home" },
    { id: "a2", name: "Ventas", homeProjectId: "home2" },
  ],
} as unknown as AgentSession;

describe("the declarations", () => {
  it("are the names and the descriptions the plan fixed", () => {
    // By direction, never `send_message`: that name is Len's subagent tool (`{ agent_id, message }`).
    expect(MESSAGE_LEN).toBe("message_len");
    expect(MESSAGE_AGENT).toBe("message_agent");
    expect(MESSAGE_LEN_DECLARATION.name).toBe("message_len");
    expect(MESSAGE_LEN_DECLARATION.description).toBe(
      "Sends a message to Len, OpenLen's agent, about a project you serve or started: to answer him or tell him something. It isn't how you ask for work — that is ask_len. Len reads it as yours, not your owner's. The answer, if any, comes later as a message from Len.",
    );
    expect(Object.keys(MESSAGE_LEN_DECLARATION.parameters.properties)).toEqual(["project", "message"]);
    expect(MESSAGE_LEN_DECLARATION.parameters.required).toEqual(["project", "message"]);
    expect(MESSAGE_AGENT_DECLARATION.name).toBe("message_agent");
    expect(MESSAGE_AGENT_DECLARATION.description).toBe(
      "Sends a message to one of the agents of this project (listed in your context): to ask it something only it or its person knows to finish what it asked, or to tell it something it must act on. Never just to thank. Its answer, if any, comes later as a message.",
    );
    expect(Object.keys(MESSAGE_AGENT_DECLARATION.parameters.properties)).toEqual(["to", "message"]);
    expect(MESSAGE_AGENT_DECLARATION.parameters.required).toEqual(["to", "message"]);
  });
});

describe("an agent writes to Len", () => {
  it("stores the message as the agent's, wakes Len and says so, without a reply", async () => {
    const store = fakeStore();
    const wake = vi.fn<Waker>(waking);
    const out = await runSendMessage(agentSession(), { project: "p1", message: "  The invoice goes in blue.  " }, { store, wake });
    expect(out.response).toMatchObject({ ok: true, status: "waking", tool_result: "Sent to Len; it reads it now." });
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0]).toMatchObject({ assistantId: "a1", projectId: "p1", direction: "to_len", text: "The invoice goes in blue.", status: "pending" });
    // The waker learns the agent's home and name from the session: an agent's turn runs in its home.
    expect(wake).toHaveBeenCalledTimes(1);
    expect(wake.mock.calls[0]![0].id).toBe("m1");
    expect(wake.mock.calls[0]![1]).toEqual({ homeProjectId: "home", agentName: "Finanzas" });
    // The cap reads the person's last word in either of the two chats of the pair.
    expect(store.lastPersonCalls).toEqual([["a1", "p1", "home"]]);
    expect(store.held).toEqual([]);
  });

  it("carries the owner's own words of this turn, verbatim", async () => {
    const store = fakeStore();
    await runSendMessage(agentSession(), { project: "p1", message: "Blue." }, { store, wake: waking });
    expect(store.messages[0]!.ownerWords).toBe("tell Len the invoice goes in blue");
  });

  it("carries none in a turn Len woke (no person spoke), nor when the person's message is empty", async () => {
    const woken = fakeStore();
    await runSendMessage(agentSession({ woken: true }), { project: "p1", message: "Blue." }, { store: woken, wake: waking });
    expect(woken.messages[0]!.ownerWords).toBeNull();
    const blank = fakeStore();
    await runSendMessage(agentSession({}, { mensajeDelUsuario: "   " }), { project: "p1", message: "Blue." }, { store: blank, wake: waking });
    expect(blank.messages[0]!.ownerWords).toBeNull();
    const absent = fakeStore();
    await runSendMessage(agentSession({}, { mensajeDelUsuario: undefined }), { project: "p1", message: "Blue." }, { store: absent, wake: waking });
    expect(absent.messages[0]!.ownerWords).toBeNull();
  });

  it("takes a project it started, from the turn's list", async () => {
    const store = fakeStore();
    const out = await runSendMessage(agentSession({ started: [{ id: "s1", title: "Informe" }] }), { project: "s1", message: "Done." }, { store, wake: waking });
    expect(out.response).toMatchObject({ ok: true, status: "waking" });
    expect(store.messages[0]).toMatchObject({ projectId: "s1", direction: "to_len" });
  });

  it("takes a project it started that is not in the list, by the live check (one started this very turn)", async () => {
    const store = fakeStore();
    const started = vi.fn(async () => "Nuevo");
    const out = await runSendMessage(agentSession(), { project: "s9", message: "Done." }, { store, wake: waking, started });
    expect(started).toHaveBeenCalledWith("a1", "s9");
    expect(out.response).toMatchObject({ ok: true, status: "waking" });
    expect(store.messages[0]!.projectId).toBe("s9");
  });

  it("refuses a project it neither serves nor started, and writes nothing", async () => {
    const store = fakeStore();
    const wake = vi.fn<Waker>(waking);
    const started = vi.fn(async () => null);
    const out = await runSendMessage(agentSession(), { project: "other", message: "Hi." }, { store, wake, started });
    expect(out.response).toMatchObject({ ok: false, error: "not_your_project" });
    expect(started).toHaveBeenCalledWith("a1", "other");
    expect(store.messages).toEqual([]);
    expect(wake).not.toHaveBeenCalled();
  });

  it("a live check that fails is a refusal, not a crash", async () => {
    const store = fakeStore();
    const started = vi.fn(async () => {
      throw new Error("db down");
    });
    const out = await runSendMessage(agentSession(), { project: "other", message: "Hi." }, { store, wake: waking, started });
    expect(out.response).toMatchObject({ ok: false, error: "not_your_project" });
    expect(store.messages).toEqual([]);
  });

  it("with no test seam for the live check, it does not look (tests never reach a database)", async () => {
    const store = fakeStore();
    const out = await runSendMessage(agentSession(), { project: "other", message: "Hi." }, { store, wake: waking });
    expect(out.response).toMatchObject({ ok: false, error: "not_your_project" });
  });

  it("an agent with no list of projects serves its home, as ask_len does; in the person's space it serves none", async () => {
    const store = fakeStore();
    const home = { id: "a1", name: "Finanzas" };
    const ok = await runSendMessage({ projectId: "home", userId: "u1", assistant: home } as unknown as AgentSession, { project: "home", message: "Hi." }, { store, wake: waking });
    expect(ok.response).toMatchObject({ ok: true });
    const space = await runSendMessage({ projectId: "home", userId: "u1", assistant: { ...home, inSpace: true } } as unknown as AgentSession, { project: "home", message: "Hi." }, { store, wake: waking });
    expect(space.response).toMatchObject({ ok: false, error: "not_your_project" });
  });

  it("needs the project: there is no default", async () => {
    const store = fakeStore();
    for (const args of [{ message: "Hi." }, { project: "", message: "Hi." }, { project: "  ", message: "Hi." }, { project: 7, message: "Hi." }]) {
      const out = await runSendMessage(agentSession(), args, { store, wake: waking });
      expect(out.response).toMatchObject({ ok: false, error: "invalid_arguments" });
    }
    expect(store.messages).toEqual([]);
  });
});

describe("Len writes to an agent", () => {
  it("stores the message for the agent in this project, wakes it and says so, with no owner words", async () => {
    const store = fakeStore();
    const wake = vi.fn<Waker>(waking);
    const out = await runSendMessage(LEN_SESSION, { to: "Finanzas", message: "Which currency is the invoice in?" }, { store, wake });
    expect(out.response).toMatchObject({ ok: true, status: "waking", tool_result: "Sent to Finanzas; it reads it now." });
    expect(store.messages[0]).toMatchObject({ assistantId: "a1", projectId: "p1", direction: "to_agent", text: "Which currency is the invoice in?", ownerWords: null });
    // The agent's home and name come from the matched entry, never from the session: Len's turn runs in the project.
    expect(wake.mock.calls[0]![1]).toEqual({ homeProjectId: "home", agentName: "Finanzas" });
    expect(store.lastPersonCalls).toEqual([["a1", "p1", "home"]]);
  });

  it("matches the name case-insensitively and takes the right agent", async () => {
    const store = fakeStore();
    const wake = vi.fn<Waker>(waking);
    const out = await runSendMessage(LEN_SESSION, { to: "  vENTAS ", message: "Hi." }, { store, wake });
    expect(out.response).toMatchObject({ ok: true, tool_result: "Sent to Ventas; it reads it now." });
    expect(store.messages[0]).toMatchObject({ assistantId: "a2", projectId: "p1" });
    expect(wake.mock.calls[0]![1]).toEqual({ homeProjectId: "home2", agentName: "Ventas" });
  });

  it("refuses a name that is not one of the project's agents, lists the names, and writes nothing", async () => {
    const store = fakeStore();
    const wake = vi.fn<Waker>(waking);
    const out = await runSendMessage(LEN_SESSION, { to: "Marketing", message: "Hi." }, { store, wake });
    expect(out.response).toMatchObject({ ok: false, error: "unknown_agent" });
    expect(String(out.response.message)).toContain("Finanzas");
    expect(String(out.response.message)).toContain("Ventas");
    expect(store.messages).toEqual([]);
    expect(wake).not.toHaveBeenCalled();
  });

  it("with no agent related to the project, any name is unknown", async () => {
    const store = fakeStore();
    for (const session of [{ projectId: "p1", userId: "u1" }, { projectId: "p1", userId: "u1", relatedAgents: [] }]) {
      const out = await runSendMessage(session as unknown as AgentSession, { to: "Finanzas", message: "Hi." }, { store, wake: waking });
      expect(out.response).toMatchObject({ ok: false, error: "unknown_agent" });
    }
    expect(store.messages).toEqual([]);
  });

  it("needs the name", async () => {
    const store = fakeStore();
    for (const args of [{ message: "Hi." }, { to: "", message: "Hi." }, { to: "  ", message: "Hi." }, { to: 3, message: "Hi." }]) {
      const out = await runSendMessage(LEN_SESSION, args, { store, wake: waking });
      expect(out.response).toMatchObject({ ok: false, error: "invalid_arguments" });
    }
    expect(store.messages).toEqual([]);
  });
});

describe("the message", () => {
  it("is 1 to MESSAGE_MAX characters once trimmed, from either side", async () => {
    for (const bad of [undefined, "", "   ", 42, "x".repeat(MESSAGE_MAX + 1)]) {
      const store = fakeStore();
      const fromAgent = await runSendMessage(agentSession(), { project: "p1", message: bad }, { store, wake: waking });
      const fromLen = await runSendMessage(LEN_SESSION, { to: "Finanzas", message: bad }, { store, wake: waking });
      expect(fromAgent.response).toMatchObject({ ok: false, error: "invalid_arguments" });
      expect(fromLen.response).toMatchObject({ ok: false, error: "invalid_arguments" });
      expect(store.messages).toEqual([]);
    }
    const store = fakeStore();
    const out = await runSendMessage(agentSession(), { project: "p1", message: ` ${"x".repeat(MESSAGE_MAX)} ` }, { store, wake: waking });
    expect(out.response).toMatchObject({ ok: true });
    expect(store.messages[0]!.text).toHaveLength(MESSAGE_MAX);
  });
});

describe("the cap of four", () => {
  it("lets the fourth through and holds the fifth, with the sentence, waking nobody (agent side)", async () => {
    const store = fakeStore();
    const wake = vi.fn<Waker>(waking);
    await exchanged(store, MESSAGE_CAP - 1);
    const fourth = await runSendMessage(agentSession(), { project: "p1", message: "Fourth." }, { store, wake });
    expect(fourth.response).toMatchObject({ ok: true, status: "waking" });
    expect(wake).toHaveBeenCalledTimes(1);
    const fifth = await runSendMessage(agentSession(), { project: "p1", message: "Fifth." }, { store, wake });
    expect(fifth.response).toMatchObject({
      ok: true,
      status: "held",
      reason: "cap",
      tool_result: `You and Len have written ${MESSAGE_CAP} times without your owner; this waits for their next message.`,
    });
    expect(wake).toHaveBeenCalledTimes(1);
    expect(store.held).toEqual([{ ids: ["m5"], reason: "cap" }]);
    // It is still in the mailbox, written before anything else happened to it.
    expect(store.messages.map((m) => m.text).at(-1)).toBe("Fifth.");
  });

  it("holds Len's fifth with the sentence that names the agent and the person", async () => {
    const store = fakeStore();
    const wake = vi.fn<Waker>(waking);
    await exchanged(store, MESSAGE_CAP);
    const out = await runSendMessage(LEN_SESSION, { to: "Finanzas", message: "Fifth." }, { store, wake });
    expect(out.response).toMatchObject({
      ok: true,
      status: "held",
      reason: "cap",
      tool_result: `You and Finanzas have written ${MESSAGE_CAP} times without the person; this waits for their next message.`,
    });
    expect(wake).not.toHaveBeenCalled();
    expect(store.held).toEqual([{ ids: ["m5"], reason: "cap" }]);
  });

  it("counts only the pair: another project or another agent's messages do not use it up", async () => {
    const store = fakeStore();
    await exchanged(store, MESSAGE_CAP, "a1", "other-project");
    await exchanged(store, MESSAGE_CAP, "a2", "p1");
    const out = await runSendMessage(agentSession(), { project: "p1", message: "Hi." }, { store, wake: waking });
    expect(out.response).toMatchObject({ ok: true, status: "waking" });
  });

  it("the person's word in either chat starts the count again", async () => {
    const store = fakeStore();
    await exchanged(store, MESSAGE_CAP);
    // The person wrote after all of those: only what comes after counts.
    store.personAt = new Date(store.messages.at(-1)!.createdAt.getTime() + 500);
    const out = await runSendMessage(agentSession(), { project: "p1", message: "Hi." }, { store, wake: waking });
    expect(out.response).toMatchObject({ ok: true, status: "waking" });
    expect(store.held).toEqual([]);
  });
});

describe("what keeps a message without waking anyone", () => {
  it("agents off: it is stored and held as agents_off, and nobody is woken", async () => {
    vi.stubEnv("OPENLEN_ASSISTANT", "0");
    const store = fakeStore();
    const wake = vi.fn<Waker>(waking);
    const out = await runSendMessage(agentSession(), { project: "p1", message: "Hi." }, { store, wake });
    expect(out.response).toMatchObject({ ok: true, status: "held", reason: "agents_off" });
    expect(store.messages).toHaveLength(1);
    expect(store.held).toEqual([{ ids: ["m1"], reason: "agents_off" }]);
    expect(wake).not.toHaveBeenCalled();
    const fromLen = await runSendMessage(LEN_SESSION, { to: "Finanzas", message: "Hi." }, { store, wake });
    expect(fromLen.response).toMatchObject({ ok: true, status: "held", reason: "agents_off" });
    expect(wake).not.toHaveBeenCalled();
  });

  it("no credits: the waker says so and the message is held as no_credits", async () => {
    const store = fakeStore();
    const wake = vi.fn<Waker>(async () => "no_credits");
    const out = await runSendMessage(agentSession(), { project: "p1", message: "Hi." }, { store, wake });
    expect(out.response).toMatchObject({ ok: true, status: "held", reason: "no_credits" });
    expect(String(out.response.tool_result)).toMatch(/Len/);
    expect(store.held).toEqual([{ ids: ["m1"], reason: "no_credits" }]);
    const fromLen = await runSendMessage(LEN_SESSION, { to: "Finanzas", message: "Hi." }, { store, wake });
    expect(fromLen.response).toMatchObject({ ok: true, status: "held", reason: "no_credits" });
    expect(String(fromLen.response.tool_result)).toMatch(/Finanzas/);
  });

});

// Once the message is in the mailbox it is the recipient's: a failure after that is never a failed tool, because the
// sender would send it again — a duplicate that also uses up the cap (review of Task 3).
describe("a failure after the message was written", () => {
  const KEPT_TO_LEN = "The message is kept and Len reads it with its next turn; don't send it again.";
  const KEPT_TO_AGENT = "The message is kept and Finanzas reads it with its next turn; don't send it again.";

  it("a waker that throws is not a tool failure: the message stays, pending, and the sender is told not to send it again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = fakeStore();
    const wake: Waker = async () => {
      throw new Error("queue is down");
    };
    const out = await runSendMessage(agentSession(), { project: "p1", message: "Hi." }, { store, wake });
    expect(out.response).toEqual({ ok: true, status: "kept", tool_result: KEPT_TO_LEN });
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0]!.status).toBe("pending");
    expect(store.held).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    const fromLen = await runSendMessage(LEN_SESSION, { to: "Finanzas", message: "Hi." }, { store, wake });
    expect(fromLen.response).toEqual({ ok: true, status: "kept", tool_result: KEPT_TO_AGENT });
  });

  it("a hold that throws (no credits, the cap, agents off) is the same: kept, not failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // No credits: the waker answers, then the hold fails.
    const noCredits = fakeStore();
    noCredits.holdError = new Error("db down");
    const a = await runSendMessage(agentSession(), { project: "p1", message: "Hi." }, { store: noCredits, wake: async () => "no_credits" });
    expect(a.response).toEqual({ ok: true, status: "kept", tool_result: KEPT_TO_LEN });
    // The cap: the fifth message is to be held, and the hold fails.
    const capped = fakeStore();
    await exchanged(capped, MESSAGE_CAP);
    capped.holdError = new Error("db down");
    const wake = vi.fn<Waker>(waking);
    const b = await runSendMessage(LEN_SESSION, { to: "Finanzas", message: "Fifth." }, { store: capped, wake });
    expect(b.response).toEqual({ ok: true, status: "kept", tool_result: KEPT_TO_AGENT });
    expect(wake).not.toHaveBeenCalled();
    expect(capped.messages.at(-1)).toMatchObject({ text: "Fifth.", status: "pending" });
    // Agents off.
    vi.stubEnv("OPENLEN_ASSISTANT", "0");
    const off = fakeStore();
    off.holdError = new Error("db down");
    const c = await runSendMessage(agentSession(), { project: "p1", message: "Hi." }, { store: off, wake: waking });
    expect(c.response).toEqual({ ok: true, status: "kept", tool_result: KEPT_TO_LEN });
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("a count that can't be read is the same: the message is written and nothing is woken", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = fakeStore();
    store.countError = new Error("db down");
    const wake = vi.fn<Waker>(waking);
    const out = await runSendMessage(agentSession(), { project: "p1", message: "Hi." }, { store, wake });
    expect(out.response).toMatchObject({ ok: true, status: "kept" });
    expect(wake).not.toHaveBeenCalled();
    expect(store.messages).toHaveLength(1);
  });

  it("the sentence for a kept message names no reply and none of the message", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = fakeStore();
    const out = await runSendMessage(agentSession(), { project: "p1", message: "A secret question." }, { store, wake: async () => Promise.reject(new Error("x")) });
    expect(Object.keys(out.response).sort()).toEqual(["ok", "status", "tool_result"]);
    expect(JSON.stringify(out.response)).not.toContain("A secret question.");
  });

  it("but a message that couldn't be written is a failed tool: nothing was stored, so sending it again is right", async () => {
    const store = fakeStore();
    const broken: MessageStore = {
      ...store,
      addMessage: async () => {
        throw new Error("db down");
      },
    };
    const wake = vi.fn<Waker>(waking);
    await expect(runSendMessage(agentSession(), { project: "p1", message: "Hi." }, { store: broken, wake })).rejects.toThrow("db down");
    expect(wake).not.toHaveBeenCalled();
  });
});

describe("what the sender reads back", () => {
  it("never carries the other side's reply or the stored message", async () => {
    const store = fakeStore();
    const out = await runSendMessage(agentSession(), { project: "p1", message: "A secret question." }, { store, wake: waking });
    expect(Object.keys(out.response).sort()).toEqual(["ok", "status", "tool_result"]);
    expect(JSON.stringify(out.response)).not.toContain("A secret question.");
  });
});

describe("with no test seam at all", () => {
  it("the message goes to the real mailbox and its recipient is woken by the real waker (wake.ts)", async () => {
    vi.resetModules();
    const store = fakeStore();
    const wakeRecipient = vi.fn(async () => "waking" as const);
    vi.doMock("./store", () => ({ addMessage: store.addMessage, lastPersonMessageAt: store.lastPersonMessageAt, messagesSince: store.messagesSince, hold: store.hold }));
    vi.doMock("./wake", () => ({ wakeRecipient }));
    try {
      const { runSendMessage: run } = await import("./tool");
      const out = await run(LEN_SESSION, { to: "Finanzas", message: "What color is the invoice?" });
      expect(out.response).toMatchObject({ ok: true, status: "waking" });
      expect(wakeRecipient).toHaveBeenCalledTimes(1);
      expect(wakeRecipient).toHaveBeenCalledWith(expect.objectContaining({ id: "m1", direction: "to_agent" }), { homeProjectId: "home", agentName: "Finanzas" });
    } finally {
      vi.doUnmock("./store");
      vi.doUnmock("./wake");
      vi.resetModules();
    }
  });
});
