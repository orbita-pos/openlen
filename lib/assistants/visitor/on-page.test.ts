// What «En mi página» shows when her place loads, and when she can answer visitors at all (phase 2A deferred minors;
// phase 2B: she can answer with published text OR with public data).
import { describe, expect, it } from "vitest";

import { answersVisitors, canAnswer, onPageState } from "./on-page";

const AT = new Date("2026-11-08T10:00:00Z");
const SLOTS = [{ name: "huecos", columns: [{ name: "dia", type: "date" }] }];

describe("canAnswer", () => {
  it("🔴 she can answer with published text OR public data, not with neither", () => {
    expect(canAnswer(null)).toBe(false);
    expect(canAnswer({ knowledge: "Martes a domingo." })).toBe(true);
    expect(canAnswer({ knowledge: "   ", publicData: SLOTS })).toBe(true);
    expect(canAnswer({ knowledge: null, publicData: [] })).toBe(false);
    expect(canAnswer({ knowledge: "  " })).toBe(false);
  });
});

describe("onPageState", () => {
  it("off", () => {
    expect(onPageState(null, false)).toEqual({ onPage: false, needsPublish: false, nothingToKnow: false, forApp: false });
  });

  it("🔴 on but never published with her: needs a publish, after a reload too", () => {
    expect(onPageState({ knowledge: null, knowledgeAt: null, bakedAt: null }, false)).toEqual({ onPage: true, needsPublish: true, nothingToKnow: false, forApp: false });
  });

  // Phase 4: what the project published is kept even when her bubble isn't on it; only a publish WITH her bakes it.
  it("🔴 on, with what was published before she was on: still needs a publish", () => {
    expect(onPageState({ knowledge: "Martes a domingo.", knowledgeAt: AT, bakedAt: null }, false)).toEqual({ onPage: true, needsPublish: true, nothingToKnow: false, forApp: false });
  });

  it("on and published with her: live", () => {
    expect(onPageState({ knowledge: "Martes a domingo.", knowledgeAt: AT, bakedAt: AT }, false)).toEqual({ onPage: true, needsPublish: false, nothingToKnow: false, forApp: false });
    expect(onPageState({ knowledge: "", knowledgeAt: AT, bakedAt: AT, publicData: SLOTS }, true)).toMatchObject({ needsPublish: false, nothingToKnow: false });
  });

  it("an app published with nothing for her to know says so, not «publish first»", () => {
    expect(onPageState({ knowledge: "", knowledgeAt: AT, bakedAt: AT, publicData: [] }, true)).toEqual({ onPage: true, needsPublish: false, nothingToKnow: true, forApp: true });
  });
});

describe("answersVisitors", () => {
  it("🔴 only on the page, with her bubble baked, and something to know", () => {
    expect(answersVisitors(null)).toBe(false);
    expect(answersVisitors({ knowledge: "Martes a domingo.", knowledgeAt: AT, bakedAt: null })).toBe(false);
    expect(answersVisitors({ knowledge: "  ", knowledgeAt: AT, bakedAt: AT })).toBe(false);
    expect(answersVisitors({ knowledge: "Martes a domingo.", knowledgeAt: AT, bakedAt: AT })).toBe(true);
    expect(answersVisitors({ knowledge: "", knowledgeAt: AT, bakedAt: AT, publicData: SLOTS })).toBe(true);
  });
});
