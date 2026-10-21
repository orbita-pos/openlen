import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ chargeCredits: vi.fn(async (_userId: string, centicredits: number) => centicredits) }));
vi.mock("@/lib/credits", () => ({ chargeCredits: mocks.chargeCredits }));

import { SANDBOX_MODEL, SANDBOX_USD_PER_SECOND, chargeSandbox, sandboxCenticredits } from "./billing";

describe("the sandbox price", () => {
  it("a minute of sandbox is 28 centicredits (0.28 credits)", () => {
    expect(SANDBOX_USD_PER_SECOND).toBeCloseTo(0.000046, 12);
    expect(sandboxCenticredits(60)).toBe(28);
  });

  it("no time, no charge; a fraction of a centicredit rounds up", () => {
    expect(sandboxCenticredits(0)).toBe(0);
    expect(sandboxCenticredits(1)).toBe(1);
  });
});

describe("chargeSandbox", () => {
  beforeEach(() => mocks.chargeCredits.mockClear());

  it("charges the owner on the sandbox surface with the seconds as its use", async () => {
    const moved = await chargeSandbox({ userId: "owner", actorId: "member", projectId: "p", turnId: "t", seconds: 60 });
    expect(moved).toBe(28);
    expect(mocks.chargeCredits).toHaveBeenCalledWith("owner", 28, {
      surface: "sandbox",
      outcome: "ok",
      projectId: "p",
      actorId: "member",
      refId: "t",
      uses: [{ provider: "e2b", model: SANDBOX_MODEL, seconds: 60 }],
    });
  });

  it("a turn that never opened the box charges nothing", async () => {
    expect(await chargeSandbox({ userId: "owner", projectId: "p", turnId: "t", seconds: 0 })).toBe(0);
    expect(mocks.chargeCredits).not.toHaveBeenCalled();
  });
});
