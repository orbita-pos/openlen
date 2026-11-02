import { afterEach, describe, expect, it } from "vitest";

import { subagentsLive } from "./subagents-live";

afterEach(() => subagentsLive.forget());

const started = { type: "subagent", id: "r1", preset: "Explore", description: "Find the menu", status: "running" };

describe("the chat's view of the subagents", () => {
  it("an event starts a run, its steps replace the running one of the same tool, and its end settles it", () => {
    subagentsLive.event("p1", started);
    subagentsLive.event("p1", { ...started, step: { tool: "Read", status: "running", summary: "/menu/index.html" } });
    expect(subagentsLive.snapshot().get("r1")!.actions).toEqual([{ tool: "Read", status: "running", summary: "/menu/index.html" }]);
    subagentsLive.event("p1", { ...started, step: { tool: "Read", status: "done", summary: "/menu/index.html" } });
    expect(subagentsLive.snapshot().get("r1")).toMatchObject({ status: "running", toolUses: 1, actions: [{ tool: "Read", status: "done" }] });
    expect(subagentsLive.runningCount("p1")).toBe(1);
    subagentsLive.event("p1", { ...started, status: "completed" });
    expect(subagentsLive.snapshot().get("r1")!.status).toBe("completed");
    expect(subagentsLive.runningCount("p1")).toBe(0);
  });

  it("the server's rows replace what the stream said; only another project's are not counted", () => {
    subagentsLive.fromServer("p1", [
      { id: "r1", preset: "Explore", description: "Find", status: "completed", actions: [{ tool: "Read", status: "done", summary: "a" }], finalText: "In /a.", toolUses: 1, durationMs: 900 },
      { id: "r2", preset: "general-purpose", description: "Fix", status: "running", actions: [], finalText: null, toolUses: 0, durationMs: null },
    ]);
    subagentsLive.fromServer("p2", [{ id: "r3", preset: "Plan", description: "Plan", status: "running", actions: [], finalText: null, toolUses: 0, durationMs: null }]);
    expect(subagentsLive.snapshot().get("r1")).toMatchObject({ status: "completed", finalText: "In /a.", durationMs: 900 });
    expect(subagentsLive.runningCount("p1")).toBe(1);
  });

  it("while running, the stream's longer step list is kept over the server's last save", () => {
    subagentsLive.event("p1", { ...started, step: { tool: "Read", status: "done", summary: "a" } });
    subagentsLive.event("p1", { ...started, step: { tool: "Grep", status: "done", summary: "b" } });
    subagentsLive.fromServer("p1", [{ id: "r1", preset: "Explore", description: "Find the menu", status: "running", actions: [{ tool: "Read", status: "done", summary: "a" }], finalText: null, toolUses: 1, durationMs: null }]);
    expect(subagentsLive.snapshot().get("r1")!.actions).toHaveLength(2);
  });

  it("garbage changes nothing", () => {
    const before = subagentsLive.snapshot();
    subagentsLive.event("p1", { type: "subagent", id: "r1", status: "nope" });
    subagentsLive.event("p1", null);
    subagentsLive.fromServer("p1", "x");
    expect(subagentsLive.snapshot()).toBe(before);
  });
});
