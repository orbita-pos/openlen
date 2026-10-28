// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agent/sandbox/store", () => ({ releaseHoldsFromBeforeBoot: vi.fn() }));
vi.mock("@/lib/projects/chat", () => ({ cutOffRowsOpenedBeforeBoot: vi.fn() }));

const { closeTurnsOfThePreviousProcess } = await import("./close-dead-turns");

const KEY = { E2B_API_KEY: "e2b_test" };

function store(o: { rows?: number | Error; holds?: number | Error } = {}) {
  const answer = (v: number | Error | undefined) => (v instanceof Error ? Promise.reject(v) : Promise.resolve(v ?? 0));
  return {
    cutOffRows: vi.fn((_s: number) => answer(o.rows)),
    releaseHolds: vi.fn((_s: number) => answer(o.holds)),
  };
}

describe("closing what the previous process left mid-turn, at boot", () => {
  it("🔴 cuts the rows off and releases the holds, both up to how long this process has lived", async () => {
    const s = store({ rows: 2, holds: 1 });
    const log = vi.fn();
    expect(await closeTurnsOfThePreviousProcess({ store: s, env: KEY, secondsSinceBoot: () => 4.5, log })).toEqual({ rows: 2, holds: 1 });
    expect(s.cutOffRows).toHaveBeenCalledWith(4.5);
    expect(s.releaseHolds).toHaveBeenCalledWith(4.5);
    expect(log).toHaveBeenCalledWith("[dead-turns] the previous process left 2 turn row(s) cut off and 1 box hold(s) released");
  });

  it("a clean boot says nothing", async () => {
    const log = vi.fn();
    expect(await closeTurnsOfThePreviousProcess({ store: store(), env: KEY, secondsSinceBoot: () => 1, log })).toEqual({ rows: 0, holds: 0 });
    expect(log).not.toHaveBeenCalled();
  });

  it("🔴 never throws, and one half failing does not stop the other", async () => {
    const log = vi.fn();
    const rowsFail = store({ rows: new Error("db down"), holds: 3 });
    expect(await closeTurnsOfThePreviousProcess({ store: rowsFail, env: KEY, secondsSinceBoot: () => 1, log })).toEqual({ rows: 0, holds: 3 });
    expect(log).toHaveBeenCalledWith("[dead-turns] could not cut off the previous process's turn rows: db down");
    const holdsFail = store({ rows: 1, holds: new Error('relation "projectSandboxes" does not exist') });
    expect(await closeTurnsOfThePreviousProcess({ store: holdsFail, env: KEY, secondsSinceBoot: () => 1, log })).toEqual({ rows: 1, holds: 0 });
  });

  it("without E2B no turn holds a box: only the rows are closed", async () => {
    const s = store({ rows: 1, holds: 5 });
    expect(await closeTurnsOfThePreviousProcess({ store: s, env: {}, secondsSinceBoot: () => 1, log: () => {} })).toEqual({ rows: 1, holds: 0 });
    expect(s.releaseHolds).not.toHaveBeenCalled();
  });
});
