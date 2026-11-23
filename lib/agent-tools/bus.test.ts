// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { publishToolChange, subscribeToolChanges, type AgentToolChange } from "./bus";

// The change bus of an agent's tools (spec local 2026-11-22-herramienta-dentro-del-agente, §4): OpenLen runs as one
// process, so what the agent or a screen writes reaches every open stream of that tool in memory.

const doc = (collection: string, docId: string, data: unknown = { n: 1 }) => ({
  collection,
  docId,
  data,
  updatedAt: new Date("2026-11-22T10:00:00Z"),
  updatedBy: "agent" as const,
});

const change = (over: Partial<AgentToolChange> = {}): AgentToolChange => ({ by: "agent", docs: [doc("tareas", "t1")], deleted: [], ...over });

describe("the agent tools' change bus", () => {
  it("hands a change to every subscriber of that tool, and to no other tool's", () => {
    const a1 = vi.fn();
    const a2 = vi.fn();
    const other = vi.fn();
    const offA1 = subscribeToolChanges("tool-a", a1);
    const offA2 = subscribeToolChanges("tool-a", a2);
    const offOther = subscribeToolChanges("tool-b", other);
    const c = change({ by: "person", deleted: [{ collection: "tareas", docId: "t0" }] });
    publishToolChange("tool-a", c);
    expect(a1).toHaveBeenCalledTimes(1);
    expect(a1).toHaveBeenCalledWith(c);
    expect(a2).toHaveBeenCalledTimes(1);
    expect(a2).toHaveBeenCalledWith(c);
    expect(other).not.toHaveBeenCalled();
    offA1();
    offA2();
    offOther();
  });

  it("stops handing changes to a subscriber that unsubscribed, and unsubscribing twice is harmless", () => {
    const fn = vi.fn();
    const off = subscribeToolChanges("tool-c", fn);
    publishToolChange("tool-c", change());
    off();
    off();
    publishToolChange("tool-c", change());
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("publishing to a tool nobody follows is a no-op", () => {
    expect(() => publishToolChange("nobody-follows", change())).not.toThrow();
  });

  it("a subscriber that throws (a closed stream) is dropped and never breaks the others or the writer", () => {
    const dead = vi.fn(() => {
      throw new Error("socket closed");
    });
    const alive = vi.fn();
    subscribeToolChanges("tool-d", dead);
    const off = subscribeToolChanges("tool-d", alive);
    expect(() => publishToolChange("tool-d", change())).not.toThrow();
    publishToolChange("tool-d", change());
    expect(alive).toHaveBeenCalledTimes(2);
    expect(dead).toHaveBeenCalledTimes(1);
    off();
  });

  it("a subscriber that unsubscribes while it is being called doesn't skip the next one", () => {
    const seen: string[] = [];
    let offFirst = () => {};
    offFirst = subscribeToolChanges("tool-e", () => {
      seen.push("first");
      offFirst();
    });
    const offSecond = subscribeToolChanges("tool-e", () => seen.push("second"));
    publishToolChange("tool-e", change());
    publishToolChange("tool-e", change());
    expect(seen).toEqual(["first", "second", "second"]);
    offSecond();
  });

  it("is one bus per process, on globalThis under a registered symbol: a second evaluation of the module reaches the first one's subscribers", async () => {
    expect(Object.getOwnPropertySymbols(globalThis)).toContain(Symbol.for("openlen.agentTools.bus"));
    const fn = vi.fn();
    const off = subscribeToolChanges("tool-f", fn);
    vi.resetModules();
    const again = await import("./bus");
    again.publishToolChange("tool-f", change());
    expect(fn).toHaveBeenCalledTimes(1);
    off();
  });
});
