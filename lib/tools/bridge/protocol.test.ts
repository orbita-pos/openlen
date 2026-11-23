// @vitest-environment node
import { describe, expect, it } from "vitest";

import { BRIDGE_METHODS, isBridgeNotification, isBridgeRequest, isBridgeResponse, isDataChangedNotification, TOOL_THEME_TOKENS } from "./protocol";

const req = { jsonrpc: "2.0", id: 1, method: "projects", channel: "openlen-tool" };

describe("bridge messages", () => {
  it("a JSON-RPC 2.0 request on the tool channel", () => {
    expect(isBridgeRequest(req)).toBe(true);
    expect(isBridgeRequest({ ...req, params: { projectId: "p1" } })).toBe(true);
  });
  it("without the channel, another version, or an unknown method, it isn't one", () => {
    const { channel: _, ...noChannel } = req;
    expect(isBridgeRequest(noChannel)).toBe(false);
    expect(isBridgeRequest({ ...req, jsonrpc: "1.0" })).toBe(false);
    expect(isBridgeRequest({ ...req, method: "eval" })).toBe(false);
    expect(isBridgeRequest({ ...req, id: "1" })).toBe(false);
    expect(isBridgeRequest(null)).toBe(false);
  });
  it("a response carries the id and a result or an error", () => {
    expect(isBridgeResponse({ jsonrpc: "2.0", id: 1, result: [], channel: "openlen-tool" })).toBe(true);
    expect(isBridgeResponse({ jsonrpc: "2.0", id: 1, error: { code: 403, message: "owner_only" }, channel: "openlen-tool" })).toBe(true);
    expect(isBridgeResponse({ jsonrpc: "2.0", id: 1, channel: "openlen-tool" })).toBe(false);
  });
  it("the context notification has no id", () => {
    expect(isBridgeNotification({ jsonrpc: "2.0", method: "context", params: {}, channel: "openlen-tool" })).toBe(true);
    expect(isBridgeNotification({ jsonrpc: "2.0", id: 2, method: "context", params: {}, channel: "openlen-tool" })).toBe(false);
  });
  it("an agent tool's data requests are requests like any other", () => {
    for (const method of ["data.get", "data.set", "data.update", "data.delete", "data.list", "data.query", "data.subscribe"]) {
      expect(isBridgeRequest({ ...req, method, params: { collection: "tareas" } })).toBe(true);
    }
    expect(isBridgeRequest({ ...req, method: "data.drop" })).toBe(false);
  });
  it("data.changed is a notification too: a baseline or a change, never with an id", () => {
    const baseline = { jsonrpc: "2.0", method: "data.changed", params: { kind: "baseline", docs: [] }, channel: "openlen-tool" };
    const change = { jsonrpc: "2.0", method: "data.changed", params: { kind: "change", by: "agent", docs: [], deleted: [] }, channel: "openlen-tool" };
    for (const n of [baseline, change]) {
      expect(isBridgeNotification(n)).toBe(true);
      expect(isDataChangedNotification(n)).toBe(true);
      expect(isBridgeNotification({ ...n, id: 3 })).toBe(false);
    }
    // the context notification is not a data one
    expect(isDataChangedNotification({ jsonrpc: "2.0", method: "context", params: {}, channel: "openlen-tool" })).toBe(false);
    expect(isBridgeNotification({ ...baseline, method: "data.other" })).toBe(false);
    expect(isBridgeNotification({ ...baseline, channel: "other" })).toBe(false);
  });
  it("names the methods the client offers and the workspace tokens it passes", () => {
    expect([...BRIDGE_METHODS]).toEqual([
      "context",
      "backend",
      "projects",
      "forms",
      "visits",
      "query",
      "update",
      "sendPrompt",
      "jobs.run",
      "jobs.get",
      "jobs.cancel",
      "jobs.list",
      "files.pick",
      "files.deliver",
      "data.get",
      "data.set",
      "data.update",
      "data.delete",
      "data.list",
      "data.query",
      "data.subscribe",
    ]);
    expect(TOOL_THEME_TOKENS).toContain("--accent");
    expect(TOOL_THEME_TOKENS).toContain("--bg");
  });
});
