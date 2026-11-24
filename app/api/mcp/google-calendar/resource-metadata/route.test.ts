// @vitest-environment node
// The Calendar server's Protected Resource Metadata (RFC 9728): Google signs the person in (spec local
// 2026-11-24-servidor-de-google-calendar, §5.1).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

beforeEach(() => vi.stubEnv("GCAL_MCP_RESOURCE_URL", ""));

describe("the Calendar server's resource metadata", () => {
  it("names the resource, Google as its authorization server and the three scopes", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      resource: "https://mcp.openlen.com/google-calendar",
      authorization_servers: ["https://accounts.google.com"],
      scopes_supported: [
        "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.events.freebusy",
      ],
      bearer_methods_supported: ["header"],
      resource_name: "OpenLen Google Calendar",
    });
  });
});
