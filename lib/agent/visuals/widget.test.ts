import { describe, expect, it } from "vitest";
import { WidgetArgsError, isSvgWidget, parseWidgetArgs, widgetFrom } from "./widget";

describe("parseWidgetArgs", () => {
  it("reads the three arguments into a widget", () => {
    expect(
      parseWidgetArgs({ title: "visits_week", loading_messages: ["Contando visitas"], widget_code: "<div>hola</div>" }),
    ).toEqual({ title: "visits_week", loadingMessages: ["Contando visitas"], code: "<div>hola</div>" });
  });

  it("rejects a missing or empty widget_code", () => {
    expect(() => parseWidgetArgs({ title: "t", loading_messages: ["a"] })).toThrow(WidgetArgsError);
    expect(() => parseWidgetArgs({ title: "t", loading_messages: ["a"], widget_code: "   " })).toThrow(WidgetArgsError);
  });

  it("rejects a full document instead of a fragment", () => {
    expect(() => parseWidgetArgs({ title: "t", loading_messages: ["a"], widget_code: "  <!DOCTYPE html><p>x</p>" })).toThrow(
      WidgetArgsError,
    );
    expect(() => parseWidgetArgs({ title: "t", loading_messages: ["a"], widget_code: "<HTML><body>x</body></HTML>" })).toThrow(
      WidgetArgsError,
    );
  });

  it("rejects code over the limit, naming its size and the limit", () => {
    expect(() => parseWidgetArgs({ title: "t", loading_messages: ["a"], widget_code: "a".repeat(60_001) })).toThrow(
      "widget_code is 60001 characters; the limit is 60000. Make the visual smaller.",
    );
    expect(parseWidgetArgs({ title: "t", loading_messages: ["a"], widget_code: "a".repeat(60_000) }).code).toHaveLength(60_000);
  });

  it("needs one to four non-empty loading messages", () => {
    const base = { title: "t", widget_code: "<p>x</p>" };
    expect(() => parseWidgetArgs({ ...base })).toThrow(WidgetArgsError);
    expect(() => parseWidgetArgs({ ...base, loading_messages: [] })).toThrow(WidgetArgsError);
    expect(() => parseWidgetArgs({ ...base, loading_messages: ["a", "b", "c", "d", "e"] })).toThrow(WidgetArgsError);
    expect(() => parseWidgetArgs({ ...base, loading_messages: ["a", " "] })).toThrow(WidgetArgsError);
    expect(() => parseWidgetArgs({ ...base, loading_messages: "a" })).toThrow(WidgetArgsError);
  });

  it("trims each loading message and the title to 80 characters", () => {
    const w = parseWidgetArgs({ title: "x".repeat(100), loading_messages: ["m".repeat(100)], widget_code: "<p>x</p>" });
    expect(w.title).toHaveLength(80);
    expect(w.loadingMessages[0]).toHaveLength(80);
  });
});

describe("widgetFrom", () => {
  it("keeps a stored widget as it is", () => {
    expect(widgetFrom({ title: "x", loadingMessages: [], code: "<p>a</p>" })).toEqual({ title: "x", loadingMessages: [], code: "<p>a</p>" });
  });

  it("drops a widget whose code is over the limit", () => {
    expect(widgetFrom({ code: "a".repeat(60_001) })).toBeNull();
  });

  it("drops anything that is not an object with code", () => {
    expect(widgetFrom("nope")).toBeNull();
    expect(widgetFrom(null)).toBeNull();
    expect(widgetFrom({ title: "x" })).toBeNull();
    expect(widgetFrom({ code: "" })).toBeNull();
  });

  it("cleans a malformed title and messages instead of dropping the widget", () => {
    expect(widgetFrom({ title: 5, code: "<p>" })).toEqual({ title: "", loadingMessages: [], code: "<p>" });
    expect(widgetFrom({ title: "t", loadingMessages: ["a", 3, "m".repeat(100), "b", "c", "d"], code: "<p>" })).toEqual({
      title: "t",
      loadingMessages: ["a", "m".repeat(80), "b", "c"],
      code: "<p>",
    });
  });
});

describe("isSvgWidget", () => {
  it("is true only for code that starts with <svg", () => {
    expect(isSvgWidget('  <svg viewBox="0 0 10 10"></svg>')).toBe(true);
    expect(isSvgWidget("<div></div>")).toBe(false);
  });
});
