// The «Conectar» card's shape (spec local 2026-11-06-conectores-mcp, §5.3), and the sanitizer the chat runs on it: it
// arrives from the stream, so every field is checked before it is drawn. Client-safe: no imports.

export interface McpApprovalCard {
  readonly server: string;
  readonly host: string;
  readonly headerNames: readonly string[];
  /** `destinationHosts`: where THIS entry sends the key — the MCP server's host for a header, the authorization server's
   *  for an `oauth.clientSecret` (its token endpoint, not the MCP server). `otherHosts`: where else the key goes today.
   *  `firstTime`: a stored key no approved entry sends to one of these hosts yet. */
  readonly credentials: readonly {
    readonly name: string;
    readonly set: boolean;
    readonly destinationHosts: readonly string[];
    readonly otherHosts: readonly string[];
    readonly firstTime: boolean;
  }[];
  readonly fingerprint: string;
  /** The config version the card was drawn from: the tap approves only if the file is still there. */
  readonly version: number;
  /** An OAuth sign-in the tap opens (spec local 2026-11-17-oauth-de-conectores-mcp, §5.5, §10.2, §10.5). `issuerHost` is
   *  where the person signs in, or null while nobody knows (the card then says «the server's sign-in page»). */
  readonly oauth?: { readonly issuerHost: string | null; readonly reason: "first" | "lapsed" | "scope" };
  /** A connector from the curated directory (`suggest_connectors`, spec local 2026-11-17-oauth-de-conectores-mcp, §6). */
  readonly suggest?: { readonly id: string; readonly name: string; readonly host: string };
}

const str = (v: unknown): v is string => typeof v === "string";
const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every(str);
const REASONS = new Set(["first", "lapsed", "scope"]);

export function mcpApprovalFrom(raw: unknown): McpApprovalCard | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (!str(c.server) || !/^[A-Za-z0-9_-]{1,32}$/.test(c.server) || !str(c.host) || !str(c.fingerprint) || typeof c.version !== "number") return null;
  if (!strs(c.headerNames) || !Array.isArray(c.credentials)) return null;
  const credentials = c.credentials.flatMap((k) => {
    const x = (k ?? {}) as Record<string, unknown>;
    return str(x.name) && typeof x.set === "boolean" && strs(x.otherHosts)
      ? [{ name: x.name, set: x.set, destinationHosts: strs(x.destinationHosts) ? x.destinationHosts : [], otherHosts: x.otherHosts, firstTime: x.firstTime === true }]
      : [];
  });
  const o = c.oauth && typeof c.oauth === "object" ? (c.oauth as Record<string, unknown>) : null;
  // A host is a non-empty string, or null (absent counts as null) while it isn't known; anything else is no sign-in at all.
  const knownHost = o && (o.issuerHost === undefined || o.issuerHost === null || (str(o.issuerHost) && o.issuerHost.length > 0));
  const oauth =
    o && knownHost && str(o.reason) && REASONS.has(o.reason)
      ? { issuerHost: (o.issuerHost ?? null) as string | null, reason: o.reason as "first" | "lapsed" | "scope" }
      : undefined;
  const s = c.suggest && typeof c.suggest === "object" ? (c.suggest as Record<string, unknown>) : null;
  const suggest =
    s && str(s.id) && s.id.length > 0 && str(s.name) && s.name.length > 0 && str(s.host) && s.host.length > 0
      ? { id: s.id, name: s.name, host: s.host }
      : undefined;
  return {
    server: c.server,
    host: c.host,
    headerNames: c.headerNames,
    credentials,
    fingerprint: c.fingerprint,
    version: c.version,
    ...(oauth ? { oauth } : {}),
    ...(suggest ? { suggest } : {}),
  };
}
