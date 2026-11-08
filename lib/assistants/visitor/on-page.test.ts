// What «En mi página» shows when her place loads (deferred minors of the phase 2A review): on but not yet published with
// her says so after a reload too, and an app or a game can't have her bubble yet (phase 2B).
import { describe, expect, it } from "vitest";

import { onPageState } from "./on-page";

describe("onPageState", () => {
  it("off", () => {
    expect(onPageState(null, false)).toEqual({ onPage: false, needsPublish: false, forApp: false });
  });

  it("🔴 on but never published with her: needs a publish, after a reload too", () => {
    expect(onPageState({ knowledge: null }, false)).toEqual({ onPage: true, needsPublish: true, forApp: false });
    expect(onPageState({ knowledge: "   " }, false)).toMatchObject({ needsPublish: true });
  });

  it("on and published with her: live", () => {
    expect(onPageState({ knowledge: "Martes a domingo." }, false)).toEqual({ onPage: true, needsPublish: false, forApp: false });
  });

  it("an app or a game: not yet", () => {
    expect(onPageState(null, true)).toEqual({ onPage: false, needsPublish: false, forApp: true });
  });
});
