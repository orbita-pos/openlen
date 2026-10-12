// @vitest-environment node
import { describe, expect, it } from "vitest";
import { installSnippets } from "./install-snippets";

const URL_ = "https://mcp.openlen.com/mcp";
const by = Object.fromEntries(installSnippets(URL_).map((s) => [s.client, s]));

describe("cómo se conecta cada cliente", () => {
  it("están todos, una vez, y todos llevan la URL", () => {
    expect(Object.keys(by).sort()).toEqual(["any", "chatgpt", "claude-ai", "claude-code", "codex", "cursor", "gemini", "kimi", "opencode", "vscode"]);
    for (const s of installSnippets(URL_)) expect(s.code ?? "").toContain("mcp.openlen.com");
  });
  it("Claude Code: --transport http (sin él trata la entrada como stdio), y /mcp para entrar", () => {
    expect(by["claude-code"]).toMatchObject({ code: `claude mcp add --transport http openlen ${URL_}`, signIn: "/mcp" });
  });
  it("Codex: añadir y entrar en la misma receta", () => {
    expect(by.codex!.code).toBe(`codex mcp add openlen --url ${URL_}\ncodex mcp login openlen`);
  });
  it("VS Code: enlace con type http, y el JSON de .vscode/mcp.json", () => {
    const cfg = JSON.parse(decodeURIComponent(by.vscode!.deepLink!.replace("vscode:mcp/install?", "")));
    expect(cfg).toEqual({ name: "openlen", type: "http", url: URL_ });
    expect(JSON.parse(by.vscode!.code!)).toEqual({ servers: { openlen: { type: "http", url: URL_ } } });
  });
  it("Cursor: enlace con la config en base64, y el JSON al lado (el enlace falla en versiones nuevas)", () => {
    const link = new URL(by.cursor!.deepLink!);
    expect(link.protocol).toBe("cursor:");
    expect(link.searchParams.get("name")).toBe("openlen");
    expect(JSON.parse(atob(link.searchParams.get("config")!))).toEqual({ url: URL_ });
    expect(JSON.parse(by.cursor!.code!)).toEqual({ mcpServers: { openlen: { url: URL_ } } });
  });
  it("🔴 Gemini CLI: httpUrl (con url usa SSE y falla en silencio), y /mcp auth para entrar", () => {
    expect(JSON.parse(by.gemini!.code!).mcpServers.openlen).toEqual({ httpUrl: URL_ });
    expect(by.gemini!.signIn).toBe("/mcp auth openlen");
  });
  it("OpenCode: type remote y encendido; Kimi: sólo url; cada uno con su orden para entrar", () => {
    expect(JSON.parse(by.opencode!.code!).mcp.openlen).toEqual({ type: "remote", url: URL_, enabled: true });
    expect(by.opencode!.signIn).toBe("opencode mcp auth openlen");
    expect(JSON.parse(by.kimi!.code!).mcpServers.openlen).toEqual({ url: URL_ });
    expect(by.kimi!.signIn).toBe("/mcp-config login openlen");
  });
  it("claude.ai y ChatGPT: pasos en su interfaz y la URL para pegar", () => {
    expect(by["claude-ai"]).toMatchObject({ stepsKey: "stepsClaudeAi", code: URL_ });
    expect(by.chatgpt).toMatchObject({ stepsKey: "stepsChatgpt", code: URL_ });
  });
});
