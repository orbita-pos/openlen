// THE MESSAGES BETWEEN LEN AND THE PERSON'S AGENTS, TWO SIDES (spec local 2026-11-21-len-y-el-agente-conversan, §1 and §6
// and decisions 8, 9 and 11): the person's own agent writes to Len about a project it serves or started (`message_len`),
// and Len writes to an agent related to the project he is in (`message_agent`). As Claude Code's SendMessage and
// DeepSeek's send_message do: the result says only whether it was handed over or left waiting, never the reply — a reply
// is another explicitly addressed message. 🔴 Not named `send_message`: that is Len's subagent tool (`{ agent_id,
// message }`, lib/agent/subagents/), and a second tool under the same name shadowed it in the dispatcher. One function
// serves both names: the session tells the sides apart (`session.assistant`).
//
// This is the tool and nothing else: validate, resolve the recipient, write the message to the mailbox BEFORE anything
// happens to it, enforce the cap of four, and hand it to a `Waker` (lib/assistants/messages/wake.ts, which starts the
// recipient's turn). What each side reads of the other's message is `policy.ts`'s framing.
import type { StartedLookup } from "@/lib/assistants/ask-len";
import { assistantsEnabled } from "@/lib/assistants/enabled";
import type { AgentSession, ToolOutcome } from "@/lib/agent/tools";

import { capReached, MESSAGE_CAP, MESSAGE_MAX } from "./policy";
import type { AgentLenMessage, HeldReason, MessageDirection } from "./store";

/** The agent's tool: a message to Len. */
export const MESSAGE_LEN = "message_len";
/** Len's tool: a message to one of the agents of the project. */
export const MESSAGE_AGENT = "message_agent";

/** The agent's side: Len is the only one it can write to, so the tool names the project, never the recipient. */
export const MESSAGE_LEN_DECLARATION = {
  name: MESSAGE_LEN,
  description:
    "Sends a message to Len, OpenLen's agent, about a project you serve or started: to answer him or tell him something. " +
    "It isn't how you ask for work — that is ask_len. Len reads it as yours, not your owner's. The answer, if any, comes later as a message from Len.",
  parameters: {
    type: "OBJECT",
    properties: {
      project: {
        type: "STRING",
        description: "The id of the project this is about: one you serve (~/.assistant/PROJECTS.md) or one you started (~/.assistant/STARTED.md).",
      },
      message: { type: "STRING", description: "What you tell or answer Len, in your own words. Short and complete: he reads it without your conversation." },
    },
    required: ["project", "message"],
  },
} as const;

/** Len's side: he names the agent; the project is the one he is in. */
export const MESSAGE_AGENT_DECLARATION = {
  name: MESSAGE_AGENT,
  description:
    "Sends a message to one of the agents of this project (listed in your context): to ask it something only it or its person knows to finish what it asked, " +
    "or to tell it something it must act on. Never just to thank. Its answer, if any, comes later as a message.",
  parameters: {
    type: "OBJECT",
    properties: {
      to: { type: "STRING", description: "The name of the agent, as listed in your context." },
      message: { type: "STRING", description: "What you ask or tell it, in your own words. Short and complete: it reads it without your conversation." },
    },
    required: ["to", "message"],
  },
} as const;

/** The mailbox this tool needs (lib/assistants/messages/store.ts); injected so its tests never reach a database. */
export interface MessageStore {
  addMessage(message: {
    readonly assistantId: string;
    readonly projectId: string;
    readonly direction: MessageDirection;
    readonly text: string;
    readonly ownerWords: string | null;
  }): Promise<AgentLenMessage>;
  lastPersonMessageAt(assistantId: string, projectId: string, homeProjectId: string): Promise<Date | null>;
  messagesSince(assistantId: string, projectId: string, since: Date | null): Promise<number>;
  hold(ids: readonly string[], reason: HeldReason): Promise<void>;
}

