import { describe, expect, it } from "vitest";
import { buildVisualsManual } from "./manual";
import { READ_ME_DECLARATION, SHOW_WIDGET_DECLARATION, SHOW_WIDGET_RESULT, toolReadMe, toolShowWidget } from "./tools";
import { VISUAL_MODULES, parseWidgetArgs } from "./widget";

type Declaration = {
  name: string;
  description: string;
  parameters: { properties: Record<string, { enum?: string[]; items?: { enum?: string[] } }>; required?: string[] };
};

const valid = { title: "visits_week", loading_messages: ["Contando visitas"], widget_code: "<div>hola</div>" };

describe("show_widget", () => {
  it("returns the widget to the loop and a short line to the model", () => {
    const out = toolShowWidget(valid);
    expect(out.widget).toEqual(parseWidgetArgs(valid));
    expect(out.response).toEqual({ ok: true, tool_result: SHOW_WIDGET_RESULT });
  });

  it("a bad call is a tool error and carries no widget", () => {
    const out = toolShowWidget({ ...valid, widget_code: "" });
    expect(out.response.ok).toBe(false);
    expect(String(out.response.error)).toContain("widget_code is required");
    expect(String(out.response.tool_result)).toContain("<tool_use_error>");
    expect(out.widget).toBeUndefined();
  });

  it("is declared with the three arguments, all required", () => {
    const d = SHOW_WIDGET_DECLARATION as Declaration;
    expect(d.name).toBe("show_widget");
    expect(Object.keys(d.parameters.properties)).toEqual(["title", "loading_messages", "widget_code"]);
    expect(d.parameters.required).toEqual(["title", "loading_messages", "widget_code"]);
  });
});

describe("read_me", () => {
  it("returns the manual for the modules asked", () => {
    const out = toolReadMe({ modules: ["chart"], platform: "desktop" });
    expect(out.response).toEqual({ ok: true, tool_result: buildVisualsManual(["chart"], "desktop") });
  });

  it("without modules returns only the common part", () => {
    const out = toolReadMe({});
    expect(out.response).toEqual({ ok: true, tool_result: buildVisualsManual([], "unknown") });
  });

  it("an unknown module is a tool error that lists the available ones", () => {
    const out = toolReadMe({ modules: ["art"] });
    expect(out.response.ok).toBe(false);
    expect(out.response.error).toBe("Unknown module: art. Available: chart, diagram, mockup, interactive.");
  });

  it("an unknown platform is read as unknown", () => {
    const out = toolReadMe({ platform: "tv" });
    expect(out.response).toEqual({ ok: true, tool_result: buildVisualsManual([], "unknown") });
  });

  it("is declared with modules and platform, none required", () => {
    const d = READ_ME_DECLARATION as Declaration;
    expect(d.name).toBe("read_me");
    expect(d.parameters.required ?? []).toEqual([]);
    expect(d.parameters.properties.modules?.items?.enum).toEqual([...VISUAL_MODULES]);
    expect(d.parameters.properties.platform?.enum).toEqual(["mobile", "desktop", "unknown"]);
  });
});
