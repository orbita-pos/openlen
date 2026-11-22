// WAKING THE RECIPIENT, AND WHAT A RESTART LEFT (spec local 2026-11-21-len-y-el-agente-conversan, §2 and decisions 9, 10
// and 11). A message the mailbox keeps (lib/assistants/messages/store.ts) is handed to its recipient by starting the
// recipient's turn from the server, on the road every server turn takes (lib/agent/turnos-desde-el-servidor.ts):
//   · to Len: his turn in the project's chat, AS THE OWNER (the person whose agent wrote), labelled from the agent;
//   · to an agent: its turn in its own home and conversation, AS ITSELF — `extraBody: { assistantId }`, as its scheduled
//     tasks do.
// The turn waits its turn in the project's queue (decision 10: a recipient already working is never steered; its new turn
// runs when the live one ends) and CLAIMS what is waiting when it STARTS, so two messages written before it began are read
// by one turn and the second wake finds nothing and does not run. A turn that couldn't run (no credits) gives its messages
// back as held: they wait for the recipient's next turn, never lost. When the server starts again, what was being
// delivered (woken and unread, not older than a day) is woken once per recipient; what was held never wakes anything.
import { randomUUID } from "node:crypto";

import type { launchAssistantRequestTurn, launchLenMessageTurn } from "@/lib/agent/turnos-desde-el-servidor";
import type { AssistantRequestOrigin, LenMessageOrigin } from "@/lib/projects/types";

import { framingForAgent, rideAlongForLen, type FramingForLen } from "./policy";
import type * as mailbox from "./store";
import type { AgentLenMessage } from "./store";
import type { Waker } from "./tool";

/** The agent a message belongs to, as waking it needs it: whose turn it is and where it lives. */
export interface WakeAgent {
  readonly id: string;
  /** The person it works for: the turn runs as them (for a project they own, the owner). */
  readonly personId: string;
  readonly name: string;
  readonly homeProjectId: string;
  /** The language its person gave it (its morning summary's); null when it has none. */
  readonly locale: string | null;
}

/** Everything waking reaches out to, injected so the tests never touch a database, a queue or a model. */
export interface WakeDeps {
  readonly store: Pick<typeof mailbox, "markDelivering" | "claimForLen" | "claimForAgent" | "releaseToHeld" | "hold" | "toResume">;
  agentOf(assistantId: string): Promise<WakeAgent | null>;
  /** The titles of the projects that exist, as `titlesOf` (lib/assistants/projects.ts) answers them. */
  titlesOf(projectIds: readonly string[]): Promise<Map<string, string | null>>;
  /** The person's own zone, for the turn's clock. */
  zoneOf(personId: string): Promise<string>;
  readonly launchForLen: typeof launchAssistantRequestTurn;
  readonly launchForAgent: typeof launchLenMessageTurn;
  now(): Date;
  /** The turn's chat row: its id is what the claim marks the messages read by. */
  newRowId(): string;
  /** Whether agents are on (`OPENLEN_ASSISTANT`). */
  enabled(): boolean;
}

async function liveDeps(): Promise<WakeDeps> {
  const [store, { assistantById }, { titlesOf }, turns, { assistantsEnabled }] = await Promise.all([
    import("./store"),
    import("../store"),
    import("../projects"),
    import("@/lib/agent/turnos-desde-el-servidor"),
    import("../enabled"),
  ]);
  return {
    store,
    agentOf: async (assistantId) => {
      const a = await assistantById(assistantId);
      return a ? { id: a.id, personId: a.personId, name: a.name, homeProjectId: a.homeProjectId, locale: a.summaryLocale } : null;
    },
    titlesOf,
    // The zone of their notification preferences, as the morning summary reads it.
    zoneOf: async (personId) => (await (await import("@/lib/notifications/dispatch")).loadPrefs(personId)).timezone,
    launchForLen: turns.launchAssistantRequestTurn,
    launchForAgent: turns.launchLenMessageTurn,
    now: () => new Date(),
    newRowId: () => randomUUID(),
    enabled: () => assistantsEnabled(),
  };
}

