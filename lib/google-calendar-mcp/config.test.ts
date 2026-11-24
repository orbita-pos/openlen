// lib/google-calendar-mcp/config.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GCAL_SCOPES, gcalEnabled, gcalResourceMetadataUrl, gcalResourceUrl } from "./config";

describe("the Calendar server's configuration", () => {
  it("the three scopes, the smallest that cover the nine tools", () => {
    expect(GCAL_SCOPES).toEqual([
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.events.freebusy",
    ]);
  });

  it("the public URL, and the local one from GCAL_MCP_RESOURCE_URL", () => {
    expect(gcalResourceUrl({})).toBe("https://mcp.openlen.com/google-calendar");
    expect(gcalResourceUrl({ GCAL_MCP_RESOURCE_URL: "http://localhost:3000/api/mcp/google-calendar" })).toBe("http://localhost:3000/api/mcp/google-calendar");
  });

  it("the metadata URL has the resource's path inserted (RFC 9728 §3.1)", () => {
    expect(gcalResourceMetadataUrl({})).toBe("https://mcp.openlen.com/.well-known/oauth-protected-resource/google-calendar");
    expect(gcalResourceMetadataUrl({ GCAL_MCP_RESOURCE_URL: "http://localhost:3000/api/mcp/google-calendar" })).toBe(
      "http://localhost:3000/.well-known/oauth-protected-resource/api/mcp/google-calendar",
    );
  });

  it("on unless OPENLEN_GCAL_MCP or OPENLEN_MCP is the literal \"0\"", () => {
    expect(gcalEnabled({})).toBe(true);
    expect(gcalEnabled({ OPENLEN_GCAL_MCP: "false" })).toBe(true);
    expect(gcalEnabled({ OPENLEN_GCAL_MCP: "0" })).toBe(false);
    expect(gcalEnabled({ OPENLEN_MCP: "0" })).toBe(false);
  });
});
