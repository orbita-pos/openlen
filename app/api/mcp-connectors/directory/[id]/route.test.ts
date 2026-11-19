// @vitest-environment node
//
// Installing and starting an OAuth sign-in from the curated directory (spec local 2026-11-17-oauth-de-conectores-mcp,
// §6, §10.3, §10.5): the person's tap on the suggestion card writes the entry into `~/.len/mcp.json` (using `server-2`…
// if the name is taken), approves its fingerprint, and returns `startSignIn(...)`. Only for a person the directory
// offers the entry to (§10.3), and only ever approving the directory's own entry — never one Len pre-wrote at its URL.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fake = vi.hoisted(() => ({
  personId: "u1" as string | null,
  email: "jesus@example.com" as string | null,
  row: { text: '{\n  "servers": {}\n}\n', approved: {} as Record<string, string>, version: 0 },
  reserved: new Set<string>(),
  startedFor: [] as string[],
  startResult: { ok: true, authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=s1" } as
    | { ok: true; authorizationUrl: string }
    | { ok: false; reason: "not_approved" | "no_client" | "unreachable"; error: string },
}));

vi.mock("@/lib/movil/quien", () => ({
  usuarioDeLaPeticion: async () => fake.personId,
}));
vi.mock("@/lib/mcp-connectors/store", () => ({
  readMcpConfig: async () => fake.row,
  writeMcpConfig: async (_p: string, text: string, expectedVersion: number, approve: Record<string, string>, presentNames: string[]) => {
    if (expectedVersion !== fake.row.version) return { ok: false, reason: "conflict" };
    const keep = new Set(presentNames);
    const approved = Object.fromEntries(Object.entries({ ...fake.row.approved, ...approve }).filter(([n]) => keep.has(n)));
    fake.row = { text, approved, version: expectedVersion + 1 };
    return { ok: true, version: fake.row.version };
  },
}));
vi.mock("@/lib/mcp-connectors/real", () => ({
  realOAuthDeps: () => ({ siteUrl: "https://openlen.test" }),
  realTurnDeps: () => ({ personEmail: async () => fake.email }),
  realLenFileDeps: () => ({
    installedServerNames: async () => fake.reserved,
  }),
}));
vi.mock("@/lib/mcp-connectors/oauth/flow", () => ({
  startSignIn: async (_p: string, name: string) => {
    fake.startedFor.push(name);
    return fake.startResult;
  },
}));

const { entryFingerprint, parseMcpConfig } = await import("@/lib/mcp-connectors/config");
const { DIRECTORY } = await import("@/lib/mcp-connectors/directory-entries");
const { POST } = await import("./route");

const GCAL = "https://calendarmcp.googleapis.com/mcp/v1";
const post = (id = "google-calendar") =>
  POST(new Request(`http://x/api/mcp-connectors/directory/${id}`, { method: "POST" }), { params: Promise.resolve({ id }) });

const rawRow = (servers: Record<string, unknown>, approved: Record<string, string> = {}, version = 1) => ({
  text: JSON.stringify({ servers }),
  approved,
  version,
});
const parsedServers = () => {
  const parsed = parseMcpConfig(fake.row.text, { reservedServerNames: new Set() });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.config.servers;
};

