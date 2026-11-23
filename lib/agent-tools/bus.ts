// THE CHANGE BUS OF AN AGENT'S TOOLS (spec local 2026-11-22-herramienta-dentro-del-agente, §4): what the agent writes with
// `tool_data`, or the person from any screen, is handed in memory to every open stream of that tool, so a change shows on the
// web and the phone at once. OpenLen runs as ONE process on Hetzner (as the chat's hub, lib/chat/hub.ts), so no queue sits
// between a write and the screens that follow it.
//
// A change is what the write left different: the documents as they are now, and the ones that are gone. A subscriber is
// whoever follows one tool (an SSE stream); it never throws into a writer — one that does (a closed connection) is dropped,
// as the hub prunes a dead socket. When the person deletes the tool, whoever follows it is told it is gone, once, and
// forgotten: nothing more will be published to a tool that no longer exists.
import type { AgentToolDoc } from "./store";

export type AgentToolChange = {
  /** Who wrote it: the agent (`tool_data`) or the person (the tool's own screen). */
  by: "agent" | "person";
  /** The documents the write left, with what they hold now. */
  docs: readonly AgentToolDoc[];
  /** The documents the write removed. */
  deleted: readonly { collection: string; docId: string }[];
};

export type ToolChangeListener = (change: AgentToolChange) => void;

/** One follower of a tool: what it hears of a change and, when it wants to, that the tool was deleted. */
type Follower = { readonly change: ToolChangeListener; readonly gone?: () => void };

function createBus() {
  // toolId → its followers, in the order they came.
  const listeners = new Map<string, Set<Follower>>();

  function subscribe(toolId: string, fn: ToolChangeListener, onGone?: () => void): () => void {
    let set = listeners.get(toolId);
    if (!set) {
      set = new Set();
      listeners.set(toolId, set);
    }
    // One entry per subscription, even when the same function subscribes twice.
    const entry: Follower = { change: (change) => fn(change), gone: onGone ? () => onGone() : undefined };
    set.add(entry);
    return () => {
      const current = listeners.get(toolId);
      if (!current) return;
      current.delete(entry);
      if (current.size === 0) listeners.delete(toolId);
    };
  }

  function publish(toolId: string, change: AgentToolChange): void {
    const set = listeners.get(toolId);
    if (!set) return;
    // A copy: a listener that unsubscribes while it is called must not skip the one after it.
    for (const entry of [...set]) {
      try {
        entry.change(change);
      } catch {
        set.delete(entry);
      }
    }
    if (set.size === 0) listeners.delete(toolId);
  }

  function publishGone(toolId: string): void {
    const set = listeners.get(toolId);
    if (!set) return;
    // Forgotten first, so what a follower does on hearing it (it unsubscribes) finds nothing left to do.
    listeners.delete(toolId);
    for (const entry of [...set]) {
      try {
        entry.gone?.();
      } catch {
        // a closed connection: it was already going away
      }
    }
  }

  return { subscribe, publish, publishGone };
}

// One bus per process, on globalThis under a registered symbol, as the chat's hub is: a module can be evaluated more than
// once in one process (instrumentation is its own entry; `next dev` re-evaluates on recompiles), and a second bus would
// never reach the streams subscribed to the first.
const BUS = Symbol.for("openlen.agentTools.bus");
type WithBus = typeof globalThis & { [BUS]?: ReturnType<typeof createBus> };
const bus = ((globalThis as WithBus)[BUS] ??= createBus());

/** Hands a change of this tool's data to everyone following it. */
export function publishToolChange(toolId: string, change: AgentToolChange): void {
  bus.publish(toolId, change);
}

/** Tells everyone following this tool that it was deleted, and forgets them: a deleted tool has no more changes. */
export function publishToolGone(toolId: string): void {
  bus.publishGone(toolId);
}

/** Follows the changes of one tool's data — and, when `onGone` is given, hears that the tool was deleted; the function it
 *  returns stops following. */
export function subscribeToolChanges(toolId: string, fn: ToolChangeListener, onGone?: () => void): () => void {
  return bus.subscribe(toolId, fn, onGone);
}
