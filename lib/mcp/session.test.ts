// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mcpAgentSession } from "./session";

describe("la sesión del MCP", () => {
  it("escribe como la persona, desde el MCP, con la app puesta", () => {
    const app = { catalogo: "2026-11", entrada: "/src/main.tsx" };
    const s = mcpAgentSession({ projectId: "p1", ownerId: "owner", personId: "member", app });
    expect(s).toMatchObject({ projectId: "p1", userId: "owner", personId: "member", autor: "usuario", desde: "mcp", app });
  });
  it("si quien llama es el dueño, no hay personId", () => {
    expect(mcpAgentSession({ projectId: "p1", ownerId: "u1", personId: "u1", app: null })).not.toHaveProperty("personId");
  });
});
