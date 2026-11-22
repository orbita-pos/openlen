// What waited for an agent rides with its person's own turn (spec local 2026-11-21-len-y-el-agente-conversan, decision
// 9): the held messages from Len, claimed by the turn's row and framed per project — they may come from several.
import { describe, expect, it, vi } from "vitest";

import { rideAlongForAgent, rideAlongForLen } from "./policy";
import { claimRideAlongForAgent, claimRideAlongForLen, giveBackRideAlong, type LenRideAlongDeps, type RideAlongDeps } from "./ride-along";
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

// And Len's side (same decision): what agents wrote to Len about THIS project and was kept without waking him rides with
// the next turn a person starts there — each agent framed apart, under its own name, with the owner's words it passed on.
describe("claimRideAlongForLen", () => {
  function forLen(id: string, assistantId: string, text: string, minute: number, ownerWords: string | null = null): AgentLenMessage {
    return { ...msg(id, "p1", text, minute), assistantId, direction: "to_len", ownerWords };
  }
  function lenDeps(rows: AgentLenMessage[], names: Record<string, string | null> = {}): LenRideAlongDeps & { claimForLen: ReturnType<typeof vi.fn>; nameOf: ReturnType<typeof vi.fn> } {
    return {
      claimForLen: vi.fn(async () => rows),
      nameOf: vi.fn(async (id: string) => names[id] ?? null),
    };
  }

  it("🔴 claims what waited for Len in the project with this turn's row, and frames each agent apart, under its name", async () => {
    const d = lenDeps([forLen("m1", "a1", "¿Cuál es el tope?", 1, "dile que 500"), forLen("m2", "a2", "Publiqué la tienda.", 2), forLen("m3", "a1", "¿Y el plazo?", 3)], { a2: "Ventas" });
    const got = await claimRideAlongForLen("p1", "row-1", AT, new Map([["a1", "Finanzas"]]), d);
    expect(d.claimForLen).toHaveBeenCalledWith("p1", "row-1", AT);
    expect(got).toEqual({
      ids: ["m1", "m2", "m3"],
      framing: rideAlongForLen([
        { agentName: "Finanzas", messages: [{ text: "¿Cuál es el tope?", ownerWords: "dile que 500" }, { text: "¿Y el plazo?", ownerWords: null }] },
        { agentName: "Ventas", messages: [{ text: "Publiqué la tienda.", ownerWords: null }] },
      ]),
    });
    // A name the turn already knew is not looked up again.
    expect(d.nameOf).toHaveBeenCalledTimes(1);
    expect(d.nameOf).toHaveBeenCalledWith("a2");
  });

  it("nothing waited: null, and nobody's name is looked up", async () => {
    const d = lenDeps([]);
    expect(await claimRideAlongForLen("p1", "row-1", AT, new Map(), d)).toBeNull();
    expect(d.nameOf).not.toHaveBeenCalled();
  });

  it("an agent whose name can't be read is «an agent»: a lookup that fails never stops the turn", async () => {
    const gone = lenDeps([forLen("m1", "a9", "Hola.", 1)]);
    expect((await claimRideAlongForLen("p1", "row-1", AT, new Map(), gone))?.framing).toContain('<agent-message from="an agent">');
    const failing: LenRideAlongDeps = { claimForLen: async () => [forLen("m1", "a9", "Hola.", 1)], nameOf: async () => { throw new Error("db down"); } };
    expect((await claimRideAlongForLen("p1", "row-1", AT, new Map(), failing))?.framing).toContain('<agent-message from="an agent">');
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
