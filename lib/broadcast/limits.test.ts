// @vitest-environment node

import { describe, expect, it } from "vitest";
import { MEMBER_CAPS } from "@/lib/members/limits";
import { broadcastCapWindows, broadcastEmailCapKey } from "./limits";

describe("broadcast limits (shared budget)", () => {
  it("charges against the SAME per-site key as member email", () => {
    expect(broadcastEmailCapKey("p1")).toBe("site:p1:member-email");
  });

  it("uses the members monthly cap windows verbatim", () => {
    for (const plan of ["free", "pro"] as const) {
      const w = broadcastCapWindows(plan);
      expect(w[0].max).toBe(MEMBER_CAPS[plan].monthlyEmails);
      expect(w[0].windowMs).toBe(30 * 24 * 60 * 60 * 1000);
      expect(w[0].label).toBe("monthly");
    }
  });
});
