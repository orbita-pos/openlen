// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

beforeEach(() => {
  vi.stubEnv("MCP_RESOURCE_URL", "https://mcp.openlen.com/mcp");
  vi.stubEnv("MCP_ISSUER", "https://openlen.com");
});

describe("la Protected Resource Metadata (RFC 9728)", () => {
  it("dice el recurso, UN servidor de autorización y los permisos, sin offline_access", async () => {
    const res = await GET();
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body).toMatchObject({
      resource: "https://mcp.openlen.com/mcp",
      authorization_servers: ["https://openlen.com"],
      scopes_supported: ["projects:read", "projects:write", "publish"],
      bearer_methods_supported: ["header"],
    });
    expect(body.scopes_supported).not.toContain("offline_access");
  });
});
