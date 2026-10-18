// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createThumbnailQueue } from "./thumbnail-queue";

afterEach(() => vi.useRealTimers());

it("coalesces repeated requests without postponing the first request indefinitely", async () => {
  vi.useFakeTimers();
  const run = vi.fn(async () => true);
  const q = createThumbnailQueue(run, 100);
  q.schedule("p1");
  await vi.advanceTimersByTimeAsync(90);
  q.schedule("p1");
  await vi.advanceTimersByTimeAsync(10);
  expect(run).toHaveBeenCalledTimes(1);
  expect(q.pending("p1")).toBe(false);
});

it("waits for an active agent and retries once the turn is finished", async () => {
  vi.useFakeTimers();
  let busy = true;
  const run = vi.fn(async () => !busy);
  const q = createThumbnailQueue(run, 100);
  q.schedule("p1");
  await vi.advanceTimersByTimeAsync(100);
  expect(q.pending("p1")).toBe(true);
  busy = false;
  await vi.advanceTimersByTimeAsync(100);
  expect(run).toHaveBeenCalledTimes(2);
  expect(q.pending("p1")).toBe(false);
});

it("a failed capture cools down instead of retrying on every list poll", async () => {
  vi.useFakeTimers();
  const run = vi.fn(async () => { throw new Error("capture unavailable"); });
  const q = createThumbnailQueue(run, 100);
  q.schedule("p1");
  await vi.advanceTimersByTimeAsync(100);
  q.schedule("p1");
  await vi.advanceTimersByTimeAsync(100);
  expect(run).toHaveBeenCalledTimes(1);
  expect(q.pending("p1")).toBe(false);
  await vi.advanceTimersByTimeAsync(60_000);
  q.schedule("p1");
  await vi.advanceTimersByTimeAsync(100);
  expect(run).toHaveBeenCalledTimes(2);
});

it("queues a request arriving during an in-flight capture", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const run = vi.fn().mockImplementationOnce(() => new Promise<boolean>((r) => { finish = () => r(true); })).mockResolvedValue(true);
  const q = createThumbnailQueue(run, 100);
  q.schedule("p1");
  await vi.advanceTimersByTimeAsync(100);
  q.schedule("p1");
  finish();
  await vi.advanceTimersByTimeAsync(100);
  expect(run).toHaveBeenCalledTimes(2);
});
