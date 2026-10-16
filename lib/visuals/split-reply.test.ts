import { describe, expect, it } from "vitest";
import { splitReplyAtWidgets, type ReplyWidget } from "./split-reply";

const w = (code: string): ReplyWidget => ({ title: "t", loadingMessages: [], code });

describe("splitReplyAtWidgets", () => {
  it("without visuals, the text alone", () => {
    expect(splitReplyAtWidgets("Hola", [])).toEqual([{ kind: "text", text: "Hola" }]);
  });

  it("a visual goes where Len put it, between the text before and after", () => {
    expect(splitReplyAtWidgets("Mira: esto", [{ key: "a", offset: 5, widget: w("<p>"), live: false }])).toEqual([
      { kind: "text", text: "Mira:" },
      { kind: "widget", key: "a", widget: w("<p>"), live: false },
      { kind: "text", text: " esto" },
    ]);
  });

  it("an offset past the text puts the visual at the end", () => {
    expect(splitReplyAtWidgets("Hola", [{ key: "a", offset: 99, widget: w("<p>"), live: false }])).toEqual([
      { kind: "text", text: "Hola" },
      { kind: "widget", key: "a", widget: w("<p>"), live: false },
    ]);
  });

  it("two at the same point keep the order given", () => {
    const parts = splitReplyAtWidgets("ab", [
      { key: "1", offset: 1, widget: w("<p>1"), live: false },
      { key: "2", offset: 1, widget: w("<p>2"), live: true },
    ]);
    expect(parts.map((p) => (p.kind === "text" ? p.text : p.key))).toEqual(["a", "1", "2", "b"]);
  });

  it("emits no empty text parts", () => {
    expect(splitReplyAtWidgets("", [{ key: "a", offset: 0, widget: w("<p>"), live: false }])).toEqual([
      { kind: "widget", key: "a", widget: w("<p>"), live: false },
    ]);
  });

  it("an undefined, negative or non-finite offset goes at the end", () => {
    for (const offset of [undefined, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const parts = splitReplyAtWidgets("Hola", [{ key: "a", offset, widget: w("<p>"), live: false }]);
      expect(parts.map((p) => p.kind)).toEqual(["text", "widget"]);
    }
  });
});
