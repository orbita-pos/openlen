// THE BRIDGE BETWEEN A TOOL AND OPENLEN (spec local 2026-11-04-herramientas-hechas-por-len, §4.4): JSON-RPC 2.0 —
// the format MCP speaks, which the model has seen millions of times — over `postMessage`, on its own channel so
// it never mixes with the canvas's `openlen:*` messages. The frame holds no credentials; the parent (the
// workspace, or Len's eyes) answers with the person's session. Client-safe: no server imports.

export const BRIDGE_CHANNEL = "openlen-tool";

export const BRIDGE_METHODS = ["context", "backend", "projects", "forms", "visits", "query", "update", "sendPrompt"] as const;
export type BridgeMethod = (typeof BRIDGE_METHODS)[number];

export interface BridgeRequest {
  readonly jsonrpc: "2.0";
  readonly id: number;
  readonly method: BridgeMethod;
  readonly params?: unknown;
  readonly channel: typeof BRIDGE_CHANNEL;
}

export interface BridgeError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface BridgeResponse {
  readonly jsonrpc: "2.0";
  readonly id: number;
  readonly result?: unknown;
  readonly error?: BridgeError;
  readonly channel: typeof BRIDGE_CHANNEL;
}

export interface ToolContext {
  readonly person: { readonly name: string; readonly locale: string };
  readonly theme: { readonly mode: "light" | "dark"; readonly tokens: Readonly<Record<string, string>> };
  readonly project: { readonly id: string; readonly title: string } | null;
  readonly tool: { readonly id: string; readonly version: string };
  readonly environment: "draft" | "installed";
}

export interface BridgeNotification {
  readonly jsonrpc: "2.0";
  readonly method: "context";
  readonly params: ToolContext;
  readonly channel: typeof BRIDGE_CHANNEL;
}

export interface DataChange {
  readonly table: string;
  readonly key: Readonly<Record<string, unknown>>;
  readonly set: Readonly<Record<string, unknown>>;
  readonly before: Readonly<Record<string, unknown>>;
}

export type UpdateResult =
  | { readonly status: "applied"; readonly row: Record<string, unknown> }
  | { readonly status: "changed"; readonly current: Record<string, unknown> | null }
  | { readonly status: "declined" }
  | { readonly status: "refused"; readonly reason: "draft_no_production" | "eyes_never_write" | "owner_only" | "bad_change" };

/** The workspace's colours a tool paints with (`app/[locale]/new/tokens.css`), plus its font. */
export const TOOL_THEME_TOKENS: readonly string[] = [
  "--bg",
  "--bg-elev",
  "--fg",
  "--fg-muted",
  "--fg-faint",
  "--border",
  "--border-strong",
  "--hover",
  "--accent",
  "--accent-strong",
  "--accent-soft",
  "--accent-ring",
  "--link",
  "--font-sans",
];

/** JSON-RPC's own codes for what the bridge doesn't know. */
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;

function onChannel(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && (v as Record<string, unknown>).jsonrpc === "2.0" && (v as Record<string, unknown>).channel === BRIDGE_CHANNEL;
}

export function isBridgeRequest(v: unknown): v is BridgeRequest {
  return onChannel(v) && Number.isSafeInteger(v.id) && (BRIDGE_METHODS as readonly unknown[]).includes(v.method);
}

export function isBridgeResponse(v: unknown): v is BridgeResponse {
  return onChannel(v) && Number.isSafeInteger(v.id) && ("result" in v || (!!v.error && typeof v.error === "object"));
}

export function isBridgeNotification(v: unknown): v is BridgeNotification {
  return onChannel(v) && !("id" in v) && v.method === "context";
}
