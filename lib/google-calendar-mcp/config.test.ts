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

  // As Claude Code treats CLAUDE_CODE_CUSTOM_OAUTH_URL: only approved values, else it refuses by name. This URL decides
  // which server gets OpenLen's own Google client, so a stray value must never point it elsewhere.
  it("🔴 GCAL_MCP_RESOURCE_URL takes only approved endpoints: this machine outside production, nothing else", () => {
    const refused = "GCAL_MCP_RESOURCE_URL is not an approved endpoint.";
    expect(gcalResourceUrl({ GCAL_MCP_RESOURCE_URL: "http://127.0.0.1:3027/api/mcp/google-calendar" })).toBe("http://127.0.0.1:3027/api/mcp/google-calendar");
    expect(gcalResourceUrl({ GCAL_MCP_RESOURCE_URL: "https://mcp.openlen.com/google-calendar", NODE_ENV: "production" })).toBe("https://mcp.openlen.com/google-calendar");
    expect(() => gcalResourceUrl({ GCAL_MCP_RESOURCE_URL: "https://evil.example/google-calendar" })).toThrow(refused);
    expect(() => gcalResourceUrl({ GCAL_MCP_RESOURCE_URL: "http://localhost:3000/api/mcp/google-calendar", NODE_ENV: "production" })).toThrow(refused);
    expect(() => gcalResourceUrl({ GCAL_MCP_RESOURCE_URL: "http://localhost.evil.example/x" })).toThrow(refused);
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
