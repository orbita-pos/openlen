// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { DeadHold } from "@/lib/agent/sandbox/store";
import type { SandboxDriver } from "@/lib/agent/sandbox/driver";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agent/sandbox/store", () => ({ takeOverHoldsFromBeforeBoot: vi.fn(), releasePausedBox: vi.fn(), releaseProjectSandbox: vi.fn() }));
vi.mock("@/lib/agent/sandbox/billing", () => ({ chargeSandbox: vi.fn() }));
vi.mock("@/lib/agent/sandbox/reaper", async () => ({
  sandboxCleanupDriver: vi.fn(() => null),
  isNotFound: (e: unknown) => /not found/i.test(e instanceof Error ? e.message : ""),
}));
vi.mock("@/lib/projects/chat", () => ({ cutOffRowsOpenedBeforeBoot: vi.fn() }));

const { BOOT_HOLD_PREFIX, closeTurnsOfThePreviousProcess } = await import("./close-dead-turns");

const KEY = { E2B_API_KEY: "e2b_test" };

const hold = (o: Partial<DeadHold> = {}): DeadHold => ({ projectId: "p1", sandboxId: "sbx-1", turnId: "t1", ownerId: "owner", secondsRun: 120, ...o });

function store(o: { rows?: number | Error; holds?: DeadHold[] | Error } = {}) {
  const answer = <T,>(v: T | Error) => (v instanceof Error ? Promise.reject(v) : Promise.resolve(v));
  return {
    cutOffRows: vi.fn((_s: number) => answer(o.rows ?? 0)),
    takeOverHolds: vi.fn((_s: number, _token: string) => answer(o.holds ?? [])),
    releasePaused: vi.fn(async (_p: string, _t: string) => {}),
    release: vi.fn(async (_p: string, _t: string) => {}),
    jobPerson: vi.fn(async (id: string) => (id === "job-0123456789abcdef" ? "person" : null)),
    settleJobs: vi.fn(async (_s: number, _charged: ReadonlyMap<string, { seconds: number; centicredits: number }>) => 0),
  };
}

function driver(pause: (id: string) => Promise<void> = async () => {}): SandboxDriver & { paused: string[] } {
  const paused: string[] = [];
  return {
    paused,
    create: async () => Promise.reject(new Error("not here")),
    resume: async () => Promise.reject(new Error("not here")),
    kill: async () => Promise.reject(new Error("not here")),
    pause: async (id) => {
      await pause(id);
      paused.push(id);
    },
  };
}

// What a minute of box costs (billing.ts): 28 centicredits.
const charge = vi.fn(async (c: { seconds: number }) => Math.ceil(c.seconds * (28 / 60)));

