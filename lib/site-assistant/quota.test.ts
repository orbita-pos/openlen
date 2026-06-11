import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the limits layer so the quota logic is tested in isolation (no DB).
const checkAndConsume = vi.fn();
const getUsage = vi.fn();
const getUserPlan = vi.fn();
vi.mock("@/lib/limits", () => ({
  checkAndConsume: (...a: unknown[]) => checkAndConsume(...a),
  getUsage: (...a: unknown[]) => getUsage(...a),
  getUserPlan: (...a: unknown[]) => getUserPlan(...a),
}));

const {
  ASSISTANT_MONTHLY_CAP,
  consumeAssistantMessage,
  getAssistantUsage,
} = await import("./quota");

afterEach(() => vi.clearAllMocks());

describe("ASSISTANT_MONTHLY_CAP", () => {
  it("free gets a trial taste, pro a generous flat allotment", () => {
    expect(ASSISTANT_MONTHLY_CAP.free).toBe(30);
    expect(ASSISTANT_MONTHLY_CAP.pro).toBe(1000);
    expect(ASSISTANT_MONTHLY_CAP.pro).toBeGreaterThan(ASSISTANT_MONTHLY_CAP.free);
  });
});

describe("consumeAssistantMessage", () => {
  it("sizes the cap by the owner's plan and consumes one", async () => {
    getUserPlan.mockResolvedValue("pro");
    checkAndConsume.mockResolvedValue({ ok: true });

    const r = await consumeAssistantMessage("proj_1", "user_1");

    expect(r).toEqual({ ok: true, cap: 1000 });
    expect(getUserPlan).toHaveBeenCalledWith("user_1");
    const [key, windows] = checkAndConsume.mock.calls[0];
    expect(key).toBe("assistant-quota:proj_1");
    expect(windows[0].max).toBe(1000);
  });

  it("reports not-ok when the monthly cap is exhausted", async () => {
    getUserPlan.mockResolvedValue("free");
    checkAndConsume.mockResolvedValue({ ok: false });

    const r = await consumeAssistantMessage("proj_1", "user_1");

    expect(r).toEqual({ ok: false, cap: 30 });
  });
});

describe("getAssistantUsage", () => {
  it("returns used/cap/remaining without consuming", async () => {
    getUserPlan.mockResolvedValue("pro");
    getUsage.mockResolvedValue([{ used: 120 }]);

    const r = await getAssistantUsage("proj_1", "user_1");

    expect(r).toEqual({ used: 120, cap: 1000, remaining: 880 });
    expect(checkAndConsume).not.toHaveBeenCalled();
  });

  it("clamps remaining at zero when over cap", async () => {
    getUserPlan.mockResolvedValue("free");
    getUsage.mockResolvedValue([{ used: 35 }]);

    const r = await getAssistantUsage("proj_1", "user_1");

    expect(r.remaining).toBe(0);
  });
});
