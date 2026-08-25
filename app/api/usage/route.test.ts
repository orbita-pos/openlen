import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getCreditState: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/credits", () => ({ getCreditState: mocks.getCreditState }));

import { GET } from "./route";

describe("GET /api/usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
  });

  it("expone el instante de recarga calculado por el servidor", async () => {
    mocks.getCreditState.mockResolvedValue({
      plan: "free",
      balance: 3,
      allotment: 20,
      refillsAt: new Date("2026-09-23T12:00:00.000Z"),
    });

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      plan: "free",
      credits: {
        balance: 3,
        allotment: 20,
        refillsAt: "2026-09-23T12:00:00.000Z",
      },
    });
  });
});
