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
      id: "t1", userId: "u1", kind: "personal", name: "x", scopes: ["projects:read"], projectId: "p1", clientId: null,
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    });
    const info = await verifyMcpToken(req, SECRET);
    expect(info).toMatchObject({ token: SECRET, clientId: "personal:t1", scopes: ["projects:read"], expiresAt: 1893456000 });
    const caller = callerFrom(info);
    expect(caller).toEqual({ userId: "u1", tokenId: "t1", scopes: new Set(["projects:read"]), projectId: "p1" });
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
