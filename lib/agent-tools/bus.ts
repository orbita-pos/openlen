// THE CHANGE BUS OF AN AGENT'S TOOLS (spec local 2026-11-22-herramienta-dentro-del-agente, §4): what the agent writes with
// `tool_data`, or the person from any screen, is handed in memory to every open stream of that tool, so a change shows on the
// web and the phone at once. OpenLen runs as ONE process on Hetzner (as the chat's hub, lib/chat/hub.ts), so no queue sits
// between a write and the screens that follow it.
//
// A change is what the write left different: the documents as they are now, and the ones that are gone. A subscriber is
// whoever follows one tool (an SSE stream, a later task); it never throws into a writer — one that does (a closed
// connection) is dropped, as the hub prunes a dead socket.
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

function createBus() {
  // toolId → its subscribers, in the order they came.
  const listeners = new Map<string, Set<ToolChangeListener>>();

  function subscribe(toolId: string, fn: ToolChangeListener): () => void {
    let set = listeners.get(toolId);
    if (!set) {
      set = new Set();
      listeners.set(toolId, set);
    }
    // One entry per subscription, even when the same function subscribes twice.
    const entry: ToolChangeListener = (change) => fn(change);
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
        entry(change);
      } catch {
        set.delete(entry);
      }
    }
    if (set.size === 0) listeners.delete(toolId);
  }

  return { subscribe, publish };
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

/** Follows the changes of one tool's data; the function it returns stops following. */
export function subscribeToolChanges(toolId: string, fn: ToolChangeListener): () => void {
  return bus.subscribe(toolId, fn);
}
