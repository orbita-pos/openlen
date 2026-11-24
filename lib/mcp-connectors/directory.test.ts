import { describe, expect, it } from "vitest";

import { EMPTY_MCP_CONFIG, entryFingerprint, parseMcpConfig } from "./config";
import { DIRECTORY, directoryFor, directoryForAnyone } from "./directory";
import { connectorsForTurn, TurnConnections, type CallDeps, type TurnDeps } from "./turn";
import { GCAL_SCOPES, gcalResourceUrl } from "@/lib/google-calendar-mcp/config";

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
        url: gcalResourceUrl(),
        oauth: { scope: GCAL_SCOPES.join(" ") },
      },
    });
    expect(directoryFor("jesus@example.com", cfg, env)).toEqual([]);
  });

  // Spec local 2026-11-24-servidor-de-google-calendar, §5.5: the card offers OpenLen's own server, signed in at Google
  // with the three scopes the server checks — never Google's preview server, which only its testers may use.
  it("DIRECTORY's Google Calendar entry is OpenLen's own server, with the three scopes, signed in at Google", () => {
    const gcal = DIRECTORY.find((d) => d.id === "google-calendar")!;
    expect(gcal.entry.url).toBe(gcalResourceUrl());
    expect(gcal.entry.url).toBe("https://mcp.openlen.com/google-calendar");
    expect(gcal.entry.oauth.scope).toBe(GCAL_SCOPES.join(" "));
    expect(gcal.entry.oauth.scope?.split(" ")).toHaveLength(3);
    expect(gcal.issuer).toBe("https://accounts.google.com");
  });

  it("DIRECTORY's Google Calendar entry is valid in mcp.json", () => {
    const gcal = DIRECTORY.find((d) => d.id === "google-calendar")!;
    const parsed = parseMcpConfig(JSON.stringify({ servers: { [gcal.server]: gcal.entry } }), { reservedServerNames: new Set() });
    expect(parsed.ok).toBe(true);
  });
});

describe("directoryForAnyone", () => {
  it("is what the deployment could offer someone, whoever they are: nothing without the client id, OAuth off, or the server already configured", () => {
    const env = { OPENLEN_MCP_GOOGLE_CLIENT_ID: "gid.apps.googleusercontent.com", OPENLEN_MCP_GOOGLE_TEST_USERS: "someone@example.com" };
    expect(directoryForAnyone({ servers: {} }, env).map((d) => d.id)).toEqual(["google-calendar"]);
    expect(directoryForAnyone({ servers: {} }, {})).toEqual([]);
    expect(directoryForAnyone({ servers: {} }, { ...env, OPENLEN_MCP_OAUTH: "0" })).toEqual([]);
    expect(directoryForAnyone({ servers: {} }, { ...env, OPENLEN_MCP: "0" })).toEqual([]);
    const configured = configWith({ mycal: { transport: "streamable-http", url: gcalResourceUrl() } });
    expect(directoryForAnyone(configured, env)).toEqual([]);
  });

  // Spec local 2026-11-24-servidor-de-google-calendar, §5.7 (final review, I5): with OpenLen's Calendar server off, no card
  // offers a server that answers 503.
  it("🔴 with OPENLEN_GCAL_MCP=0 Google Calendar isn't offered", () => {
    const env = { OPENLEN_MCP_GOOGLE_CLIENT_ID: "gid.apps.googleusercontent.com" };
    expect(directoryForAnyone({ servers: {} }, { ...env, OPENLEN_GCAL_MCP: "0" })).toEqual([]);
    expect(directoryFor("jesus@example.com", { servers: {} }, { ...env, OPENLEN_GCAL_MCP: "0" })).toEqual([]);
  });
});

describe("suggest_connectors in a turn", () => {
  // OA6: a person nobody could offer anything to costs no query: the email is looked up only when an entry could be theirs.
  it("🔴 never asks for the person's email when no entry can be offered to anyone", async () => {
    let asked = 0;
    const base: TurnDeps = {
      readConfig: async () => ({ text: EMPTY_MCP_CONFIG, approved: {}, version: 0 }),
      readStates: async () => [],
      personEmail: async () => {
        asked++;
        return "jesus@example.com";
      },
      now: () => NOW,
    };
    await connectorsForTurn("p1", { ...base, env: {} });
    await connectorsForTurn("p1", { ...base, env: { OPENLEN_MCP_GOOGLE_CLIENT_ID: "gid", OPENLEN_MCP_OAUTH: "0" } });
    expect(asked).toBe(0);
    const t = await connectorsForTurn("p1", { ...base, env: { OPENLEN_MCP_GOOGLE_CLIENT_ID: "gid", OPENLEN_MCP_GOOGLE_TEST_USERS: "jesus@example.com" } });
    expect(asked).toBe(1);
    expect(t.declarations.map((x) => x.name)).toEqual(["suggest_connectors"]);
  });

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
            items: { type: "string", enum: ["google-calendar"] },
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
      host: "mcp.openlen.com",
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

// Final review, M6: one call leaves one card — the first id it names. The text says exactly that, and how to offer another,
// instead of claiming a card for every id.
describe("suggest_connectors with more than one id", () => {
  const second = { ...DIRECTORY[0]!, id: "other-calendar", name: "Other Calendar", server: "other-calendar", entry: { ...DIRECTORY[0]!.entry, url: "https://mcp.other.example/mcp" } };
  const turn = {
    declarations: [],
    routes: new Map([["suggest_connectors", { server: "", rawName: "suggest_connectors" }]]),
    serverNames: [],
    active: new Map(),
    directory: [DIRECTORY[0]!, second],
    resourceServers: [],
    contextText: "",
    toMount: [],
  };
  const cd = { resolveCredentials: async () => new Map(), open: (async () => { throw new Error("not used"); }) as never, fetch: (async () => new Response()) as typeof fetch, markStale: async () => {}, modelTakesImages: true } as CallDeps;

  it("🔴 names only the service whose card is shown, and says how to offer the others", async () => {
    const r = await new TurnConnections("p1", turn, cd).call("suggest_connectors", { ids: ["other-calendar", "google-calendar"] });
    expect(r.mcpApproval?.suggest).toMatchObject({ id: "other-calendar", name: "Other Calendar" });
    expect(r.response).toEqual({
      content: [
        {
          type: "text",
          text: "The person is shown a Connect card for Other Calendar (one card per call: call suggest_connectors again for Google Calendar if it is needed too). Tell them in one short sentence what it lets you do once connected.",
        },
      ],
    });
  });
});
