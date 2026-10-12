// CÓMO SE CONECTA CADA CLIENTE a la URL del MCP. Sacado de la documentación de
// cada uno, comprobada el 11/10/2026: la clave de transporte cambia por
// cliente y equivocarse falla EN SILENCIO — Claude Code salta una entrada con
// `url` sin `type`, Gemini CLI usa SSE con `url` y HTTP sólo con `httpUrl`.
// Los nombres de los clientes son marcas: no se traducen.
export type InstallClient = "claude-code" | "claude-ai" | "chatgpt" | "codex" | "vscode" | "cursor" | "gemini" | "opencode" | "kimi" | "any";

export interface InstallSnippet {
  client: InstallClient;
  label: string;
  /** Pasos en la interfaz del cliente (clave de `projects.mcpInstall`), o null si basta el código. */
  stepsKey: "stepsClaudeAi" | "stepsChatgpt" | "stepsVscode" | "stepsCursor" | null;
  /** Lo que se copia: líneas de terminal, un JSON o la URL. */
  code: string | null;
  codeKind: "shell" | "json" | "url";
  /** Instalar de un clic (VS Code, Cursor). */
  deepLink: string | null;
  /** La orden con que se entra después, cuando el cliente no abre el login solo. */
  signIn: string | null;
}

const json = (v: unknown) => JSON.stringify(v, null, 2);

export function installSnippets(url: string): InstallSnippet[] {
  const vscode = JSON.stringify({ name: "openlen", type: "http", url });
  const cursor = btoa(JSON.stringify({ url }));
  return [
    {
      client: "claude-code",
      label: "Claude Code",
      stepsKey: null,
      code: `claude mcp add --transport http openlen ${url}`,
      codeKind: "shell",
      deepLink: null,
      signIn: "/mcp",
    },
    { client: "claude-ai", label: "Claude (claude.ai, Desktop)", stepsKey: "stepsClaudeAi", code: url, codeKind: "url", deepLink: null, signIn: null },
    { client: "chatgpt", label: "ChatGPT", stepsKey: "stepsChatgpt", code: url, codeKind: "url", deepLink: null, signIn: null },
    {
      client: "codex",
      label: "Codex",
      stepsKey: null,
      code: `codex mcp add openlen --url ${url}\ncodex mcp login openlen`,
      codeKind: "shell",
      deepLink: null,
      signIn: null,
    },
    {
      client: "vscode",
      label: "VS Code",
      stepsKey: "stepsVscode",
      code: json({ servers: { openlen: { type: "http", url } } }),
      codeKind: "json",
      deepLink: `vscode:mcp/install?${encodeURIComponent(vscode)}`,
      signIn: null,
    },
    {
      client: "cursor",
      label: "Cursor",
      stepsKey: "stepsCursor",
      code: json({ mcpServers: { openlen: { url } } }),
      codeKind: "json",
      deepLink: `cursor://anysphere.cursor-deeplink/mcp/install?name=openlen&config=${encodeURIComponent(cursor)}`,
      signIn: null,
    },
    {
      client: "gemini",
      label: "Gemini CLI",
      stepsKey: null,
      code: json({ mcpServers: { openlen: { httpUrl: url } } }),
      codeKind: "json",
      deepLink: null,
      signIn: "/mcp auth openlen",
    },
    {
      client: "opencode",
      label: "OpenCode",
      stepsKey: null,
      code: json({ $schema: "https://opencode.ai/config.json", mcp: { openlen: { type: "remote", url, enabled: true } } }),
      codeKind: "json",
      deepLink: null,
      signIn: "opencode mcp auth openlen",
    },
    {
      client: "kimi",
      label: "Kimi Code",
      stepsKey: null,
      code: json({ mcpServers: { openlen: { url } } }),
      codeKind: "json",
      deepLink: null,
      signIn: "/mcp-config login openlen",
    },
    { client: "any", label: "npx add-mcp", stepsKey: null, code: `npx add-mcp ${url}`, codeKind: "shell", deepLink: null, signIn: null },
  ];
}
