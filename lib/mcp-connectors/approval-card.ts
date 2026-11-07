// The «Conectar» card's shape (spec local 2026-11-06-conectores-mcp, §5.3), and the sanitizer the chat runs on it: it
// arrives from the stream, so every field is checked before it is drawn. Client-safe: no imports.

export interface McpApprovalCard {
  readonly server: string;
  readonly host: string;
  readonly headerNames: readonly string[];
  readonly credentials: readonly { readonly name: string; readonly set: boolean; readonly otherHosts: readonly string[] }[];
  readonly fingerprint: string;
  /** The config version the card was drawn from: the tap approves only if the file is still there. */
  readonly version: number;
}

const str = (v: unknown): v is string => typeof v === "string";
const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every(str);

export function mcpApprovalFrom(raw: unknown): McpApprovalCard | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (!str(c.server) || !/^[A-Za-z0-9_-]{1,32}$/.test(c.server) || !str(c.host) || !str(c.fingerprint) || typeof c.version !== "number") return null;
  if (!strs(c.headerNames) || !Array.isArray(c.credentials)) return null;
  const credentials = c.credentials.flatMap((k) => {
    const x = (k ?? {}) as Record<string, unknown>;
    return str(x.name) && typeof x.set === "boolean" && strs(x.otherHosts) ? [{ name: x.name, set: x.set, otherHosts: x.otherHosts }] : [];
  });
  return { server: c.server, host: c.host, headerNames: c.headerNames, credentials, fingerprint: c.fingerprint, version: c.version };
}
