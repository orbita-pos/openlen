// @vitest-environment node
// En mcp.<dominio>, /mcp y la metadata van a sus rutas de /api; nada más cambia.
import { describe, expect, it } from "vitest";
import { resolveRewrites } from "@/lib/lienzo/resolve-rewrites";
import { isMcpHost, MCP_REWRITES, mcpHostAllows } from "./host-rewrite";

const ruta = (host: string, url: string) => resolveRewrites(MCP_REWRITES, host, url).pathname;

describe("el host del MCP", () => {
  it("/mcp va al endpoint y la metadata (raíz y ruta insertada) a la suya", () => {
    expect(ruta("mcp.openlen.com", "/mcp")).toBe("/api/mcp");
    expect(ruta("mcp.openlen.com", "/.well-known/oauth-protected-resource")).toBe("/api/mcp/resource-metadata");
    expect(ruta("mcp.openlen.com", "/.well-known/oauth-protected-resource/mcp")).toBe("/api/mcp/resource-metadata");
  });
  it("en otro host no toca nada", () => {
    expect(ruta("openlen.com", "/mcp")).toBe("/mcp");
    expect(ruta("misitio.openlen.app", "/.well-known/oauth-protected-resource")).toBe("/.well-known/oauth-protected-resource");
  });
  it("isMcpHost reconoce mcp.<dominio> con o sin puerto, y nada más", () => {
    expect(isMcpHost("mcp.openlen.com")).toBe(true);
    expect(isMcpHost("MCP.openlen.com:443")).toBe(true);
    expect(isMcpHost("mcp.localhost:3000")).toBe(true);
    expect(isMcpHost("openlen.com")).toBe(false);
    expect(isMcpHost("mcpx.openlen.com")).toBe(false);
    expect(isMcpHost(null)).toBe(false);
  });
  it("🔴 en el host del MCP sólo vive /mcp: la app (portada, login, workspace) no se sirve ahí", () => {
    expect(mcpHostAllows("/mcp")).toBe(true);
    for (const p of ["/", "/en", "/en/new", "/es/login", "/new", "/mcpx"]) expect(mcpHostAllows(p)).toBe(false);
  });
});
