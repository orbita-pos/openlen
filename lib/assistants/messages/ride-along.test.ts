// What waited for an agent rides with its person's own turn (spec local 2026-11-21-len-y-el-agente-conversan, decision
// 9): the held messages from Len, claimed by the turn's row and framed per project — they may come from several.
import { describe, expect, it, vi } from "vitest";

import { rideAlongForAgent } from "./policy";
import { claimRideAlongForAgent, giveBackRideAlong, type RideAlongDeps } from "./ride-along";
import type { AgentLenMessage } from "./store";

const AT = new Date("2026-11-21T12:00:00Z");

function msg(id: string, projectId: string, text: string, minute: number): AgentLenMessage {
  return {
    id,
    assistantId: "a1",
    projectId,
    direction: "to_agent",
    text,
    ownerWords: null,
    status: "delivered",
    heldReason: null,
    createdAt: new Date(AT.getTime() - (60 - minute) * 60_000),
    deliveringAt: null,
    deliveredAt: AT,
  };
}

function deps(rows: AgentLenMessage[], titles: Record<string, string | null> = {}): RideAlongDeps & { claimForAgent: ReturnType<typeof vi.fn> } {
  return {
    claimForAgent: vi.fn(async () => rows),
    titlesOf: vi.fn(async (ids: readonly string[]) => new Map(ids.filter((id) => id in titles).map((id) => [id, titles[id]!] as const))),
  };
}

describe("claimRideAlongForAgent", () => {
  it("🔴 claims what waited for the agent with this turn's row, and frames it", async () => {
    const d = deps([msg("m1", "p9", "¿Cuál es el presupuesto?", 1)], { p9: "Presupuesto" });
    const got = await claimRideAlongForAgent("a1", "row-1", AT, d);
    expect(d.claimForAgent).toHaveBeenCalledWith("a1", "row-1", AT);
    expect(got).toEqual({
      ids: ["m1"],
      framing: rideAlongForAgent({ projectTitle: "Presupuesto", projectId: "p9", messages: [{ text: "¿Cuál es el presupuesto?" }] }),
    });
  });

  it("🔴 messages about two projects: each project framed with its own title and id, joined by a blank line", async () => {
    const d = deps(
      [msg("m1", "p9", "¿Cuál es el presupuesto?", 1), msg("m2", "p7", "Ya publiqué la tienda.", 2), msg("m3", "p9", "¿Y el plazo?", 3)],
      { p9: "Presupuesto", p7: "Tienda" },
    );
    const got = await claimRideAlongForAgent("a1", "row-1", AT, d);
    expect(got?.ids).toEqual(["m1", "m2", "m3"]);
    expect(got?.framing).toBe(
      [
        rideAlongForAgent({ projectTitle: "Presupuesto", projectId: "p9", messages: [{ text: "¿Cuál es el presupuesto?" }, { text: "¿Y el plazo?" }] }),
        rideAlongForAgent({ projectTitle: "Tienda", projectId: "p7", messages: [{ text: "Ya publiqué la tienda." }] }),
      ].join("\n\n"),
    );
  });

  it("nothing waited: null, and no framing is ever made of an empty list", async () => {
    const d = deps([]);
    expect(await claimRideAlongForAgent("a1", "row-1", AT, d)).toBeNull();
    expect(d.titlesOf).not.toHaveBeenCalled();
  });

  it("a title that can't be read, or that is blank, falls back to the project's id", async () => {
    const blank = deps([msg("m1", "p9", "Hola.", 1)], { p9: "  " });
    expect((await claimRideAlongForAgent("a1", "row-1", AT, blank))?.framing).toContain("about «p9» (id: p9)");
    const failing: RideAlongDeps = { claimForAgent: async () => [msg("m1", "p9", "Hola.", 1)], titlesOf: async () => { throw new Error("db down"); } };
    expect((await claimRideAlongForAgent("a1", "row-1", AT, failing))?.framing).toContain("about «p9» (id: p9)");
  });
});

describe("giveBackRideAlong", () => {
  it("what the turn didn't keep goes back to waiting, held again; nothing to give, nothing done", async () => {
    const releaseToHeld = vi.fn(async () => {});
    await giveBackRideAlong(["m1", "m2"], { releaseToHeld });
    expect(releaseToHeld).toHaveBeenCalledWith(["m1", "m2"], "no_credits");
    releaseToHeld.mockClear();
    await giveBackRideAlong([], { releaseToHeld });
    expect(releaseToHeld).not.toHaveBeenCalled();
  });
});
