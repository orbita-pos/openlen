import { describe, expect, it } from "vitest";

import type { InstalledToolView } from "@/lib/tools/types";

import { railActiveKey } from "../rail-model";
import { draftCanvasBridge, projectToolItems, railToolItems, toolIdOfLens, toolLens, toolPromptDraft } from "./tool-items";

const tool = (over: Partial<InstalledToolView> = {}): InstalledToolView => ({
  id: "a",
  projectId: "p",
  title: "Reservas",
  description: "",
  placement: "rail",
  iconUrl: "/api/tools/a/icon?v=1",
  frameUrl: "http://x/?v=1",
  frameOrigin: "http://x",
  releaseSha: "1",
  enabled: true,
  installedAt: "",
  status: "ok",
  ...over,
});

describe("where installed tools show up", () => {
  it("the rail: switched-on rail tools that can open", () => {
    const tools = [tool(), tool({ id: "b", placement: "project" }), tool({ id: "c", enabled: false }), tool({ id: "d", status: "plan_required" })];
    expect(railToolItems(tools)).toEqual([{ kind: "tool", id: "a", name: "Reservas", iconUrl: "/api/tools/a/icon?v=1" }]);
  });

  it("the project's lenses: switched-on project tools that can open", () => {
    const tools = [tool(), tool({ id: "b", placement: "project" }), tool({ id: "e", placement: "project", status: "removed" })];
    expect(projectToolItems(tools).map((t) => t.id)).toEqual(["b"]);
  });

  it("a tool's lens and back", () => {
    expect(toolLens("b")).toBe("tool:b");
    expect(toolIdOfLens("tool:b")).toBe("b");
    expect(toolIdOfLens("pagina")).toBeNull();
  });

  it("the rail lights the open tool", () => {
    expect(railActiveKey("tool", "chat", false, "a")).toBe("tool:a");
    expect(railActiveKey("page", "chat", false, "a")).toBe("chat");
  });
});

describe("toolPromptDraft", () => {
  it("quotes the tool's text and signs it, for the person to send", () => {
    expect(toolPromptDraft("línea 1\nlínea 2", "Lector")).toBe("> línea 1\n> línea 2\n\n— Lector\n");
  });
});

describe("draftCanvasBridge", () => {
  it("a tool project running in its real canvas: the canvas's origin answers as the draft", () => {
    expect(draftCanvasBridge({ isTool: true, remoteUrl: "https://lienzo-abc.openlen.app/?v=3", projectId: "p1" })).toEqual({
      frameOrigin: "https://lienzo-abc.openlen.app",
      caller: { draftProjectId: "p1" },
    });
  });

  it("nothing to answer for a page or an app, without the real canvas, or without a project", () => {
    expect(draftCanvasBridge({ isTool: false, remoteUrl: "https://lienzo-abc.openlen.app/", projectId: "p1" })).toBeNull();
    expect(draftCanvasBridge({ isTool: true, remoteUrl: null, projectId: "p1" })).toBeNull();
    expect(draftCanvasBridge({ isTool: true, remoteUrl: "not a url", projectId: "p1" })).toBeNull();
    expect(draftCanvasBridge({ isTool: true, remoteUrl: "https://lienzo-abc.openlen.app/", projectId: null })).toBeNull();
  });
});