/** `items` by `key`, in the order each key first appears: the oldest message's recipient first. */
function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

/** The title of each project, or its id when it has none or can't be read: a lookup that fails never stops a turn. */
async function titlesFor(d: WakeDeps, projectIds: readonly string[]): Promise<Map<string, string>> {
  const found = await d.titlesOf(projectIds).catch(() => new Map<string, string | null>());
  return new Map(projectIds.map((id) => [id, found.get(id)?.trim() || id] as const));
}

const lenOrigin = (assistantId: string, assistantName: string): AssistantRequestOrigin => ({ kind: "assistant", assistantId, assistantName, message: true });

/** Starts the recipient's turn for a message already in the mailbox: the real `Waker` (lib/assistants/messages/tool.ts, the
 *  default of `runSendMessage`). `ctx` is the AGENT's home and name, whichever side wrote. Returns once the turn is queued:
 *  whether the person can pay for it is only known when it starts, and then its `fail` gives the messages back as held.
 *  `onTheirWay`: every message this turn was woken for (a restart's group, `m` among them), held when it fails before
 *  its claim; by default only `m`. */
export async function wakeRecipient(m: AgentLenMessage, ctx: Parameters<Waker>[1], deps?: WakeDeps, onTheirWay: readonly string[] = [m.id]): ReturnType<Waker> {
  const d = deps ?? (await liveDeps());
  const agent = await d.agentOf(m.assistantId);
  if (!agent) throw new Error(`the agent ${m.assistantId} no longer exists: nothing to wake for message ${m.id}`);
  const timeZone = await d.zoneOf(agent.personId).catch(() => "UTC");
  const locale = agent.locale?.trim() || "en";
  const filaId = d.newRowId();
  /** What this turn's own claim returned: the only messages it may give back. */
  const taken: string[] = [];
  const turn = {
    userId: agent.personId,
    texto: m.text,
    framing: "",
    timeZone,
    locale,
    filaId,
    // The route writes the turn's row and sends what the person must hear; there is nothing to send back from here.
    reply: async () => {},
    onStart: async () => {},
    // The turn didn't answer (no credits, a rejection, Len busy for too long): the messages go back to waiting for the
    // recipient's next turn — what its claim took, or, before it claimed, every message it was woken for (a restart's
    // group: the others would stay delivering until a later restart, final review m7). One cut in the middle had read
    // them already.
    fail: async (_fallo: unknown, cut: boolean) => {
      if (cut) return;
      if (taken.length > 0) await d.store.releaseToHeld(taken, "no_credits");
      else await d.store.hold(onTheirWay, "no_credits");
    },
  };

  if (m.direction === "to_len") {
    await d.store.markDelivering(m.id, d.now());
    d.launchForLen(
      {
        ...turn,
        projectId: m.projectId,
        origin: lenOrigin(agent.id, ctx.agentName),
        resolveAtStart: async () => {
          const rows = await d.store.claimForLen(m.projectId, filaId, d.now());
          if (rows.length === 0) return null;
          taken.push(...rows.map((r) => r.id));
          // Everything waiting for Len in the project, from any agent: each one is read under its own name.
          const byAgent = groupBy(rows, (r) => r.assistantId);
          const names = new Map([[agent.id, ctx.agentName]]);
          for (const id of byAgent.keys()) if (!names.has(id)) names.set(id, (await d.agentOf(id).catch(() => null))?.name ?? "an agent");
          const groups: FramingForLen[] = [...byAgent].map(([id, mine]) => ({ agentName: names.get(id)!, messages: mine.map((r) => ({ text: r.text, ownerWords: r.ownerWords })) }));
          const first = rows[0]!;
          // Whether any of them carries the owner's words (the framing's own test): without them the route lets this turn
          // do nothing that needs them (final review, I2).
          const withOwnerWords = rows.some((r) => r.ownerWords);
          return { framing: rideAlongForLen(groups), origin: { ...lenOrigin(first.assistantId, names.get(first.assistantId)!), ...(withOwnerWords ? { withOwnerWords: true as const } : {}) } };
        },
      },
      // Len read them and wrote nothing: that is a turn that ran, not one that didn't.
      { quietWhenNoReply: true },
    );
    return "waking";
  }

  const titles = await titlesFor(d, [m.projectId]);
  await d.store.markDelivering(m.id, d.now());
  const originOf = (projectId: string): LenMessageOrigin => ({ kind: "len-message", projectId, projectTitle: titles.get(projectId) ?? projectId });
  d.launchForAgent({
    ...turn,
    // An agent's turn runs in its home, in its own conversation; the route knows it is the agent's by the id in the body.
    projectId: ctx.homeProjectId,
    extraBody: { assistantId: agent.id },
    origin: originOf(m.projectId),
    resolveAtStart: async () => {
      const rows = await d.store.claimForAgent(agent.id, filaId, d.now());
      if (rows.length === 0) return null;
      taken.push(...rows.map((r) => r.id));
      // Everything waiting for the agent, from any project of its person's: each project framed with its own id, so the
      // reply goes back to the right one.
      const byProject = groupBy(rows, (r) => r.projectId);
      const missing = [...byProject.keys()].filter((id) => !titles.has(id));
      if (missing.length > 0) for (const [id, title] of await titlesFor(d, missing)) titles.set(id, title);
      const framing = [...byProject].map(([projectId, mine]) => framingForAgent({ projectTitle: titles.get(projectId) ?? projectId, projectId, messages: mine.map((r) => ({ text: r.text })) })).join("\n\n");
      return { framing, origin: originOf(rows[0]!.projectId) };
    },
  });
  return "waking";
}