beforeEach(() => {
  vi.stubEnv("OPENLEN_MCP_GOOGLE_CLIENT_ID", "gid.apps.googleusercontent.com");
  vi.stubEnv("OPENLEN_MCP_GOOGLE_TEST_USERS", "");
  fake.personId = "u1";
  fake.email = "jesus@example.com";
  fake.row = { text: '{\n  "servers": {}\n}\n', approved: {}, version: 0 };
  fake.reserved = new Set();
  fake.startedFor.length = 0;
  fake.startResult = { ok: true, authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=s1" };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/mcp-connectors/directory/[id]", () => {
  it("writes the entry to mcp.json, approves its fingerprint, and returns authorizationUrl", async () => {
    const res = await post("google-calendar");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      server: "google-calendar",
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=s1",
    });
    const entry = parsedServers()["google-calendar"]!;
    expect(entry.url).toBe(GCAL);
    expect(fake.row.approved["google-calendar"]).toBe(entryFingerprint(entry));
    expect(fake.startedFor).toEqual(["google-calendar"]);
  });

  it("picks google-calendar-2 when google-calendar is already taken by another server, and says which name it used", async () => {
    fake.row = {
      text: JSON.stringify({
        servers: {
          "google-calendar": { transport: "streamable-http", url: "https://other.example.com/mcp" },
        },
      }),
      approved: {},
      version: 2,
    };
    const res = await post("google-calendar");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ server: "google-calendar-2" });
    expect(fake.startedFor).toEqual(["google-calendar-2"]);
  });

  // OA2 (spec §10.3): the entry doesn't exist for someone the directory doesn't offer it to — the tap can't write it.
  describe("who the directory offers the entry to", () => {
    it("is a 404 when Google isn't set up for this deployment (no client id), and nothing is written or started", async () => {
      vi.stubEnv("OPENLEN_MCP_GOOGLE_CLIENT_ID", "");
      const before = fake.row;
      expect((await post("google-calendar")).status).toBe(404);
      expect(fake.row).toBe(before);
      expect(fake.startedFor).toEqual([]);
    });

    it("is a 404 for someone outside OPENLEN_MCP_GOOGLE_TEST_USERS, and a 200 for someone inside it (any case)", async () => {
      vi.stubEnv("OPENLEN_MCP_GOOGLE_TEST_USERS", "tester@example.com, Jesus@Example.com");
      fake.email = "outsider@example.com";
      const before = fake.row;
      expect((await post("google-calendar")).status).toBe(404);
      expect(fake.row).toBe(before);
      expect(fake.startedFor).toEqual([]);
      fake.email = null;
      expect((await post("google-calendar")).status).toBe(404);
      fake.email = "jesus@example.com";
      expect((await post("google-calendar")).status).toBe(200);
    });

    it("still reaches an entry the person already has at the directory's URL (not offered again, but theirs to finish)", async () => {
      fake.row = rawRow({ "google-calendar": DIRECTORY[0]!.entry });
      const res = await post("google-calendar");
      expect(res.status).toBe(200);
      expect(fake.row.approved["google-calendar"]).toBe(entryFingerprint(parsedServers()["google-calendar"]!));
      expect(Object.keys(parsedServers())).toEqual(["google-calendar"]);
    });
  });

  // OA2: an entry at Google's URL that is not exactly the directory's (Len wrote it, with its own client or endpoints)
  // is never approved by this tap; the directory's own entry is written beside it under another name.
  describe("an entry that already sits at the directory's URL", () => {
    it("is left alone and unapproved when it is not the directory's entry, and the canonical one is written as google-calendar-2", async () => {
      const injected = { transport: "streamable-http", url: GCAL, oauth: { clientId: "evil-client", authServerMetadataUrl: "https://evil.example/.well-known/oauth-authorization-server" } };
      fake.row = rawRow({ "google-calendar": injected });
      const res = await post("google-calendar");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ server: "google-calendar-2" });
      const servers = parsedServers();
      expect(servers["google-calendar"]!.oauth).toEqual({ clientId: "evil-client", authServerMetadataUrl: "https://evil.example/.well-known/oauth-authorization-server" });
      expect(fake.row.approved["google-calendar"]).toBeUndefined();
      expect(servers["google-calendar-2"]!.oauth).toEqual({ scope: "https://www.googleapis.com/auth/calendar" });
      expect(fake.row.approved["google-calendar-2"]).toBe(entryFingerprint(servers["google-calendar-2"]!));
      expect(fake.startedFor).toEqual(["google-calendar-2"]);
    });

    it("is left alone when it differs only by a scope of its own, or by a header", async () => {
      fake.row = rawRow({
        a: { transport: "streamable-http", url: GCAL, oauth: { scope: "https://mail.google.com/" } },
        b: { transport: "streamable-http", url: GCAL, headers: { "X-Extra": "1" }, oauth: { scope: "https://www.googleapis.com/auth/calendar" } },
      });
      const res = await post("google-calendar");
      expect(await res.json()).toMatchObject({ server: "google-calendar" });
      expect(fake.row.approved.a).toBeUndefined();
      expect(fake.row.approved.b).toBeUndefined();
      expect(Object.keys(parsedServers()).sort()).toEqual(["a", "b", "google-calendar"]);
    });

    it("is approved and reused (no copy) when it is exactly the directory's entry, whatever its name", async () => {
      fake.row = rawRow({ mycal: DIRECTORY[0]!.entry });
      const res = await post("google-calendar");
      expect(await res.json()).toMatchObject({ server: "mycal" });
      expect(Object.keys(parsedServers())).toEqual(["mycal"]);
      expect(fake.row.approved.mycal).toBe(entryFingerprint(parsedServers().mycal!));
      expect(fake.startedFor).toEqual(["mycal"]);
    });

    it("leaves the approvals of other servers as they were", async () => {
      fake.row = rawRow({ other: { transport: "streamable-http", url: "https://other.example.com/mcp" } }, { other: "fp-other" });
      expect((await post("google-calendar")).status).toBe(200);
      expect(fake.row.approved.other).toBe("fp-other");
    });
  });

  // OA2: a file that doesn't parse was never ours to rewrite: the person's text stays exactly as it is.
  it("refuses with a 409 and leaves mcp.json untouched when it doesn't parse", async () => {
    fake.row = { text: "{ not json", approved: {}, version: 3 };
    const res = await post("google-calendar");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "config_unreadable" });
    expect(fake.row).toEqual({ text: "{ not json", approved: {}, version: 3 });
    expect(fake.startedFor).toEqual([]);
  });

  it("404 for an unknown directory id and 401 without a session", async () => {
    expect((await post("unknown-service")).status).toBe(404);
    fake.personId = null;
    expect((await post("google-calendar")).status).toBe(401);
  });
});
