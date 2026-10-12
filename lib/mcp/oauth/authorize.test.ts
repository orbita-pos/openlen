// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ insert: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { insert: () => ({ values: m.insert }) }, schema: { mcpOauthRequests: {} } }));

import { startAuthorization, withIss } from "./authorize";

const client = { id: "olc_x", kind: "dcr" as const, name: "Cliente", redirectUris: ["http://127.0.0.1:1234/cb"] };
const resolveClient = vi.fn(async (id: string) => (id === "olc_x" ? client : null));
const base = {
  response_type: "code", client_id: "olc_x", redirect_uri: "http://127.0.0.1:5555/cb", state: "st",
  code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", code_challenge_method: "S256",
  scope: "projects:read projects:write", resource: "https://mcp.openlen.com/mcp",
};
const qs = (over: Record<string, string | undefined> = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== undefined) p.set(k, v);
  return p;
};

beforeEach(() => {
  vi.stubEnv("MCP_ISSUER", "https://openlen.com");
  vi.stubEnv("MCP_RESOURCE_URL", "https://mcp.openlen.com/mcp");
  m.insert.mockReset();
  m.insert.mockResolvedValue(undefined);
});

describe("/authorize", () => {
  it("una petición buena se guarda y va a la pantalla de consentimiento", async () => {
    const r = await startAuthorization(qs(), { resolveClient });
    expect(r.kind).toBe("consent");
    expect(m.insert).toHaveBeenCalledWith(expect.objectContaining({ clientId: "olc_x", redirectUri: "http://127.0.0.1:5555/cb", state: "st", scopes: ["projects:read", "projects:write"] }));
  });

  it("🔴 cliente desconocido o redirect_uri no registrado: error en la página, NUNCA redirección", async () => {
    expect(await startAuthorization(qs({ client_id: "olc_nadie" }), { resolveClient })).toMatchObject({ kind: "error", error: "invalid_client" });
    expect(await startAuthorization(qs({ redirect_uri: "https://evil.com/cb" }), { resolveClient })).toMatchObject({ kind: "error", error: "invalid_request" });
  });

  it("sin PKCE S256: vuelve al cliente con invalid_request, su state e iss", async () => {
    const r = await startAuthorization(qs({ code_challenge_method: "plain" }), { resolveClient });
    expect(r.kind).toBe("redirect");
    if (r.kind !== "redirect") return;
    const u = new URL(r.url);
    expect(u.searchParams.get("error")).toBe("invalid_request");
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("iss")).toBe("https://openlen.com");
  });

  it("un resource que no es el nuestro: invalid_target", async () => {
    const r = await startAuthorization(qs({ resource: "https://otro.com/mcp" }), { resolveClient });
    expect(r.kind === "redirect" && new URL(r.url).searchParams.get("error")).toBe("invalid_target");
  });

  it("sin scope pide los tres; offline_access se ignora (no es un permiso del MCP)", async () => {
    await startAuthorization(qs({ scope: undefined }), { resolveClient });
    expect(m.insert).toHaveBeenLastCalledWith(expect.objectContaining({ scopes: ["projects:read", "projects:write", "publish"] }));
    await startAuthorization(qs({ scope: "offline_access projects:read" }), { resolveClient });
    expect(m.insert).toHaveBeenLastCalledWith(expect.objectContaining({ scopes: ["projects:read"] }));
  });

  it("sólo offline_access (u openid): es no pedir ningún permiso del MCP — los tres", async () => {
    await startAuthorization(qs({ scope: "offline_access" }), { resolveClient });
    expect(m.insert).toHaveBeenLastCalledWith(expect.objectContaining({ scopes: ["projects:read", "projects:write", "publish"] }));
    await startAuthorization(qs({ scope: "openid offline_access" }), { resolveClient });
    expect(m.insert).toHaveBeenLastCalledWith(expect.objectContaining({ scopes: ["projects:read", "projects:write", "publish"] }));
  });

  it("un permiso que no existe, a solas: invalid_scope", async () => {
    const r = await startAuthorization(qs({ scope: "admin" }), { resolveClient });
    expect(r.kind === "redirect" && new URL(r.url).searchParams.get("error")).toBe("invalid_scope");
  });

  it("withIss pone iss siempre", () => {
    expect(new URL(withIss("http://127.0.0.1:1/cb?x=1", { code: "c", state: undefined })).searchParams.get("iss")).toBe("https://openlen.com");
  });
});
