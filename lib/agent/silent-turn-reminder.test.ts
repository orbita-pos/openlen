import { describe, expect, it } from "vitest";
import { createSilentTurnReminder, SILENT_TURN_TEXT } from "./silent-turn-reminder";

describe("createSilentTurnReminder (as Claude Code: 5 steps, 3 per stretch)", () => {
  const fired = (steps: boolean[], r = createSilentTurnReminder()) => steps.map((spoke) => r.observe(spoke) !== "");

  it("every 5 silent steps, at most 3 times in one silent stretch", () => {
    const got = fired(Array.from({ length: 25 }, () => false));
    expect(got.flatMap((f, i) => (f ? [i + 1] : []))).toEqual([5, 10, 15]);
  });

  it("speaking starts the stretch over, and so does a message from the person", () => {
    const r = createSilentTurnReminder();
    expect(fired([false, false, false, false, true, false, false, false, false], r).some(Boolean)).toBe(false);
    r.reset();
    expect(fired([false, false, false, false, false], r).at(-1)).toBe(true);
  });

  it("the text is Claude Code's, in a system reminder", () => {
    const r = createSilentTurnReminder();
    for (let i = 0; i < 4; i++) r.observe(false);
    expect(r.observe(false)).toBe(`<system-reminder>\n${SILENT_TURN_TEXT}\n</system-reminder>`);
  });
});
