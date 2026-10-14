// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHROMIUM_NICE, deprioritizeChromium } from "./chromium-nice";

let proc: string;

/** A /proc entry: its stat line (with the parent) and its threads. */
async function processEntry(pid: number, ppid: number, comm: string, threads: number[]) {
  await mkdir(path.join(proc, String(pid), "task"), { recursive: true });
  await writeFile(path.join(proc, String(pid), "stat"), `${pid} (${comm}) S ${ppid} ${pid} ${pid} 0 -1 4194560 0 0`);
  for (const tid of threads) await mkdir(path.join(proc, String(pid), "task", String(tid)));
}

beforeEach(async () => {
  proc = await mkdtemp(path.join(tmpdir(), "fake-proc-"));
  // Chromium (100) → zygote with a name full of spaces and parentheses (200) → renderer (300).
  await processEntry(100, 1, "chrome", [100, 101, 102]);
  await processEntry(200, 100, "chrome (zygote) x", [200]);
  await processEntry(300, 200, "chrome", [300, 301]);
  // Not Chromium's: the app itself and something else on the box.
  await processEntry(50, 1, "node", [50, 51]);
  await processEntry(400, 50, "postgres", [400]);
  await writeFile(path.join(proc, "loadavg"), "0.00 0.00 0.00 1/100 1");
});
afterEach(async () => {
  await rm(proc, { recursive: true, force: true });
});

describe("deprioritizeChromium — Chromium yields the box's CPU", () => {
  it("🔴 every thread of Chromium's tree gets the lower priority, and nothing outside it", () => {
    const calls: Array<[number, number]> = [];
    const n = deprioritizeChromium(100, { platform: "linux", procRoot: proc, setPriority: (tid, p) => void calls.push([tid, p]) });
    expect(n).toBe(6);
    expect(calls.map(([tid]) => tid).sort((a, b) => a - b)).toEqual([100, 101, 102, 200, 300, 301]);
    expect(new Set(calls.map(([, p]) => p))).toEqual(new Set([CHROMIUM_NICE]));
  });

  it("a thread that ended in between doesn't stop the rest", () => {
    const calls: number[] = [];
    const n = deprioritizeChromium(100, {
      platform: "linux",
      procRoot: proc,
      setPriority: (tid) => {
        if (tid === 101) throw new Error("ESRCH");
        calls.push(tid);
      },
    });
    expect(n).toBe(5);
    expect(calls).toContain(301);
  });

  it("off Linux, or without /proc, or without a pid, it does nothing and doesn't throw", () => {
    const never = () => {
      throw new Error("must not be called");
    };
    expect(deprioritizeChromium(100, { platform: "win32", procRoot: proc, setPriority: never })).toBe(0);
    expect(deprioritizeChromium(100, { platform: "linux", procRoot: path.join(proc, "missing"), setPriority: never })).toBe(0);
    expect(deprioritizeChromium(undefined, { platform: "linux", procRoot: proc, setPriority: never })).toBe(0);
  });
});
