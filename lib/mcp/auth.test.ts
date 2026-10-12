// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findActiveToken } = vi.hoisted(() => ({ findActiveToken: vi.fn() }));
vi.mock("./tokens", async (orig) => ({ ...(await orig<typeof import("./tokens")>()), findActiveToken }));

import { callerFrom, verifyMcpToken } from "./auth";

const SECRET = "olp_" + "a".repeat(43);
const req = new Request("http://mcp.test/mcp", { method: "POST" });

beforeEach(() => findActiveToken.mockReset());

describe("la puerta del servidor MCP", () => {
  it("sin token, o con uno sin forma, ni pregunta a la base", async () => {
    expect(await verifyMcpToken(req)).toBeUndefined();
    expect(await verifyMcpToken(req, "hola")).toBeUndefined();
    expect(findActiveToken).not.toHaveBeenCalled();
  });

  it("un token vivo da quién es, qué puede y a qué proyecto está acotado", async () => {
    findActiveToken.mockResolvedValue({
      id: "t1", userId: "u1", kind: "personal", name: "x", scopes: ["projects:read"], projectId: "p1", clientId: null, familyId: null,
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    });
    const info = await verifyMcpToken(req, SECRET);
    expect(info).toMatchObject({ token: SECRET, clientId: "personal:t1", scopes: ["projects:read"], expiresAt: 1893456000 });
    const caller = callerFrom(info);
    expect(caller).toEqual({ userId: "u1", tokenId: "t1", scopes: new Set(["projects:read"]), projectId: "p1" });
  });

  it("🔴 un token OAuth: la conexión es su FAMILIA (estable al refrescar), no el token de la hora", async () => {
    findActiveToken.mockResolvedValue({
      id: "acceso-de-esta-hora", userId: "u1", kind: "oauth", name: "Claude", scopes: ["projects:read"], projectId: null,
      clientId: "https://claude.ai/oauth/claude-code-client-metadata", familyId: "fam-1", expiresAt: new Date("2030-01-01T00:00:00Z"),
    });
    const caller = callerFrom(await verifyMcpToken(req, "ola_" + "a".repeat(43)));
    expect(caller?.tokenId).toBe("fam-1");
  });

  it("uno personal: la conexión es el propio token", async () => {
    findActiveToken.mockResolvedValue({ id: "t9", userId: "u1", kind: "personal", name: "x", scopes: [], projectId: null, clientId: null, familyId: null, expiresAt: null });
    expect(callerFrom(await verifyMcpToken(req, "olp_" + "a".repeat(43)))?.tokenId).toBe("t9");
  });

  it("revocado o caducado (la base dice null): no entra", async () => {
    findActiveToken.mockResolvedValue(null);
    expect(await verifyMcpToken(req, SECRET)).toBeUndefined();
  });

  it("callerFrom no se fía de un authInfo sin userId", () => {
    expect(callerFrom(undefined)).toBeNull();
    expect(callerFrom({ token: "x", clientId: "c", scopes: [], extra: {} })).toBeNull();
  });
});
