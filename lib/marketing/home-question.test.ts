// The home's question changes with the visitor's own time of day, like claude.ai's greeting (Jesús, 06/11): morning
// 5–12 h, afternoon 12–19 h, evening 19–24 h, night 0–5 h; one of each slot's questions at random per visit.
import { describe, expect, it } from "vitest";
import { pickQuestion, questionSlot } from "./home-question";

describe("which slot an hour falls in", () => {
  it("🔴 the edges", () => {
    expect(questionSlot(0)).toBe("night");
    expect(questionSlot(4)).toBe("night");
    expect(questionSlot(5)).toBe("morning");
    expect(questionSlot(11)).toBe("morning");
    expect(questionSlot(12)).toBe("afternoon");
    expect(questionSlot(18)).toBe("afternoon");
    expect(questionSlot(19)).toBe("evening");
    expect(questionSlot(23)).toBe("evening");
  });
});

describe("which question of the slot", () => {
  const qs = ["a", "b", "c"];
  it("spreads the random number over the list, never past its end", () => {
    expect(pickQuestion(qs, 0)).toBe("a");
    expect(pickQuestion(qs, 0.34)).toBe("b");
    expect(pickQuestion(qs, 0.99)).toBe("c");
    expect(pickQuestion(qs, 1)).toBe("c");
  });

  it("an empty list (a locale missing its slot) gives nothing, so the default stays", () => {
    expect(pickQuestion([], 0.5)).toBeNull();
  });
});
