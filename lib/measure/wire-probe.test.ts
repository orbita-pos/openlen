import { describe, expect, it } from "vitest";

import {
  WIRE_PROBE_CAP_USD_DEFAULT,
  WIRE_PROBE_PRICES,
  wireProbeCostUsd,
  wireProbeReport,
  wireProbeSteps,
  wireProbeWorstCaseUsd,
  type WireCall,
  type WireStepId,
} from "./wire-probe";

const IMAGE = { mimeType: "image/png", dataBase64: "AAAA" };
const steps = wireProbeSteps("run1", [IMAGE, { ...IMAGE, dataBase64: "BBBB" }]);
const step = (id: WireStepId) => steps.find((s) => s.id === id)!;

const call = (inputTokens: number, cachedTokens: number, text: string, extra: Partial<WireCall> = {}): WireCall => ({ inputTokens, cachedTokens, outputTokens: 8, text, toolCalls: 0, ms: 900, ...extra });
/** A provider on which everything works: the prefix is read from the cache and the latest prompt is followed. */
const allGood = (): Record<WireStepId, WireCall> => ({
  base: call(8_000, 0, "Hello to you. ALFA"),
  control: call(8_030, 7_990, "See you soon. ALFA"),
  system_in_history: call(16_080, 8_020, "Thank you kindly. BETA"),
  tools_base: call(8_100, 0, "Hello there friend. ALFA"),
  system_after_tool: call(16_150, 8_090, "Noted, all done. BETA"),
  images_base: call(10_000, 0, "Two pictures here. ALFA"),
  images_again: call(10_030, 9_990, "See you soon. ALFA"),
});

describe("the wire probe's steps", () => {
  it("🔴 every step that reads another's cache starts with exactly that step's messages and tools", () => {
    const reading = steps.filter((s) => s.reads);
    expect(reading.map((s) => `${s.id}←${s.reads}`)).toEqual(["control←base", "system_in_history←control", "system_after_tool←tools_base", "images_again←images_base"]);
    for (const s of reading) {
      const before = step(s.reads!);
      expect(JSON.stringify(s.messages.slice(0, before.messages.length))).toBe(JSON.stringify(before.messages));
      expect(s.messages.length).toBeGreaterThan(before.messages.length);
      expect(JSON.stringify(s.tools ?? null)).toBe(JSON.stringify(before.tools ?? null));
    }
  });

  it("the second system message is the WHOLE prompt again with only the rule's word changed, and it sits in the middle", () => {
    const first = step("base").messages[0]!;
    const inHistory = step("system_in_history").messages;
    const second = inHistory.filter((m) => m.role === "system")[1]!;
    expect(first.content).toContain("ALFA");
    expect(second.content).toBe(first.content.split("ALFA").join("BETA"));
    expect(second.content.length).toBe(first.content.length);
    // After it comes the question it has to be obeyed on; before it, a finished exchange.
    expect(inHistory.at(-2)).toBe(second);
    expect(inHistory.at(-1)!.role).toBe("user");
    expect(inHistory[0]).toEqual(first);
  });

  it("after a tool result, the new prompt is the LAST message: where approving a plan leaves it mid-turn", () => {
    const messages = step("system_after_tool").messages;
    expect(messages.at(-1)!.role).toBe("system");
    expect(messages.at(-2)!.functionResponses).toHaveLength(1);
    expect(messages.at(-3)!.functionCalls).toHaveLength(1);
    expect(step("system_after_tool").tools).toHaveLength(1);
  });

  it("each run has its own text, so nothing of an earlier run is in the provider's cache", () => {
    const other = wireProbeSteps("run2", [IMAGE, IMAGE]);
    expect(other[0]!.messages[0]!.content).not.toBe(steps[0]!.messages[0]!.content);
    expect(other[0]!.messages[0]!.content.slice(0, 200)).not.toBe(steps[0]!.messages[0]!.content.slice(0, 200));
  });

  it("the images travel on a user message, two of them", () => {
    expect(step("images_base").messages[1]!.images).toHaveLength(2);
    expect(step("base").messages[1]!.images).toBeUndefined();
  });
});