describe("closing what the previous process left mid-turn, at boot", () => {
  it("🔴 cuts the rows off and closes the boxes, both up to how long this process has lived", async () => {
    const s = store({ rows: 2, holds: [hold()] });
    const log = vi.fn();
    const d = driver();
    expect(await closeTurnsOfThePreviousProcess({ store: s, driver: d, charge, env: KEY, secondsSinceBoot: () => 4.5, log })).toEqual({
      rows: 2,
      holds: 1,
      paused: 1,
      centicredits: 56,
      jobs: 0,
    });
    expect(s.cutOffRows).toHaveBeenCalledWith(4.5);
    expect(s.takeOverHolds).toHaveBeenCalledWith(4.5, expect.stringMatching(new RegExp(`^${BOOT_HOLD_PREFIX}`)));
    expect(log).toHaveBeenCalledWith("[dead-turns] the previous process left 2 turn row(s) cut off and 1 box hold(s) released (1 paused, 56 centicredits charged)");
  });

  it("🔴 a dead turn's box is closed as its turn would have: paused, let go under the boot's own hold, and charged to the owner for what it ran", async () => {
    const s = store({ holds: [hold({ projectId: "p1", sandboxId: "sbx-1", turnId: "dead-turn", ownerId: "owner", secondsRun: 90 })] });
    const d = driver();
    charge.mockClear();
    await closeTurnsOfThePreviousProcess({ store: s, driver: d, charge, env: KEY, secondsSinceBoot: () => 1, log: () => {} });
    expect(d.paused).toEqual(["sbx-1"]);
    const token = s.takeOverHolds.mock.calls[0]![1];
    expect(s.releasePaused).toHaveBeenCalledWith("p1", token);
    expect(s.release).not.toHaveBeenCalled();
    expect(charge).toHaveBeenCalledWith({ userId: "owner", actorId: null, projectId: "p1", turnId: "dead-turn", seconds: 90 });
  });

  it("🔴 a tool's job that died with the process: its box is charged to the job's person, not the project's owner, and its row ends failed once", async () => {
    const s = store({ holds: [hold({ projectId: "tool-1", turnId: "job-0123456789abcdef", ownerId: "owner", secondsRun: 60 })] });
    charge.mockClear();
    await closeTurnsOfThePreviousProcess({ store: s, driver: driver(), charge, env: KEY, secondsSinceBoot: () => 7, log: () => {} });
    expect(charge).toHaveBeenCalledTimes(1);
    expect(charge).toHaveBeenCalledWith({ userId: "person", actorId: null, projectId: "tool-1", turnId: "job-0123456789abcdef", seconds: 60 });
    expect(s.settleJobs).toHaveBeenCalledTimes(1);
    expect(s.settleJobs.mock.calls[0]![0]).toBe(7);
    expect([...s.settleJobs.mock.calls[0]![1]]).toEqual([["job-0123456789abcdef", { seconds: 60, centicredits: 28 }]]);
  });

  it("a job whose row is gone is let go without charging the project's owner", async () => {
    const s = store({ holds: [hold({ turnId: "job-ffffffffffffffff", ownerId: "owner", secondsRun: 60 })] });
    charge.mockClear();
    await closeTurnsOfThePreviousProcess({ store: s, driver: driver(), charge, env: KEY, secondsSinceBoot: () => 1, log: () => {} });
    expect(charge).not.toHaveBeenCalled();
  });

  it("the jobs are settled even without E2B, and a failure there stops nothing", async () => {
    const s = store();
    await closeTurnsOfThePreviousProcess({ store: s, driver: null, charge, env: {}, secondsSinceBoot: () => 3, log: () => {} });
    expect(s.settleJobs).toHaveBeenCalledWith(3, new Map());
    const broken = store({ rows: 2 });
    broken.settleJobs.mockRejectedValueOnce(new Error("no table"));
    expect(await closeTurnsOfThePreviousProcess({ store: broken, driver: null, charge, env: {}, secondsSinceBoot: () => 3, log: () => {} })).toMatchObject({ rows: 2 });
  });

  it("a turn that died before opening its box, or whose project is gone, is let go without a charge", async () => {
    const s = store({ holds: [hold({ projectId: "never", sandboxId: null, secondsRun: 0 }), hold({ projectId: "deleted", ownerId: null })] });
    charge.mockClear();
    const out = await closeTurnsOfThePreviousProcess({ store: s, driver: driver(), charge, env: KEY, secondsSinceBoot: () => 1, log: () => {} });
    expect(out).toMatchObject({ holds: 2, paused: 1, centicredits: 0 });
    expect(s.release).toHaveBeenCalledWith("never", expect.any(String));
    expect(s.releasePaused).toHaveBeenCalledWith("deleted", expect.any(String));
    expect(charge).not.toHaveBeenCalled();
  });

  it("a box E2B no longer has, or that does not pause, is let go as it is and still charged for what it ran", async () => {
    const s = store({ holds: [hold({ projectId: "gone", sandboxId: "sbx-gone" }), hold({ projectId: "busy", sandboxId: "sbx-busy" })] });
    const log = vi.fn();
    charge.mockClear();
    const d = driver(async (id) => {
      throw new Error(id === "sbx-gone" ? "Sandbox sbx-gone not found" : "E2B is down");
    });
    const out = await closeTurnsOfThePreviousProcess({ store: s, driver: d, charge, env: KEY, secondsSinceBoot: () => 1, log });
    expect(out).toMatchObject({ holds: 2, paused: 0 });
    expect(s.release.mock.calls.map((c) => c[0])).toEqual(["gone", "busy"]);
    expect(s.releasePaused).not.toHaveBeenCalled();
    expect(charge).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith("[dead-turns] could not pause sbx-busy project=busy: E2B is down");
    expect(log.mock.calls.some(([l]) => String(l).includes("sbx-gone"))).toBe(false);
  });

  it("a charge that fails does not stop the next box", async () => {
    const s = store({ holds: [hold({ projectId: "a" }), hold({ projectId: "b" })] });
    const failing = vi.fn(async () => {
      throw new Error("ledger down");
    });
    const log = vi.fn();
    const out = await closeTurnsOfThePreviousProcess({ store: s, driver: driver(), charge: failing, env: KEY, secondsSinceBoot: () => 1, log });
    expect(out).toMatchObject({ holds: 2, paused: 2, centicredits: 0 });
    expect(failing).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith("[dead-turns] could not charge the box of project=a: ledger down");
  });

  it("a clean boot says nothing", async () => {
    const log = vi.fn();
    expect(await closeTurnsOfThePreviousProcess({ store: store(), driver: driver(), charge, env: KEY, secondsSinceBoot: () => 1, log })).toEqual({
      rows: 0,
      holds: 0,
      paused: 0,
      centicredits: 0,
      jobs: 0,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("🔴 never throws, and one half failing does not stop the other", async () => {
    const log = vi.fn();
    const rowsFail = store({ rows: new Error("db down"), holds: [hold(), hold({ projectId: "p2" }), hold({ projectId: "p3" })] });
    expect(await closeTurnsOfThePreviousProcess({ store: rowsFail, driver: driver(), charge, env: KEY, secondsSinceBoot: () => 1, log })).toMatchObject({
      rows: 0,
      holds: 3,
    });
    expect(log).toHaveBeenCalledWith("[dead-turns] could not cut off the previous process's turn rows: db down");
    const holdsFail = store({ rows: 1, holds: new Error('relation "projectSandboxes" does not exist') });
    expect(await closeTurnsOfThePreviousProcess({ store: holdsFail, driver: driver(), charge, env: KEY, secondsSinceBoot: () => 1, log })).toMatchObject({
      rows: 1,
      holds: 0,
    });
  });

  it("without E2B no turn holds a box: only the rows are closed", async () => {
    const s = store({ rows: 1, holds: [hold()] });
    expect(await closeTurnsOfThePreviousProcess({ store: s, driver: driver(), charge, env: {}, secondsSinceBoot: () => 1, log: () => {} })).toMatchObject({
      rows: 1,
      holds: 0,
    });
    expect(s.takeOverHolds).not.toHaveBeenCalled();
  });
});
