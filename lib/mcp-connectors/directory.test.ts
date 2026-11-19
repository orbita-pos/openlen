import { describe, expect, it } from "vitest";

import { EMPTY_MCP_CONFIG, entryFingerprint, parseMcpConfig } from "./config";
import { DIRECTORY, directoryFor } from "./directory";
import { connectorsForTurn, TurnConnections, type CallDeps, type TurnDeps } from "./turn";

const NOW = new Date("2026-11-17T12:00:00Z");

function configWith(servers: Record<string, unknown>) {
  const parsed = parseMcpConfig(JSON.stringify({ servers }), { reservedServerNames: new Set() });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.config;
}

describe("directoryFor", () => {
  it("returns empty without OPENLEN_MCP_GOOGLE_CLIENT_ID", () => {
    expect(directoryFor("jesus@example.com", { servers: {} }, {})).toEqual([]);
  });

  it("with OPENLEN_MCP_GOOGLE_TEST_USERS set, only listed emails (case-insensitive, trimmed) get Google Calendar", () => {
    const env = {
      OPENLEN_MCP_GOOGLE_CLIENT_ID: "gid.apps.googleusercontent.com",
      OPENLEN_MCP_GOOGLE_TEST_USERS: " Jesus@Example.com , other@example.com ",
    };
    expect(directoryFor("outside@example.com", { servers: {} }, env)).toEqual([]);
    expect(directoryFor(null, { servers: {} }, env)).toEqual([]);
    expect(directoryFor("jesus@example.com", { servers: {} }, env).map((d) => d.id)).toEqual(["google-calendar"]);
  });

  it("without OPENLEN_MCP_GOOGLE_TEST_USERS, anyone gets Google Calendar when the client id is set", () => {
    const env = { OPENLEN_MCP_GOOGLE_CLIENT_ID: "gid.apps.googleusercontent.com" };
    expect(directoryFor("anyone@example.com", { servers: {} }, env).map((d) => d.id)).toEqual(["google-calendar"]);
    expect(directoryFor(null, { servers: {} }, env).map((d) => d.id)).toEqual(["google-calendar"]);
  });

  it("excludes an entry whose URL is already in mcp.json", () => {
    const env = { OPENLEN_MCP_GOOGLE_CLIENT_ID: "gid.apps.googleusercontent.com" };
    const cfg = configWith({
      mycal: {
        transport: "streamable-http",
        url: "https://calendarmcp.googleapis.com/mcp/v1",
        oauth: { scope: "https://www.googleapis.com/auth/calendar" },
      },
    });
    expect(directoryFor("jesus@example.com", cfg, env)).toEqual([]);
  });

  it("DIRECTORY's Google Calendar entry is valid in mcp.json", () => {
    const gcal = DIRECTORY.find((d) => d.id === "google-calendar")!;
    const parsed = parseMcpConfig(JSON.stringify({ servers: { [gcal.server]: gcal.entry } }), { reservedServerNames: new Set() });
    expect(parsed.ok).toBe(true);
  });
});

describe("suggest_connectors in a turn", () => {
  it("is not declared when directoryFor is empty, leaving connectorsForTurn identical to today", async () => {
    const d: TurnDeps = {
      readConfig: async () => ({ text: EMPTY_MCP_CONFIG, approved: {}, version: 0 }),
      readStates: async () => [],
      personEmail: async () => "outside@example.com",
      env: { OPENLEN_MCP_GOOGLE_CLIENT_ID: "gid", OPENLEN_MCP_GOOGLE_TEST_USERS: "jesus@example.com" },
      now: () => NOW,
    };
    const t = await connectorsForTurn("p1", d);
    expect(t.declarations).toEqual([]);
    expect(t.contextText).toBe("");
  });

  it("is declared at the end when Google Calendar is available, and calling it returns the suggestion card when attended", async () => {
    const entry = { transport: "streamable-http", url: "https://ok.example.com/mcp" };
    const text = JSON.stringify({ servers: { ok: entry } });
    const parsed = parseMcpConfig(text, { reservedServerNames: new Set() });
    if (!parsed.ok) throw new Error(parsed.error);
    const fp = entryFingerprint(parsed.config.servers.ok!);
    const d: TurnDeps = {
      readConfig: async () => ({ text, approved: { ok: fp }, version: 1 }),
      readStates: async () => [
        {
          serverName: "ok",
          fingerprint: fp,
          tools: [{ publicName: "mcp__ok__ping", rawName: "ping", description: "ping", inputSchema: { type: "object", properties: {} } }],
          instructions: "",
          hasResources: false,
          listedAt: NOW,
          status: "connected",
          error: null,
          stale: false,
          failures: 0,
          attemptedAt: NOW,
          authIssuer: null,
          authReason: null,
          authScope: null,
        },
      ],
      personEmail: async () => "jesus@example.com",
      env: { OPENLEN_MCP_GOOGLE_CLIENT_ID: "gid", OPENLEN_MCP_GOOGLE_TEST_USERS: "jesus@example.com" },
      now: () => NOW,
    };
    const t = await connectorsForTurn("p1", d);
    expect(t.declarations.map((x) => x.name)).toEqual(["mcp__ok__ping", "suggest_connectors"]);
    expect(t.declarations[1]).toEqual({
      name: "suggest_connectors",
      description:
        "Suggest connecting one of these services when the person's request needs something you can't do with your tools: google-calendar — Read and add events in the person's Google Calendar. The person sees a Connect card; nothing connects until they tap it.",
      parameters: {
        type: "object",
        properties: {
          ids: {
            type: "array",
            items: { enum: ["google-calendar"] },
            minItems: 1,
            maxItems: 3,
          },
        },
        required: ["ids"],
      },
    });

    const cd: CallDeps = {
      resolveCredentials: async () => new Map(),
      open: (async () => {
        throw new Error("not used");
      }) as unknown as CallDeps["open"],
      fetch: (async () => new Response()) as typeof fetch,
      markStale: async () => {},
      modelTakesImages: true,
    };

    const attended = await new TurnConnections("p1", t, cd, { attended: true }).call("suggest_connectors", { ids: ["google-calendar"] });
    expect(attended.response).toEqual({
      content: [
        {
          type: "text",
          text: "The person is shown a Connect card for Google Calendar. Tell them in one short sentence what it lets you do once connected.",
        },
      ],
    });
    expect(attended.mcpApproval?.suggest).toEqual({
      id: "google-calendar",
      name: "Google Calendar",
      host: "calendarmcp.googleapis.com",
    });

    const unattended = await new TurnConnections("p1", t, cd, { attended: false }).call("suggest_connectors", { ids: ["google-calendar"] });
    expect(unattended.mcpApproval).toBeUndefined();
    expect(unattended.response).toEqual({
      content: [
        {
          type: "text",
          text: "Nobody can sign in right now (this turn runs without the person). Tell them in one short sentence that Google Calendar needs them to connect it in OpenLen, and carry on with whatever does not need Google Calendar.",
        },
      ],
    });
  });
});
