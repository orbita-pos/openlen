// What the fetchers of production conversations leave on the box (spec local 2026-11-24-servidor-de-google-calendar,
// §5.8): a conversation that carries a connector's results (the person's calendar, their email…) is never fetched — Google
// Limited Use forbids people reading Calendar data, and the scenes and customer cases are read by people.
import { describe, expect, it } from "vitest";

import { RESOURCE_TOOL_NAMES } from "@/lib/mcp-connectors/turn";

import { carriesConnectorResults } from "./personal-data";

const row = (transcript: unknown, userText = "pon la reunión del lunes en la página") => ({ id: "r1", userText, transcript });

describe("carriesConnectorResults", () => {
  it("🔴 a Len turn that called a connector's tool carries its results", () => {
    const transcript = [
      { role: "user", content: "¿qué tengo el lunes?" },
      { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "mcp__google-calendar__list_events", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: '{"items":[{"summary":"Dentista"}]}' },
    ];
    expect(carriesConnectorResults([row(transcript)])).toBe(true);
  });

  it("a tool result named after the connector's tool counts too, and so does a recorded action", () => {
    expect(carriesConnectorResults([row([{ role: "tool", name: "mcp__notion__search", content: "…" }])])).toBe(true);
    expect(carriesConnectorResults({ actions: [{ tool: "mcp__google-calendar__create_event", ok: true }] })).toBe(true);
  });

  it("Len's own tools carry nothing personal", () => {
    const transcript = [
      { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "Read", arguments: '{"file_path":"/index.html"}' } }] },
      { role: "tool", tool_call_id: "c1", name: "Read", content: "<html>" },
      { role: "assistant", content: "", tool_calls: [{ id: "c2", type: "function", function: { name: "bash", arguments: '{"command":"ls"}' } }] },
    ];
    expect(carriesConnectorResults([row(transcript)])).toBe(false);
  });

  it("🔴 «mcp__» written in what the owner or Len said is not a call: only a tool's name field counts", () => {
    const transcript = [
      { role: "user", content: "¿por qué no veo mcp__google-calendar__list_events?" },
      { role: "assistant", content: "mcp__google-calendar__list_events no está conectado aquí." },
    ];
    expect(carriesConnectorResults([row(transcript, "mcp__google-calendar__list_events")])).toBe(false);
    expect(carriesConnectorResults({ text: "mcp__x__y", note: { title: "mcp__x__y" } })).toBe(false);
  });

  // The shape a turn's transcript is stored in (lib/ai-gateway.ts `Message.functionCalls`).
  it("🔴 the stored shape: an assistant message's functionCalls", () => {
    const stored = [{ role: "assistant", content: "", functionCalls: [{ name: "mcp__google-calendar__list_events", args: {} }] }];
    expect(carriesConnectorResults([row(stored)])).toBe(true);
    expect(carriesConnectorResults([row([{ role: "assistant", content: "", functionCalls: [{ name: "Read", args: {} }] }])])).toBe(false);
  });

  // Claude Code counts its resource tools (ListMcpResourcesTool, ReadMcpResourceTool) as MCP's; Len's are
  // list_mcp_resources, list_mcp_resource_templates and read_mcp_resource, which carry no mcp__ prefix.
  it("🔴 reading a connector's resources carries its results too", () => {
    for (const name of RESOURCE_TOOL_NAMES) {
      expect(carriesConnectorResults([row([{ role: "assistant", content: "", functionCalls: [{ name, args: {} }] }])]), name).toBe(true);
    }
  });

  it("nothing, null and plain values carry nothing", () => {
    expect(carriesConnectorResults(null)).toBe(false);
    expect(carriesConnectorResults(undefined)).toBe(false);
    expect(carriesConnectorResults("mcp__a__b")).toBe(false);
    expect(carriesConnectorResults([])).toBe(false);
  });
});
