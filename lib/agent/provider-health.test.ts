import { beforeEach, describe, expect, it } from "vitest";

import { COOL_MS, FALLBACK_TURNS_TO_COOL, _resetProviderHealth, coolDown, isCooling, noteTurn } from "./provider-health";

beforeEach(() => _resetProviderHealth());

describe("provider health", () => {
  it("three fallback turns in a row cool the primary for 5 minutes", () => {
    expect(FALLBACK_TURNS_TO_COOL).toBe(3);
    expect(COOL_MS).toBe(300_000);
    noteTurn({ primary: "deepinfra", fellBack: true, now: 0 });
    noteTurn({ primary: "deepinfra", fellBack: true, now: 10 });
    expect(isCooling("deepinfra", 20)).toBe(false);
    noteTurn({ primary: "deepinfra", fellBack: true, now: 20 });
    expect(isCooling("deepinfra", 21)).toBe(true);
    expect(isCooling("fireworks", 21)).toBe(false);
    expect(isCooling("deepinfra", 20 + COOL_MS - 1)).toBe(true);
    expect(isCooling("deepinfra", 20 + COOL_MS)).toBe(false);
  });

  it("a turn without fallback puts the count back to 0", () => {
    noteTurn({ primary: "deepinfra", fellBack: true, now: 0 });
    noteTurn({ primary: "deepinfra", fellBack: true, now: 1 });
    noteTurn({ primary: "deepinfra", fellBack: false, now: 2 });
    noteTurn({ primary: "deepinfra", fellBack: true, now: 3 });
    expect(isCooling("deepinfra", 4)).toBe(false);
  });

  it("a turn that started on another provider does not touch the count", () => {
    noteTurn({ primary: "deepinfra", fellBack: true, now: 0 });
    noteTurn({ primary: "deepinfra", fellBack: true, now: 1 });
    noteTurn({ primary: "fireworks", fellBack: false, now: 2 });
    noteTurn({ primary: "deepinfra", fellBack: true, now: 3 });
    expect(isCooling("deepinfra", 4)).toBe(true);
  });

  it("coolDown says whether a NEW cooling started, and it can end", () => {
    expect(coolDown("deepinfra", 0)).toBe(true);
    expect(coolDown("deepinfra", 1)).toBe(false);
    expect(isCooling("deepinfra", COOL_MS - 1)).toBe(true);
    expect(isCooling("deepinfra", COOL_MS)).toBe(false);
    expect(coolDown("deepinfra", COOL_MS)).toBe(true);
  });
});