/** Hands a stored message to its recipient: starts their turn. `ctx` is the AGENT's home and name, whichever side wrote.
 *  `no_credits`: the person can't pay for that turn, so the message is kept (decision 9). */
export type Waker = (m: AgentLenMessage, ctx: { homeProjectId: string; agentName: string }) => Promise<"waking" | "no_credits">;

export interface SendMessageDeps {
  readonly store: MessageStore;
  readonly wake: Waker;
  /** Whether the agent started a project, checked live. Absent here means none; absent with no `deps` at all, the real one. */
  readonly started?: StartedLookup;
}

async function realStore(): Promise<MessageStore> {
  const s = await import("./store");
  return { addMessage: s.addMessage, lastPersonMessageAt: s.lastPersonMessageAt, messagesSince: s.messagesSince, hold: s.hold };
}

// The real waker (lib/assistants/messages/wake.ts: the recipient's turn, through the queue every turn already waits in).
// Loaded when a message is first handed over, so this file stays clear of the server-turn road. A failure to start the
// turn is logged and the sender is told the message is kept (it is, pending, and the recipient's next turn reads it).
const liveWaker: Waker = async (m, ctx) => (await import("./wake")).wakeRecipient(m, ctx);

const liveStartedLookup: StartedLookup = async (assistantId, projectId) => (await import("../projects")).startedTitleOf(assistantId, projectId);
const NO_LOOKUP: StartedLookup = async () => null;

function invalid(message: string): ToolOutcome {
  return { response: { ok: false, error: "invalid_arguments", message } };
}

/** Where a message goes and who is told what. */
interface Route {
  /** The agent: whoever its row in the mailbox belongs to, on either side. */
  readonly assistantId: string;
  readonly projectId: string;
  readonly direction: MessageDirection;
  readonly ownerWords: string | null;
  readonly ctx: { homeProjectId: string; agentName: string };
  /** Who reads it, as the sender is told: «Len», or the agent's name. */
  readonly recipient: string;
  /** What the person is called in the cap's sentence: the agent's owner, or the project's person. */
  readonly person: string;
}

/** The agent's side: `project` is one it serves or started, as `ask_len` decides it. */
async function routeFromAgent(session: AgentSession, args: Record<string, unknown>, lookup: () => StartedLookup): Promise<Route | ToolOutcome> {
  const assistant = session.assistant!;
  const named = typeof args.project === "string" ? args.project.trim() : "";
  if (!named) return invalid("project is required: the id of the project this is about (~/.assistant/PROJECTS.md or ~/.assistant/STARTED.md).");
  // Hers when it is in her list; with no list she serves her home, as in ask_len — except in the person's space, where she serves none.
  const served = assistant.projects?.length || assistant.inSpace ? (assistant.projects ?? []) : [{ id: session.projectId }];
  let known = served.some((p) => p.id === named) || (assistant.started ?? []).some((p) => p.id === named);
  // The turn's list of the projects it started is a snapshot (one started this very turn, one past the 30 listed): checked live.
  if (!known) known = (await lookup()(assistant.id, named).catch(() => null)) !== null;
  if (!known) {
    return { response: { ok: false, error: "not_your_project", message: "That isn't one of the projects you serve or started: see ~/.assistant/PROJECTS.md and ~/.assistant/STARTED.md." } };
  }
  // Her own words ride along only when a person spoke this turn: a turn Len woke has none (decision 8).
  const said = session.mensajeDelUsuario;
  const ownerWords = !assistant.woken && typeof said === "string" && said.trim() !== "" ? said : null;
  return {
    assistantId: assistant.id,
    projectId: named,
    direction: "to_len",
    ownerWords,
    // An agent's turn runs in its home.
    ctx: { homeProjectId: session.projectId, agentName: assistant.name },
    recipient: "Len",
    person: "your owner",
  };
}

