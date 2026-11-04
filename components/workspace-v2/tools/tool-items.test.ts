import { describe, expect, it } from "vitest";

import type { InstalledToolView } from "@/lib/tools/types";

import { railActiveKey } from "../rail-model";
import { projectToolItems, railToolItems, toolIdOfLens, toolLens, toolPromptDraft } from "./tool-items";

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
