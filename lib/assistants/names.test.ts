import { describe, expect, it } from "vitest";

import { assistantSlug, checkAssistantInput, slugFromParam } from "./names";

const OK = { name: "Lucía", shape: "blob", color: "#F4A48B", tone: "friendly" };

describe("assistantSlug", () => {
  it("slugs a name", () => {
    expect(assistantSlug("Lucía")).toBe("lucia");
    expect(assistantSlug("Señor Pan")).toBe("senor-pan");
    expect(assistantSlug("  Ana   María ")).toBe("ana-maria");
    expect(assistantSlug("ÑÚ--x")).toBe("nu-x");
    expect(assistantSlug("🙂🙂")).toBe("");
  });
  it("🔴 keeps the letters of every script: a name in Japanese, Korean, Chinese or Cyrillic has its address", () => {
    expect(assistantSlug("さくら")).toBe("さくら");
    expect(assistantSlug("小美")).toBe("小美");
    expect(assistantSlug("민지")).toBe("민지");
    expect(assistantSlug("Ольга Ли")).toBe("ольга-ли");
    expect(checkAssistantInput({ ...OK, name: "さくら" })).toEqual({ ok: true, value: { ...OK, name: "さくら" } });
  });
  it("reads the address's name whether or not it arrives percent-encoded", () => {
    expect(slugFromParam(encodeURIComponent("さくら"))).toBe("さくら");
    expect(slugFromParam("さくら")).toBe("さくら");
    expect(slugFromParam("lucia")).toBe("lucia");
    expect(slugFromParam("%E3")).toBe("%E3");
  });
});

describe("checkAssistantInput", () => {
  it("accepts what the creator sends, with the name tidied", () => {
    expect(checkAssistantInput(OK)).toEqual({ ok: true, value: OK });
    expect(checkAssistantInput({ ...OK, name: "  Señor   Pan " })).toEqual({ ok: true, value: { ...OK, name: "Señor Pan" } });
  });
  it("refuses an empty, slugless or too long name", () => {
    expect(checkAssistantInput({ ...OK, name: "  " })).toEqual({ ok: false, field: "name" });
    expect(checkAssistantInput({ ...OK, name: "🙂" })).toEqual({ ok: false, field: "name" });
    expect(checkAssistantInput({ ...OK, name: "x".repeat(41) })).toEqual({ ok: false, field: "name" });
    expect(checkAssistantInput({ ...OK, name: 7 })).toEqual({ ok: false, field: "name" });
  });
  it("refuses a shape, color or tone it does not know", () => {
    expect(checkAssistantInput({ ...OK, shape: "star" })).toEqual({ ok: false, field: "shape" });
    expect(checkAssistantInput({ ...OK, color: "red" })).toEqual({ ok: false, field: "color" });
    expect(checkAssistantInput({ ...OK, color: "#F4A48" })).toEqual({ ok: false, field: "color" });
    expect(checkAssistantInput({ ...OK, tone: "rude" })).toEqual({ ok: false, field: "tone" });
  });
});
