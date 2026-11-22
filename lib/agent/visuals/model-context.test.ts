// WHAT A VISUAL TELLS THE MODEL (MCP Apps' updateModelContext, SEP-1865): text a visual on the person's screen reports
// for their next message. Code that shows a visitor's text can put anything in it, so it is DATA: it never joins the
// person's own words (the route scans those for `/skill`s and shows them in the chat) and the model reads it inside a
// fence that says so, with `<` escaped so nothing in it can close the fence or open a mark of ours.
import { describe, expect, it } from "vitest";

import {
  cleanVisualContext,
  cleanVisualStates,
  heldVisualStates,
  VISUAL_CONTEXT_MAX_CHARS,
  VISUAL_STATES_MAX,
  VISUAL_STATES_MAX_BYTES,
  VISUAL_STATES_REMINDER_MAX_IDS,
  visualStatesPayload,
  visualStatesReminder,
} from "./model-context";

describe("cleanVisualContext", () => {
  it("is the trimmed text, or nothing when it isn't text", () => {
    expect(cleanVisualContext("  Selected: Marzo \n")).toBe("Selected: Marzo");
    for (const v of [undefined, null, 3, {}, ["a"], "", "   \n "]) expect(cleanVisualContext(v)).toBe("");
  });

  it("🔴 is cut at 1500 characters — the client's cap is not what protects the model", () => {
    expect(VISUAL_CONTEXT_MAX_CHARS).toBe(1500);
    expect(cleanVisualContext("x".repeat(5000))).toHaveLength(1500);
  });

  // Postgres rejects a lone surrogate in a jsonb row («invalid input syntax for type json»), and a provider may too:
  // the report is stored with the turn as `sentText`, so what it holds must be well-formed text.
  describe("🔴 it never holds half of a character", () => {
    const HIGH = String.fromCharCode(0xd83d);
    const LOW = String.fromCharCode(0xde00);
    const REPLACEMENT = String.fromCharCode(0xfffd);
    const loneSurrogates = (s: string) => {
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
          const next = s.charCodeAt(i + 1);
          if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
          i++;
        } else if (c >= 0xdc00 && c <= 0xdfff) return true;
      }
      return false;
    };
    const survivesJson = (s: string) => JSON.parse(JSON.stringify(s)) === s && !loneSurrogates(s);

    it("an emoji straddling the cap is dropped whole, not split", () => {
      const out = cleanVisualContext("x".repeat(VISUAL_CONTEXT_MAX_CHARS - 1) + "😀" + "tail");
      expect(out).toBe("x".repeat(VISUAL_CONTEXT_MAX_CHARS - 1));
      expect(loneSurrogates(out)).toBe(false);
      expect(survivesJson(out)).toBe(true);
    });

    it("an emoji that ends exactly at the cap stays whole", () => {
      const out = cleanVisualContext("x".repeat(VISUAL_CONTEXT_MAX_CHARS - 2) + "😀" + "tail");
      expect(out).toBe("x".repeat(VISUAL_CONTEXT_MAX_CHARS - 2) + "😀");
      expect(out).toHaveLength(VISUAL_CONTEXT_MAX_CHARS);
    });

    it("a lone surrogate that arrives in the body is replaced, wherever it sits", () => {
      const out = cleanVisualContext(`a${HIGH}b${LOW}c😀d`);
      expect(out).toBe(`a${REPLACEMENT}b${REPLACEMENT}c😀d`);
      expect(survivesJson(out)).toBe(true);
      // A lone high one at the very end — what the cut itself used to leave.
      expect(cleanVisualContext(`end${HIGH}`)).toBe(`end${REPLACEMENT}`);
    });

    it("BRAZO DE CONTROL: plain text, accents and whole emoji come back as they came", () => {
      expect(cleanVisualContext("  Selected: Marzo — mañana 😀 日本語 ")).toBe("Selected: Marzo — mañana 😀 日本語");
    });
  });
});

