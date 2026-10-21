import { afterEach, expect, it, vi } from "vitest";
import { STILL_WORKING_EVERY_MS, whileWorking } from "./still-working";

afterEach(() => { vi.useRealTimers(); });

function pending<T>() {
  let settle!: { resolve: (v: T) => void; reject: (e: unknown) => void };
  const promise = new Promise<T>((resolve, reject) => { settle = { resolve, reject }; });
  return { promise, ...settle };
}

it("tells the turn it is alive when the command starts and then every interval, until it ends", async () => {
  vi.useFakeTimers();
  const alive = vi.fn();
  const work = pending<string>();
  const run = whileWorking(work.promise, alive);
  expect(alive).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(STILL_WORKING_EVERY_MS * 3);
  expect(alive).toHaveBeenCalledTimes(4);
  work.resolve("done");
  await expect(run).resolves.toBe("done");
  await vi.advanceTimersByTimeAsync(STILL_WORKING_EVERY_MS * 3);
  expect(alive).toHaveBeenCalledTimes(4);
});

it("stops as well when the command fails, and passes the failure on", async () => {
  vi.useFakeTimers();
  const alive = vi.fn();
  const work = pending<string>();
  const run = whileWorking(work.promise, alive);
  work.reject(new Error("worker died"));
  await expect(run).rejects.toThrow("worker died");
  await vi.advanceTimersByTimeAsync(STILL_WORKING_EVERY_MS * 3);
  expect(alive).toHaveBeenCalledTimes(1);
});

it("is just the work when nobody is watching the turn", async () => {
  await expect(whileWorking(Promise.resolve(7), undefined)).resolves.toBe(7);
});

it("speaks well inside the turn's silence window (3 minutes in app/api/agent/route.ts)", () => {
  expect(STILL_WORKING_EVERY_MS).toBeLessThanOrEqual(60_000);
});
