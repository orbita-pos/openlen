// @vitest-environment node
// El servidor MCP habla el protocolo de verdad: un cliente oficial conecta,
// y sin token se contesta 401 con el enlace a la metadata del recurso.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { buildMcpHandler } from "./server";
import { connectTestClient } from "./testing";

// Que un MCP_RESOURCE_URL de la máquina (.env.local) no cambie lo que se prueba.
beforeEach(() => vi.stubEnv("MCP_RESOURCE_URL", "https://mcp.openlen.com/mcp"));

const verify = async (_req: Request, bearer?: string): Promise<AuthInfo | undefined> =>
  bearer === "olp_test"
    ? { token: bearer, clientId: "test", scopes: ["projects:read"], extra: { userId: "u1", tokenId: "t1", projectId: null } }
    : undefined;

const rpc = (headers: Record<string, string> = {}) =>
  new Request("http://mcp.test/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });

describe("el servidor MCP", () => {
  it("un cliente oficial conecta y lista las herramientas", async () => {
    const client = await connectTestClient(buildMcpHandler(verify));
    const { tools } = await client.listTools();
    expect(Array.isArray(tools)).toBe(true);
    await client.close();
  });

  it("sin token: 401 con el enlace ABSOLUTO a la metadata del recurso", async () => {
    const res = await buildMcpHandler(verify)(rpc());
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://mcp.openlen.com/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("con un token malo: también 401", async () => {
    const res = await buildMcpHandler(verify)(rpc({ authorization: "Bearer olp_otro" }));
    expect(res.status).toBe(401);
  });

  it("GET y DELETE: 405 (no hay sesiones)", async () => {
    const h = buildMcpHandler(verify);
    for (const method of ["GET", "DELETE"]) {
      const res = await h(new Request("http://mcp.test/mcp", { method, headers: { authorization: "Bearer olp_test" } }));
      expect(res.status).toBe(405);
    }
  });
});
