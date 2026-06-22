import { describe, expect, it } from "vitest";
import { COACH_MIN_VIEWS, getCoachTip, isActionable } from "./coach";
import type { Funnel } from "./queries";

function funnel(p: Partial<Funnel>): Funnel {
  return {
    range: "7d",
    saw: 0,
    clicked: 0,
    submitted: 0,
    booked: 0,
    untrackedLeads: 0,
    untrackedBookings: 0,
    sources: [],
    ...p,
  };
}

describe("getCoachTip", () => {
  it("asks for more traffic below the minimum views", () => {
    const tip = getCoachTip(funnel({ saw: COACH_MIN_VIEWS - 1, clicked: 0 }));
    expect(tip.id).toBe("insufficient");
    expect(tip.tone).toBe("info");
    expect(isActionable(tip)).toBe(false);
  });

  it("flags zero clicks despite real traffic", () => {
    const tip = getCoachTip(funnel({ saw: 200, clicked: 0 }));
    expect(tip.id).toBe("no-clicks");
    expect(tip.tone).toBe("action");
    expect(tip.params.views).toBe(200);
    expect(isActionable(tip)).toBe(true);
  });

  it("flags a weak CTR", () => {
    const tip = getCoachTip(funnel({ saw: 100, clicked: 5 }));
    expect(tip.id).toBe("low-ctr");
    expect(tip.params.pct).toBe(5);
    expect(isActionable(tip)).toBe(true);
  });

  it("flags clicks but no leads", () => {
    const tip = getCoachTip(funnel({ saw: 100, clicked: 40, submitted: 0 }));
    expect(tip.id).toBe("no-leads");
    expect(tip.params.clicks).toBe(40);
    expect(isActionable(tip)).toBe(true);
  });

  it("celebrates a healthy funnel (no action)", () => {
    const tip = getCoachTip(funnel({ saw: 100, clicked: 40, submitted: 6 }));
    expect(tip.id).toBe("healthy");
    expect(tip.tone).toBe("good");
    expect(isActionable(tip)).toBe(false);
  });

  it("a bookings-only page is healthy, not 'add a form' (counts booked)", () => {
    const tip = getCoachTip(
      funnel({ saw: 100, clicked: 40, submitted: 0, booked: 5 }),
    );
    expect(tip.id).toBe("healthy");
    expect(tip.params.leads).toBe(5); // submitted + booked
  });

  it("untracked (native no-JS) leads count as conversions, not no-leads", () => {
    const tip = getCoachTip(
      funnel({ saw: 100, clicked: 40, submitted: 0, untrackedLeads: 3 }),
    );
    expect(tip.id).toBe("healthy");
  });

  it("truly zero conversions → no-leads", () => {
    const tip = getCoachTip(
      funnel({ saw: 100, clicked: 40, submitted: 0, booked: 0 }),
    );
    expect(tip.id).toBe("no-leads");
  });

  it("CTR boundary: exactly 10% is healthy enough to move past low-ctr", () => {
    // 10/100 = 0.10, not < 0.10 → falls through to the leads check.
    const tip = getCoachTip(funnel({ saw: 100, clicked: 10, submitted: 1 }));
    expect(tip.id).toBe("healthy");
  });
});
