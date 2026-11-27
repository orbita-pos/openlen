// @vitest-environment node
//
// HOW THE WINDOW ASKS WHETHER THERE IS A NEW VERSION (spec local 2026-11-26-apps-en-el-escritorio, §4.4), as Claude's probe
// does (its own app window's state check, 8 s and one request at a time): every question has a deadline, callers that
// arrive while one is out share it, and a check that only came from the window being looked at again waits a minute.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createStateProbe, FOCUS_PROBE_GAP_MS, PROBE_TIMEOUT_MS } from "./state-probe";

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

/** A question that never answers by itself, and notes whether it was told to stop. */
function hanging() {
  const signals: AbortSignal[] = [];
  const run = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    return new Promise<string>(() => {});
  });
  return { run, signals };
}

describe("createStateProbe", () => {
  it("the numbers are Claude's: 8 s to answer, one minute between checks that only came from looking at the window again", () => {
    expect(PROBE_TIMEOUT_MS).toBe(8000);
    expect(FOCUS_PROBE_GAP_MS).toBe(60_000);
  });

  it("a question that does not answer is given up at 8 s: it is told to stop and the caller hears it", async () => {
    const { run, signals } = hanging();
    const probe = createStateProbe(run);
    const asked = probe.ask();
    const caught = asked.then(
      () => "answered",
      (e: unknown) => (e as Error).name,
    );
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS - 1);
    expect(signals[0]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0]!.aborted).toBe(true);
    await expect(caught).resolves.toBe("TimeoutError");
  });

  it("🔴 a hung question no longer blocks the next one, even when the request never heard it was aborted", async () => {
    const { run } = hanging();
    const probe = createStateProbe(run);
    void probe.ask().catch(() => {});
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
    void probe.ask().catch(() => {});
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("callers that arrive while a question is out share it: one request, one answer", async () => {
    let answer!: (v: string) => void;
    const run = vi.fn(() => new Promise<string>((resolve) => void (answer = resolve)));
    const probe = createStateProbe(run);
    const a = probe.ask();
    const b = probe.ask();
    const c = probe.askOnFocus();
    expect(run).toHaveBeenCalledTimes(1);
    answer("body");
    await expect(Promise.all([a, b, c])).resolves.toEqual(["body", "body", "body"]);
    // Answered, so the next one is a new question.
    void probe.ask();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("a failed question frees the place too", async () => {
    const run = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue("ok");
    const probe = createStateProbe(run);
    await expect(probe.ask()).rejects.toThrow("offline");
    await expect(probe.ask()).resolves.toBe("ok");
  });

  it("a check that only came from looking at the window again is skipped within the minute, and goes out after it", async () => {
    const run = vi.fn(async () => "ok");
    const probe = createStateProbe(run);
    await probe.ask();
    expect(probe.askOnFocus()).toBeNull();
    await vi.advanceTimersByTimeAsync(FOCUS_PROBE_GAP_MS - 1);
    expect(probe.askOnFocus()).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await expect(probe.askOnFocus()).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });

  // What a check that was skipped waits for: the caller schedules ONE trailing check at that moment (a focus inside the
  // minute is deferred, not dropped).
  it("focusDelayMs: nothing to wait for before any question, the rest of the minute after one, nothing once it is over", async () => {
    const run = vi.fn(async () => "ok");
    const probe = createStateProbe(run);
    expect(probe.focusDelayMs()).toBe(0);
    await probe.ask();
    expect(probe.focusDelayMs()).toBe(FOCUS_PROBE_GAP_MS);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(probe.focusDelayMs()).toBe(FOCUS_PROBE_GAP_MS - 20_000);
    await vi.advanceTimersByTimeAsync(FOCUS_PROBE_GAP_MS - 20_000);
    expect(probe.focusDelayMs()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(probe.focusDelayMs()).toBe(0);
  });

  it("focusDelayMs counts from when the last question went out, and a question still out is nothing to wait for", async () => {
    const { run } = hanging();
    const probe = createStateProbe(run);
    void probe.ask().catch(() => {});
    // Out: a focus shares it, so nothing is deferred.
    expect(probe.focusDelayMs()).toBe(0);
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
    expect(probe.focusDelayMs()).toBe(FOCUS_PROBE_GAP_MS - PROBE_TIMEOUT_MS);
  });

  it("the check on opening always runs, whatever the minute says", async () => {
    const run = vi.fn(async () => "ok");
    const probe = createStateProbe(run);
    await probe.ask();
    await probe.ask();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("the minute counts from when the last question went out, so a timeout does not make the window wait longer", async () => {
    const { run } = hanging();
    const probe = createStateProbe(run);
    void probe.ask().catch(() => {});
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
    // 8 s after it went out: still inside the minute.
    expect(probe.askOnFocus()).toBeNull();
    await vi.advanceTimersByTimeAsync(FOCUS_PROBE_GAP_MS - PROBE_TIMEOUT_MS);
    void probe.askOnFocus()?.catch(() => {});
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("askFresh: an answer from after now (the frame loaded again, so an answer to a question already out is too old)", () => {
  it("with nothing out it asks now", async () => {
    const run = vi.fn(async () => "now");
    const probe = createStateProbe(run);
    await expect(probe.askFresh()).resolves.toBe("now");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("with a question out it waits for it, then asks again — never takes the old answer", async () => {
    let answer: (v: string) => void = () => {};
    const run = vi.fn((_signal: AbortSignal) =>
      run.mock.calls.length === 1 ? new Promise<string>((r) => (answer = r)) : Promise.resolve("after"),
    );
    const probe = createStateProbe(run);
    void probe.ask();
    const fresh = probe.askFresh();
    expect(run).toHaveBeenCalledTimes(1);
    answer("before");
    await expect(fresh).resolves.toBe("after");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("a question out that fails still lets the fresh one go out", async () => {
    const run = vi.fn((_signal: AbortSignal) => (run.mock.calls.length === 1 ? Promise.reject(new Error("x")) : Promise.resolve("after")));
    const probe = createStateProbe(run);
    void probe.ask().catch(() => {});
    await expect(probe.askFresh()).resolves.toBe("after");
  });
});
