import { afterEach, describe, expect, it, vi } from "vitest";

import { flushLiveTurns, flushOnExit, installExitFlush } from "./exit-flush";

type Listener = () => void;
function fakeProcess(env: Record<string, string | undefined> = {}) {
  const listeners = new Map<string, Listener[]>();
  const exits: (number | string | null | undefined)[] = [];
  const proc = {
    env,
    exit: ((code?: number | string | null) => {
      exits.push(code);
      return undefined as never;
    }) as (code?: number | string | null) => never,
    once(event: "SIGTERM" | "SIGINT", listener: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
  };
  const signal = (event: "SIGTERM" | "SIGINT") => {
    const all = listeners.get(event) ?? [];
    listeners.set(event, []);
    for (const l of all) l();
  };
  return { proc, exits, signal };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.useRealTimers();
});
const register = (flush: () => Promise<void>) => cleanups.push(flushOnExit(flush));

describe("the exit after a SIGTERM waits for the live turns", () => {
  it("🔴 Next's exit after a SIGTERM happens only once every live turn wrote", async () => {
    const { proc, exits, signal } = fakeProcess();
    let landed!: () => void;
    const order: string[] = [];
    register(() => new Promise<void>((r) => (landed = () => (order.push("turn wrote"), r()))));
    installExitFlush({ proc, log: (l) => order.push(l) });
    signal("SIGTERM");
    proc.exit(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(exits).toEqual([]);
    landed();
    await new Promise((r) => setTimeout(r, 0));
    expect(exits).toEqual([0]);
    expect(order).toHaveLength(2);
    expect(order[0]).toBe("turn wrote");
    // The deploy log says it finished, and how long it took.
    expect(order[1]).toMatch(/^\[exit\] 1 live turn\(s\) wrote what they had before the exit \(\d+ ms\)$/);
  });

  it("a turn that never answers holds the exit back only up to the limit", async () => {
    vi.useFakeTimers();
    const { proc, exits, signal } = fakeProcess();
    register(() => new Promise<void>(() => {}));
    const lines: string[] = [];
    installExitFlush({ proc, timeoutMs: 2000, log: (l) => lines.push(l) });
    signal("SIGTERM");
    proc.exit(0);
    await vi.advanceTimersByTimeAsync(1999);
    expect(exits).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(exits).toEqual([0]);
    // And the deploy log says the limit cut it, not that it wrote.
    expect(lines).toEqual(["[exit] 1 live turn(s) were still writing after 2000 ms: exiting anyway; the next boot closes what they left"]);
  });

  it("with no live turn the exit is the one it always was, at once", () => {
    const { proc, exits, signal } = fakeProcess();
    installExitFlush({ proc, log: () => {} });
    signal("SIGINT");
    proc.exit(3);
    expect(exits).toEqual([3]);
  });

  it("before a signal nothing changes, even with live turns", () => {
    const { proc, exits } = fakeProcess();
    register(() => new Promise<void>(() => {}));
    installExitFlush({ proc, log: () => {} });
    proc.exit(1);
    expect(exits).toEqual([1]);
  });

  it("two exits after the signal flush once and exit once", async () => {
    const { proc, exits, signal } = fakeProcess();
    const flush = vi.fn(async () => {});
    register(flush);
    installExitFlush({ proc, log: () => {} });
    signal("SIGTERM");
    proc.exit(0);
    proc.exit(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(exits).toEqual([0]);
  });

  it("a turn whose write fails does not keep the others from writing nor the exit from happening", async () => {
    const { proc, exits, signal } = fakeProcess();
    const other = vi.fn(async () => {});
    register(async () => {
      throw new Error("db down");
    });
    register(other);
    installExitFlush({ proc, log: () => {} });
    signal("SIGTERM");
    proc.exit(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(other).toHaveBeenCalledTimes(1);
    expect(exits).toEqual([0]);
  });

  it("installed twice on one process (register() again in development), it flushes once", async () => {
    const { proc, exits, signal } = fakeProcess();
    const flush = vi.fn(async () => {});
    register(flush);
    installExitFlush({ proc, log: () => {} });
    installExitFlush({ proc, log: () => {} });
    signal("SIGTERM");
    proc.exit(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(exits).toEqual([0]);
  });

  it("a turn that ended on its own is not flushed", async () => {
    const flush = vi.fn(async () => {});
    const done = flushOnExit(flush);
    done();
    await flushLiveTurns(100);
    expect(flush).not.toHaveBeenCalled();
  });

  it("with NEXT_MANUAL_SIG_HANDLE it stays out: someone else handles the signals", () => {
    const { proc, exits, signal } = fakeProcess({ NEXT_MANUAL_SIG_HANDLE: "true" });
    register(() => new Promise<void>(() => {}));
    installExitFlush({ proc, log: () => {} });
    signal("SIGTERM");
    proc.exit(0);
    expect(exits).toEqual([0]);
  });
});
