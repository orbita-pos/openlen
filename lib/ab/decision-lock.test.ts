// @vitest-environment node
// A DECISION HOLDS ITS LOCK WHILE IT RUNS (review: stale-lock recovery): it says it is alive every minute under its token, and
// its closing write is fenced on it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { HEARTBEAT_MS, holdDecision } = await import("./decision-lock");

const ROW = { id: "ab_1234abcd", decisionLockToken: "tok-1" } as never;
const deps = () => ({
  heartbeat: vi.fn(async () => true),
  close: vi.fn(async () => ({ id: "ab_1234abcd" }) as never),
  release: vi.fn(async () => undefined),
  everyMs: HEARTBEAT_MS,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("holdDecision", () => {
  it("🔴 refreshes the lock every minute under ITS token, and stops when told", async () => {
    const d = deps();
    const held = holdDecision(ROW, d);
    expect(d.heartbeat).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(d.heartbeat).toHaveBeenCalledTimes(1);
    expect(d.heartbeat).toHaveBeenCalledWith("ab_1234abcd", "tok-1");
    await vi.advanceTimersByTimeAsync(3 * HEARTBEAT_MS);
    expect(d.heartbeat).toHaveBeenCalledTimes(4);
    held.stop();
    await vi.advanceTimersByTimeAsync(5 * HEARTBEAT_MS);
    expect(d.heartbeat).toHaveBeenCalledTimes(4);
  });

  it("the minute is a tenth of the time after which a lock counts as dead", () => {
    expect(HEARTBEAT_MS).toBe(60_000);
  });

  it("the close is fenced on the token; release gives it back under the token and stops the beat", async () => {
    const d = deps();
    const held = holdDecision(ROW, d);
    await held.close({ status: "kept_a" });
    expect(d.close).toHaveBeenCalledWith("ab_1234abcd", "tok-1", { status: "kept_a" });
    await held.release();
    expect(d.release).toHaveBeenCalledWith("ab_1234abcd", "tok-1");
    await vi.advanceTimersByTimeAsync(2 * HEARTBEAT_MS);
    expect(d.heartbeat).not.toHaveBeenCalled();
  });

  it("a heartbeat that fails or says the lock is gone is only said — the decision goes on", async () => {
    const d = deps();
    d.heartbeat.mockRejectedValueOnce(new Error("db")).mockResolvedValueOnce(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const held = holdDecision(ROW, d);
    await vi.advanceTimersByTimeAsync(2 * HEARTBEAT_MS);
    held.stop();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("a release that fails never throws (the sweep will)", async () => {
    const d = deps();
    d.release.mockRejectedValue(new Error("db"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(holdDecision(ROW, d).release()).resolves.toBeUndefined();
    error.mockRestore();
  });
});
