// WHAT THE VISITORS COST THE OWNER (spec local 2026-11-06-asistente-propio, §4.7, §6.2): their credits, within a
// monthly cap of the account, like the apps' AI.
import { describe, expect, it } from "vitest";

import { sleepReason, VISITOR_TURN_RESERVE, visitorCap, visitorMonth } from "./budget";

describe("the visitors' budget", () => {
  it("no balance sleeps for credits, even with room in the cap", () => {
    expect(sleepReason({ balance: 0, spent: 0, inFlight: 0, cap: 10_000 })).toBe("credits");
    expect(sleepReason({ balance: -5, spent: 0, inFlight: 0, cap: 10_000 })).toBe("credits");
  });

  it("🔴 no room for one more turn sleeps for the cap", () => {
    expect(sleepReason({ balance: 5_000, spent: 1_000 - VISITOR_TURN_RESERVE, inFlight: 0, cap: 1_000 })).toBeNull();
    expect(sleepReason({ balance: 5_000, spent: 1_000 - VISITOR_TURN_RESERVE + 1, inFlight: 0, cap: 1_000 })).toBe("cap");
    expect(sleepReason({ balance: 5_000, spent: 900, inFlight: 60, cap: 1_000 })).toBe("cap");
    expect(sleepReason({ balance: 5_000, spent: 0, inFlight: 0, cap: 0 })).toBe("cap");
  });

  it("the default cap is a quarter of the plan; the owner's own is kept within 0…plan", () => {
    expect(visitorCap(null, 50_000)).toBe(12_500);
    expect(visitorCap(2_000, 50_000)).toBe(2_000);
    expect(visitorCap(90_000, 50_000)).toBe(50_000);
    expect(visitorCap(-3, 50_000)).toBe(0);
  });

  it("the month is UTC: 2026-11-30T23:30-06:00 is 2026-12", () => {
    expect(visitorMonth(new Date("2026-11-30T23:30:00-06:00"))).toBe("2026-12");
    expect(visitorMonth(new Date("2026-01-05T00:00:00Z"))).toBe("2026-01");
  });
});
