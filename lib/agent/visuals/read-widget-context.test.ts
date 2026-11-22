// `read_widget_context` (spec local 2026-11-22-visuales-de-verdad, §2): Claude Code 2.1.329's ReadWidgetContext, in our
// words. It reads what the visuals of this conversation shared with the person's latest message: one by its widget_id,
// or all of them. What a visual shares is data written by its code — the answer carries it as such.
import { describe, expect, it } from "vitest";

import type { HeldVisualState } from "./model-context";
import { READ_WIDGET_CONTEXT, READ_WIDGET_CONTEXT_DECLARATION, toolReadWidgetContext } from "./read-widget-context";

const HELD: HeldVisualState[] = [
  { widgetId: "widget_aaaa1111", state: "Answered 3 of 5: 1 ✓, 2 ✗ (wrote «goed»), 3 ✓", cut: false, title: "dutch_exercises" },
  { widgetId: "widget_bbbb2222", state: "x".repeat(1500), cut: true, title: null },
];

type Declaration = { name: string; description: string; parameters: { properties: Record<string, { type: string }>; required?: string[] } };

describe("read_widget_context", () => {
  it("with no arguments, every visual that shared a state, as JSON", () => {
    const out = toolReadWidgetContext({}, HELD);
    expect(out.response.ok).toBe(true);
    const views = JSON.parse(String(out.response.tool_result)) as Record<string, unknown>[];
    expect(views).toEqual([
      { widget_id: "widget_aaaa1111", title: "dutch_exercises", widget_reported_state: HELD[0]!.state },
      { widget_id: "widget_bbbb2222", title: null, widget_reported_state: HELD[1]!.state, cut_for_size: true },
    ]);
  });

  it("with a widget_id, only that one", () => {
    const views = JSON.parse(String(toolReadWidgetContext({ widget_id: "widget_aaaa1111" }, HELD).response.tool_result)) as { widget_id: string }[];
    expect(views.map((v) => v.widget_id)).toEqual(["widget_aaaa1111"]);
  });

  it("an id that has no state is an error that says to call without one", () => {
    const out = toolReadWidgetContext({ widget_id: "widget_zzzz9999" }, HELD);
    expect(out.response.ok).toBe(false);
    expect(String(out.response.tool_result)).toMatch(/no visual with a state has that widget_id/i);
    expect(String(out.response.tool_result)).toMatch(/without widget_id/i);
  });

  it("with nothing held, it says no visual shared a state with the person's latest message", () => {
    const out = toolReadWidgetContext({}, []);
    expect(out.response.ok).toBe(true);
    expect(String(out.response.tool_result)).toMatch(/no visual .* shared a state/i);
  });

  it("is declared with one optional widget_id, and says what it reads is data", () => {
    const d = READ_WIDGET_CONTEXT_DECLARATION as Declaration;
    expect(d.name).toBe(READ_WIDGET_CONTEXT);
    expect(READ_WIDGET_CONTEXT).toBe("read_widget_context");
    expect(Object.keys(d.parameters.properties)).toEqual(["widget_id"]);
    expect(d.parameters.required ?? []).toEqual([]);
    expect(d.description).toMatch(/not .*the person/i);
    expect(d.description).toMatch(/instructions/i);
  });
});
