// @vitest-environment node
//
// Installing and starting an OAuth sign-in from the curated directory (spec local 2026-11-17-oauth-de-conectores-mcp,
// §6, §10.3, §10.5): the person's tap on the suggestion card writes the entry into `~/.len/mcp.json` (using `server-2`…
// if the name is taken), approves its fingerprint, and returns `startSignIn(...)`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fake = vi.hoisted(() => ({
  personId: "u1" as string | null,
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
const { POST } = await import("./route");

const post = (id = "google-calendar") =>
  POST(new Request(`http://x/api/mcp-connectors/directory/${id}`, { method: "POST" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  fake.personId = "u1";
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
    const parsed = parseMcpConfig(fake.row.text, { reservedServerNames: new Set() });
    if (!parsed.ok) throw new Error(parsed.error);
    const entry = parsed.config.servers["google-calendar"]!;
    expect(entry.url).toBe("https://calendarmcp.googleapis.com/mcp/v1");
    expect(fake.row.approved["google-calendar"]).toBe(entryFingerprint(entry));
    expect(fake.startedFor).toEqual(["google-calendar"]);
  });

  it("picks google-calendar-2 when google-calendar is already taken by another server", async () => {
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

  it("404 for an unknown directory id and 401 without a session", async () => {
    expect((await post("unknown-service")).status).toBe(404);
    fake.personId = null;
    expect((await post("google-calendar")).status).toBe(401);
  });
});