describe("the wire probe's money", () => {
  it("the worst case of both providers fits under the default cap", () => {
    expect(wireProbeWorstCaseUsd(steps) * 2).toBeLessThan(WIRE_PROBE_CAP_USD_DEFAULT);
    expect(wireProbeWorstCaseUsd(steps)).toBeGreaterThan(0.005);
  });

  it("a call is priced at its provider's list price, the cached part at the cached price", () => {
    expect(wireProbeCostUsd("deepinfra", call(1_000_000, 0, ""))).toBeCloseTo(WIRE_PROBE_PRICES.deepinfra.input + (8 * WIRE_PROBE_PRICES.deepinfra.output) / 1e6, 6);
    expect(wireProbeCostUsd("fireworks", call(1_000_000, 1_000_000, ""))).toBeCloseTo(WIRE_PROBE_PRICES.fireworks.cached + (8 * WIRE_PROBE_PRICES.fireworks.output) / 1e6, 6);
  });
});

describe("what the wire probe concludes", () => {
  it("everything works: accepted, left in place, the latest prompt followed, images cached", () => {
    const r = wireProbeReport("deepinfra", allGood());
    expect(r.control).toBe(true);
    expect(r.systemInHistory).toEqual({ accepted: true, inPlace: true, followsLatest: true });
    expect(r.systemAfterTool).toEqual({ accepted: true, inPlace: true, followsLatest: true });
    expect(r.images).toMatchObject({ cached: true, tokensEach: 1_000 });
    expect(r.usable).toBe(true);
  });

  it("🔴 without the control read from the cache nothing is concluded about position", () => {
    const calls = { ...allGood(), control: call(8_030, 0, "See you soon. ALFA") };
    const r = wireProbeReport("deepinfra", calls);
    expect(r.control).toBe(false);
    expect(r.systemInHistory.inPlace).toBeNull();
    expect(r.usable).toBeNull();
    expect(r.lines.join("\n")).toMatch(/control: .* not read from the cache/i);
  });

  it("a system message the provider moves to the top is seen as the prefix not being read", () => {
    const calls = { ...allGood(), system_in_history: call(16_080, 0, "Thank you kindly. BETA") };
    const r = wireProbeReport("deepinfra", calls);
    expect(r.systemInHistory).toEqual({ accepted: true, inPlace: false, followsLatest: true });
    expect(r.usable).toBe(false);
  });

  it("a model that keeps following the first prompt is seen", () => {
    const calls = { ...allGood(), system_in_history: call(16_080, 8_020, "Thank you kindly. ALFA") };
    expect(wireProbeReport("deepinfra", calls).systemInHistory.followsLatest).toBe(false);
    expect(wireProbeReport("deepinfra", calls).usable).toBe(false);
  });

  it("a rejected request is not accepted, and the rest of that row says nothing", () => {
    const calls = { ...allGood(), system_after_tool: call(0, 0, "", { error: "400 system message must be first" }) };
    const r = wireProbeReport("fireworks", calls);
    expect(r.systemAfterTool).toEqual({ accepted: false, inPlace: null, followsLatest: null });
    expect(r.usable).toBe(false);
    expect(r.lines.join("\n")).toContain("400 system message must be first");
  });

  it("a tool call instead of an answer after the tool result is not «follows»: it is said", () => {
    const calls = { ...allGood(), system_after_tool: call(16_150, 8_090, "", { toolCalls: 1 }) };
    const r = wireProbeReport("deepinfra", calls);
    expect(r.systemAfterTool.followsLatest).toBeNull();
    expect(r.usable).toBeNull();
  });

  it("images that are not cached are seen, and a step that never ran leaves its row unknown", () => {
    const calls: Partial<Record<WireStepId, WireCall>> = { ...allGood(), images_again: call(10_030, 7_900, "See you soon. ALFA") };
    expect(wireProbeReport("deepinfra", calls).images.cached).toBe(false);
    delete calls.images_again;
    expect(wireProbeReport("deepinfra", calls).images.cached).toBeNull();
  });
});