// WHAT EACH VISUAL SHARED (spec local 2026-11-22-visuales-de-verdad, §2; Claude Code 2.1.329's held views): the screen
// sends the latest state of each visual with every message, and the model reads them only when it asks.
describe("cleanVisualStates", () => {
  const ID = "widget_abcd1234";

  it("keeps each visual's trimmed state, and says whether it was cut", () => {
    expect(cleanVisualStates([{ widgetId: ID, state: " 3 of 5 " }])).toEqual([{ widgetId: ID, state: "3 of 5", cut: false }]);
    const [long] = cleanVisualStates([{ widgetId: ID, state: "y".repeat(2000) }]);
    expect(long!.state).toHaveLength(VISUAL_CONTEXT_MAX_CHARS);
    expect(long!.cut).toBe(true);
  });

  it("drops an entry whose id isn't a visual's or whose state is empty", () => {
    expect(cleanVisualStates([{ widgetId: "x", state: "a" }, { widgetId: "widget_ABCD1234", state: "a" }, { widgetId: ID, state: "   " }, { widgetId: ID }, "nope", null])).toEqual([]);
  });

  it("the last entry for a visual wins — including an empty state that clears an earlier one", () => {
    expect(cleanVisualStates([{ widgetId: ID, state: "first" }, { widgetId: "widget_zzzz9999", state: "other" }, { widgetId: ID, state: "last" }])).toEqual([
      { widgetId: ID, state: "last", cut: false },
      { widgetId: "widget_zzzz9999", state: "other", cut: false },
    ]);
    expect(cleanVisualStates([{ widgetId: ID, state: "first" }, { widgetId: "widget_zzzz9999", state: "other" }, { widgetId: ID, state: "   " }])).toEqual([
      { widgetId: "widget_zzzz9999", state: "other", cut: false },
    ]);
  });

  it("🔴 over 256 visuals or 1 MiB, nothing is taken (Claude Code clears what it held)", () => {
    expect(VISUAL_STATES_MAX).toBe(256);
    expect(VISUAL_STATES_MAX_BYTES).toBe(1_048_576);
    const many = Array.from({ length: 257 }, (_, i) => ({ widgetId: `widget_${String(i).padStart(8, "0")}`, state: "a" }));
    expect(cleanVisualStates(many)).toEqual([]);
    expect(cleanVisualStates(many.slice(0, 256))).toHaveLength(256);
    expect(cleanVisualStates([{ widgetId: ID, state: "z".repeat(1_200_000) }])).toEqual([]);
  });

  it("anything that isn't a list is nothing", () => {
    for (const v of [undefined, null, "nope", 3, { widgetId: ID, state: "a" }]) expect(cleanVisualStates(v)).toEqual([]);
  });
});

describe("heldVisualStates", () => {
  it("keeps only the visuals this conversation drew, with their titles", () => {
    const states = cleanVisualStates([{ widgetId: "widget_aaaa1111", state: "a" }, { widgetId: "widget_bbbb2222", state: "b" }]);
    const known = new Map<string, string | null>([["widget_aaaa1111", "spending_by_category"]]);
    expect(heldVisualStates(states, known)).toEqual([{ widgetId: "widget_aaaa1111", state: "a", cut: false, title: "spending_by_category" }]);
  });
});

describe("visualStatesReminder", () => {
  it("BRAZO DE CONTROL: with no state there is no reminder", () => {
    expect(visualStatesReminder([])).toBe("");
  });

  it("names each visual with a state and the tool that reads it, as data", () => {
    const out = visualStatesReminder([
      { widgetId: "widget_aaaa1111", state: "a", cut: false, title: "t" },
      { widgetId: "widget_bbbb2222", state: "b", cut: false, title: null },
    ]);
    expect(out).toContain("widget_aaaa1111");
    expect(out).toContain("widget_bbbb2222");
    expect(out).toContain("read_widget_context");
    expect(out).not.toContain("a, b");
  });

  // Claude Code 2.1.329: names up to 64 widget_ids (slice(0, 64)) and summarizes the rest as ", and N more".
  it("🔴 caps long lists at 64 widget_ids with ', and N more' as in Claude Code 2.1.329", () => {
    expect(VISUAL_STATES_REMINDER_MAX_IDS).toBe(64);
    const many = Array.from({ length: 67 }, (_, i) => ({
      widgetId: `widget_${String(i).padStart(8, "0")}`,
      state: `s${i}`,
      cut: false,
      title: null,
    }));
    const out = visualStatesReminder(many);
    expect(out).toContain("widget_00000063, and 3 more.");
    expect(out).toContain("widget_00000000");
    expect(out).not.toContain("widget_00000064");
    expect(out).not.toContain("widget_00000066");
    expect(out).toContain("with no arguments it returns all of them");
    // Exactly at the cap (64): no truncation suffix.
    expect(visualStatesReminder(many.slice(0, 64))).not.toContain("more");
  });
});

// Final review Important #7: client-side UTF-8 byte cap before sending over the wire.
describe("visualStatesPayload", () => {
  it("🔴 returns [] when the UTF-8 JSON exceeds 1 MiB (e.g. 256 × 1500 multi-byte chars)", () => {
    const small = new Map([["widget_aaaa1111", "3 of 5"]]);
    expect(visualStatesPayload(small)).toEqual([{ widgetId: "widget_aaaa1111", state: "3 of 5" }]);

    // 256 entries × 1500 CJK chars (3 bytes each in UTF-8) = ~1.15 MiB > VISUAL_STATES_MAX_BYTES.
    const big = new Map<string, string>();
    for (let i = 0; i < VISUAL_STATES_MAX; i++) big.set(`widget_${String(i).padStart(8, "0")}`, "あ".repeat(VISUAL_CONTEXT_MAX_CHARS));
    expect(visualStatesPayload(big)).toEqual([]);
  });
});