/** Len's side: `to` is the name of an agent related to THIS project, and no other. */
function routeFromLen(session: AgentSession, args: Record<string, unknown>): Route | ToolOutcome {
  const to = typeof args.to === "string" ? args.to.trim() : "";
  if (!to) return invalid("to is required: the name of the agent, as listed in your context.");
  const related = session.relatedAgents ?? [];
  const agent = related.find((a) => a.name.trim().toLowerCase() === to.toLowerCase());
  if (!agent) {
    const names = related.map((a) => a.name);
    return {
      response: {
        ok: false,
        error: "unknown_agent",
        agents: names,
        message: names.length ? `No agent of this project is called «${to}». The agents of this project: ${names.join(", ")}.` : "No agent is related to this project: there is nobody to write to.",
      },
    };
  }
  return {
    assistantId: agent.id,
    projectId: session.projectId,
    direction: "to_agent",
    ownerWords: null,
    ctx: { homeProjectId: agent.homeProjectId, agentName: agent.name },
    recipient: agent.name,
    person: "the person",
  };
}

function held(reason: HeldReason, sentence: string): ToolOutcome {
  return { response: { ok: true, status: "held", reason, tool_result: sentence } };
}

export async function runSendMessage(session: AgentSession, args: Record<string, unknown>, deps?: SendMessageDeps): Promise<ToolOutcome> {
  const text = typeof args.message === "string" ? args.message.trim() : "";
  if (!text || text.length > MESSAGE_MAX) return invalid(`message is required: what you tell the other side, in your own words (up to ${MESSAGE_MAX} characters).`);
  // With a test seam the live check is only what the seam gives; without one, the real one — as ask_len does.
  const lookup = () => deps?.started ?? (deps ? NO_LOOKUP : liveStartedLookup);
  const route = session.assistant ? await routeFromAgent(session, args, lookup) : routeFromLen(session, args);
  if ("response" in route) return route;

  const store = deps?.store ?? (await realStore());
  const wake = deps?.wake ?? liveWaker;
  // Written before anything else happens to it: a message that wakes nobody is still there for the recipient's next turn.
  // A failure of THIS call is a failed tool: nothing was stored, so sending it again is right.
  const message = await store.addMessage({ assistantId: route.assistantId, projectId: route.projectId, direction: route.direction, text, ownerWords: route.ownerWords });

  // From here the message is the recipient's, `pending` at the worst — its next turn reads it. A failure that is never the
  // sender's: told the tool failed, it would send it again, and the copy would also use up the cap.
  try {
    return await handOver(store, wake, message, route);
  } catch (err) {
    console.warn("[agent-messages] a message was kept but couldn't be handed over", err);
    return { response: { ok: true, status: "kept", tool_result: `The message is kept and ${route.recipient} reads it with its next turn; don't send it again.` } };
  }
}

/** What happens to a message once it is written: kept without waking anyone (agents off, the cap) or handed to the waker. */
async function handOver(store: MessageStore, wake: Waker, message: AgentLenMessage, route: Route): Promise<ToolOutcome> {
  if (!assistantsEnabled()) {
    await store.hold([message.id], "agents_off");
    return held("agents_off", `Agents are off right now; the message is kept and ${route.recipient} reads it with its next turn.`);
  }
  // The cap of four, over both directions and both chats of the pair: the message just written is one of the count.
  const since = await store.lastPersonMessageAt(route.assistantId, route.projectId, route.ctx.homeProjectId);
  const count = await store.messagesSince(route.assistantId, route.projectId, since);
  if (capReached(count - 1)) {
    await store.hold([message.id], "cap");
    return held("cap", `You and ${route.recipient} have written ${MESSAGE_CAP} times without ${route.person}; this waits for their next message.`);
  }
  if ((await wake(message, route.ctx)) === "no_credits") {
    await store.hold([message.id], "no_credits");
    return held("no_credits", `Not enough credits to run ${route.recipient}'s turn now; the message is kept and ${route.recipient} reads it with its next turn.`);
  }
  return { response: { ok: true, status: "waking", tool_result: `Sent to ${route.recipient}; it reads it now.` } };
}
