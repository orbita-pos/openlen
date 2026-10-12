// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("GET /.well-known/mcp-registry-auth", () => {
  it("con la clave puesta: el texto tal cual, en texto plano", async () => {
    vi.stubEnv("MCP_REGISTRY_AUTH", "v=MCPv1; k=ed25519; p=AAAA");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("v=MCPv1; k=ed25519; p=AAAA");
  });
  it("sin clave: 404", async () => {
    vi.stubEnv("MCP_REGISTRY_AUTH", "");
    expect((await GET()).status).toBe(404);
  });
});
