// THE PASS (spec local 2026-11-06-asistente-propio, §4.3.2, §6.5): every five minutes, inside the Next process like the
// scheduler, what visitors asked for gets joined — a few pairs at a time, one failing never stopping the others — and
// once a day what is 90 days quiet is forgotten.
import { describe, expect, it } from "vitest";

import { GROUP_QUIET_MS, GROUPS_PER_PASS } from "./limits";
import { groupingPass, newPassState, startRequestGrouper, type PassDeps } from "./pass";

const NOW = new Date("2026-11-09T12:00:00Z");
const DAY = 86_400_000;

function setup(o: { pairs?: number; fail?: Set<string>; hold?: Promise<void> } = {}) {
  let clock = NOW.getTime();
  const asked: { quietBefore: Date; limit: number }[] = [];
  const grouped: string[] = [];
  const pruned: Date[] = [];
  const pairs = Array.from({ length: o.pairs ?? 3 }, (_, i) => ({ assistantId: `a${i}`, projectId: `p${i}` }));
  const deps: PassDeps = {
    now: () => new Date(clock),
    pendingGroups: async (quietBefore, limit) => {
      asked.push({ quietBefore, limit });
      if (o.hold) await o.hold;
      return pairs.slice(0, limit);
    },
    groupOne: async (pair) => {
      if (o.fail?.has(pair.assistantId)) throw new Error("the provider went away");
      grouped.push(pair.assistantId);
      return "grouped";
    },
    pruneRequests: async (now) => void pruned.push(now),
  };
  return { deps, asked, grouped, pruned, advance: (ms: number) => (clock += ms) };
}

describe("groupingPass", () => {
  it(`takes at most ${GROUPS_PER_PASS} pairs a pass, those quiet for ten minutes`, async () => {
    const s = setup({ pairs: 30 });
    expect(await groupingPass(s.deps, newPassState())).toBe(GROUPS_PER_PASS);
    expect(s.asked).toEqual([{ quietBefore: new Date(NOW.getTime() - GROUP_QUIET_MS), limit: GROUPS_PER_PASS }]);
    expect(s.grouped).toHaveLength(GROUPS_PER_PASS);
  });

  it("🔴 one pair failing doesn't stop the others", async () => {
    const s = setup({ pairs: 3, fail: new Set(["a1"]) });
    expect(await groupingPass(s.deps, newPassState())).toBe(2);
    expect(s.grouped).toEqual(["a0", "a2"]);
  });

  it("prunes at most once a day", async () => {
    const s = setup();
    const state = newPassState();
    await groupingPass(s.deps, state);
    s.advance(5 * 60_000);
    await groupingPass(s.deps, state);
    expect(s.pruned).toHaveLength(1);
    s.advance(DAY);
    await groupingPass(s.deps, state);
    expect(s.pruned).toHaveLength(2);
  });

  it("a pass in flight is not overlapped", async () => {
    let release!: () => void;
    const s = setup({ hold: new Promise<void>((r) => (release = r)) });
    const state = newPassState();
    const first = groupingPass(s.deps, state);
    expect(await groupingPass(s.deps, state)).toBe(0);
    release();
    expect(await first).toBe(3);
    expect(s.asked).toHaveLength(1);
  });
});

describe("startRequestGrouper", () => {
  it("OPENLEN_ASSISTANT=0 starts nothing", async () => {
    const s = setup();
    const grouper = startRequestGrouper({ env: { OPENLEN_ASSISTANT: "0" }, deps: s.deps });
    await new Promise((r) => setTimeout(r, 20));
    grouper.stop();
    expect(s.asked).toHaveLength(0);
  });

  it("starts once per process and runs a first pass", async () => {
    const s = setup();
    const grouper = startRequestGrouper({ env: {}, deps: s.deps });
    expect(startRequestGrouper({ env: {}, deps: setup().deps })).toBe(grouper);
    await new Promise((r) => setTimeout(r, 20));
    grouper.stop();
    expect(s.asked).toHaveLength(1);
  });
});