/** What a restart left: wakes each recipient with messages that were being delivered once — Len in a project, an agent —
 *  and hands its turn everything waiting for it. A recipient that no longer exists (a deleted agent or project) is
 *  skipped; one that can't be woken doesn't stop the rest. With agents off nothing wakes: the messages are kept. Returns
 *  how many recipients it woke. Never throws. */
export async function resumeAgentLenMessages(now: Date = new Date(), deps?: WakeDeps): Promise<number> {
  try {
    const d = deps ?? (await liveDeps());
    const rows = await d.store.toResume(now);
    if (rows.length === 0) return 0;
    if (!d.enabled()) {
      await d.store.hold(rows.map((r) => r.id), "agents_off");
      return 0;
    }
    let woken = 0;
    for (const group of groupBy(rows, (r) => (r.direction === "to_len" ? `len:${r.projectId}` : `agent:${r.assistantId}`)).values()) {
      try {
        if (await wakeGroup(d, group)) woken += 1;
      } catch (err) {
        console.warn("[agent-messages] a recipient couldn't be woken after the restart", err);
      }
    }
    if (woken > 0) console.info(`[agent-messages] ${woken} recipient(s) woken after the restart`);
    return woken;
  } catch (err) {
    console.error("[agent-messages] the messages on their way couldn't be resumed", err);
    return 0;
  }
}

/** One recipient's turn, started from its oldest message whose agent still exists. Its claim would take the whole group,
 *  so a turn that fails before claiming holds the whole group too. */
async function wakeGroup(d: WakeDeps, group: readonly AgentLenMessage[]): Promise<boolean> {
  // Len's messages in one project share it: a project that is gone has no one to wake.
  if (group[0]!.direction === "to_len" && !(await d.titlesOf([group[0]!.projectId])).has(group[0]!.projectId)) return false;
  for (const m of group) {
    const agent = await d.agentOf(m.assistantId);
    if (!agent) continue;
    await wakeRecipient(m, { homeProjectId: agent.homeProjectId, agentName: agent.name }, d, group.map((r) => r.id));
    return true;
  }
  return false;
}
