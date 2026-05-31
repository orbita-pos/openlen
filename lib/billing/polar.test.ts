import { beforeEach, describe, expect, it, vi } from "vitest";

import { CREDITS_BY_PLAN } from "@/lib/credits";

// Mock the DB the same way webhook-route.test.ts does — a chainable builder.
// `selectRows` is what the user lookup returns; `setMock` captures the UPDATE
// payload so we can assert plan / credit transitions without a real database.
const { selectRows, setMock } = vi.hoisted(() => ({
  selectRows: { value: [] as Array<{ plan: string }> },
  setMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  schema: { users: { id: "id", plan: "plan" } },
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectRows.value),
        }),
      }),
    }),
    update: () => ({
      set: (payload: Record<string, unknown>) => {
        setMock(payload);
        return { where: () => Promise.resolve(undefined) };
      },
    }),
  },
}));

import { applySubscriptionState } from "@/lib/billing/polar";

describe("applySubscriptionState", () => {
  beforeEach(() => {
    setMock.mockReset();
    selectRows.value = [];
  });

  it("free + active → pro with the Pro allotment + refreshedAt set", async () => {
    selectRows.value = [{ plan: "free" }];
    await applySubscriptionState({ userId: "u1", status: "active" });
    expect(setMock).toHaveBeenCalledTimes(1);
    const payload = setMock.mock.calls[0][0];
    expect(payload.plan).toBe("pro");
    expect(payload.credits).toBe(CREDITS_BY_PLAN.pro);
    expect(payload.creditsRefreshedAt).toBeInstanceOf(Date);
  });

  it("already-pro + active → no credit refill (anti-refill)", async () => {
    selectRows.value = [{ plan: "pro" }];
    await applySubscriptionState({ userId: "u1", status: "active" });
    const payload = setMock.mock.calls[0][0];
    expect(payload.plan).toBe("pro");
    expect(payload).not.toHaveProperty("credits");
    expect(payload).not.toHaveProperty("creditsRefreshedAt");
  });

  it("trialing keeps pro access", async () => {
    selectRows.value = [{ plan: "free" }];
    await applySubscriptionState({ userId: "u1", status: "trialing" });
    expect(setMock.mock.calls[0][0].plan).toBe("pro");
  });

  it("past_due keeps pro and does NOT refill credits", async () => {
    selectRows.value = [{ plan: "pro" }];
    await applySubscriptionState({ userId: "u1", status: "past_due" });
    const payload = setMock.mock.calls[0][0];
    expect(payload.plan).toBe("pro");
    expect(payload).not.toHaveProperty("credits");
  });

  it("canceled → free", async () => {
    selectRows.value = [{ plan: "pro" }];
    await applySubscriptionState({ userId: "u1", status: "canceled" });
    expect(setMock.mock.calls[0][0].plan).toBe("free");
  });

  it("an unknown status leaves the plan unchanged (no UPDATE)", async () => {
    selectRows.value = [{ plan: "pro" }];
    await applySubscriptionState({ userId: "u1", status: "weird_status" });
    expect(setMock).not.toHaveBeenCalled();
  });

  it("unknown user → no UPDATE", async () => {
    selectRows.value = [];
    await applySubscriptionState({ userId: "ghost", status: "active" });
    expect(setMock).not.toHaveBeenCalled();
  });

  it("persists customerId only when provided (no null overwrite)", async () => {
    selectRows.value = [{ plan: "free" }];
    await applySubscriptionState({ userId: "u1", status: "active" });
    expect(setMock.mock.calls[0][0]).not.toHaveProperty("polarCustomerId");

    setMock.mockReset();
    selectRows.value = [{ plan: "free" }];
    await applySubscriptionState({
      userId: "u1",
      status: "active",
      customerId: "cus_9",
    });
    expect(setMock.mock.calls[0][0].polarCustomerId).toBe("cus_9");
  });
});
