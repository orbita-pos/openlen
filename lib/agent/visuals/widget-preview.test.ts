import { describe, expect, it } from "vitest";
import { createWidgetPreview } from "./widget-preview";

const head = '{"title":"visits_week","loading_messages":["Contando visitas"],"widget_code":"';

describe("createWidgetPreview — a show_widget call while it is written", () => {
  it("returns nothing until 400 new characters of code arrived, then what arrived", () => {
    const p = createWidgetPreview();
    expect(p.push({ index: 0, name: "show_widget", argsDelta: head + "a".repeat(399) })).toBeNull();
    expect(p.push({ index: 0, argsDelta: "b" })).toEqual({
      callIndex: 0,
      title: "visits_week",
      loadingMessages: ["Contando visitas"],
      code: "a".repeat(399) + "b",
    });
    expect(p.push({ index: 0, argsDelta: "c" })).toBeNull();
  });

  it("title is null until it arrived", () => {
    const p = createWidgetPreview(1);
    expect(p.push({ index: 0, name: "show_widget", argsDelta: '{"widget_code":"<p>hola' })).toEqual({
      callIndex: 0,
      title: null,
      loadingMessages: [],
      code: "<p>hola",
    });
  });

  it("loading messages stay empty while their list is half written", () => {
    const p = createWidgetPreview(1);
    const out = p.push({ index: 0, name: "show_widget", argsDelta: '{"widget_code":"<p>a","loading_messages":["Conta' });
    expect(out?.loadingMessages).toEqual([]);
  });

  it("ignores calls to other tools", () => {
    const p = createWidgetPreview(1);
    expect(p.push({ index: 0, name: "Write", argsDelta: '{"widget_code":"<p>' + "a".repeat(10) })).toBeNull();
  });

  it("follows two calls separately", () => {
    const p = createWidgetPreview(5);
    expect(p.push({ index: 0, name: "show_widget", argsDelta: '{"widget_code":"aaaaa' })?.code).toBe("aaaaa");
    expect(p.push({ index: 1, name: "show_widget", argsDelta: '{"widget_code":"bbbbb' })).toMatchObject({ callIndex: 1, code: "bbbbb" });
  });

  it("leaves a half escape out of the code until it is complete", () => {
    const p = createWidgetPreview(1);
    expect(p.push({ index: 0, name: "show_widget", argsDelta: '{"widget_code":"caf\\u00' })?.code).toBe("caf");
  });
});
