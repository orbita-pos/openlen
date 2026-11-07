// ~/.len/mcp.json (spec local 2026-11-06-conectores-mcp, §5.1): DeepSeek's dsh-mcp-manager `servers` map, as a file of
// the person. Validated at the write as DeepSeek does — an entry the client couldn't act on is never stored, and the
// refusal names the offending field. Keys never sit here in clear: a sensitive header (DeepSeek's own scrub rule,
// /KEY|PASSWORD|SECRET|TOKEN/i, applied to the header NAME, plus Authorization, Proxy-Authorization and Cookie) only
// takes `${credential:NAME}` references around fixed words, and `findSecret` runs over the url and every value. Pure.
import { createHash } from "node:crypto";

import { findSecret } from "@/lib/agent/memory/secrets";

import { CREDENTIAL_REF, referencesWellFormed } from "./templates";

export interface McpServerEntry {
  readonly transport: "streamable-http";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly enabled: boolean;
  readonly startupTimeoutMs: number;
  readonly toolCallTimeoutMs: number;
}

export interface McpConfig {
  readonly servers: Readonly<Record<string, McpServerEntry>>;
}

export const MCP_MAX_SERVERS = 10;
export const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/;
const DEFAULT_STARTUP_MS = 30_000;
const DEFAULT_CALL_MS = 60_000;
const TIMEOUT_MIN = 1_000;
const TIMEOUT_MAX = 120_000;
const ENTRY_FIELDS = new Set(["transport", "url", "headers", "enabled", "startupTimeoutMs", "toolCallTimeoutMs"]);
const STDIO_FIELDS = new Set(["command", "args", "env", "cwd"]);
const SENSITIVE_HEADER_NAME = /KEY|PASSWORD|SECRET|TOKEN/i;
const SENSITIVE_HEADERS = new Set(["authorization", "proxy-authorization", "cookie"]);
const FIXED_WORDS = /^[A-Za-z :=;,-]*$/;

type Parsed = { ok: true; config: McpConfig } | { ok: false; error: string };
const refuse = (error: string): Parsed => ({ ok: false, error });

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADERS.has(name.toLowerCase()) || SENSITIVE_HEADER_NAME.test(name);
}

function timeout(v: unknown, field: string, fallback: number): number | string {
  if (v === undefined) return fallback;
  if (typeof v !== "number" || !Number.isInteger(v) || v < TIMEOUT_MIN || v > TIMEOUT_MAX) return `${field}: must be a whole number of milliseconds from ${TIMEOUT_MIN} to ${TIMEOUT_MAX}`;
  return v;
}

function entryOf(name: string, raw: unknown): McpServerEntry | string {
  const at = `servers.${name}`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return `${at}: must be an object`;
  const e = raw as Record<string, unknown>;
  if (e.transport === "stdio") return `${at}.transport: stdio isn't available yet: a server must be a https:// URL`;
  if (e.transport !== "streamable-http") return `${at}.transport: must be "streamable-http"`;
  for (const k of Object.keys(e)) {
    if (STDIO_FIELDS.has(k)) return `${at}.${k}: not a field of streamable-http`;
    if (!ENTRY_FIELDS.has(k)) return `${at}.${k}: unknown field`;
  }
  if (typeof e.url !== "string") return `${at}.url: must be an https:// URL`;
  let parsed: URL;
  try {
    parsed = new URL(e.url.replace(CREDENTIAL_REF, "x"));
  } catch {
    return `${at}.url: must be an https:// URL`;
  }
  if (parsed.protocol !== "https:") return `${at}.url: must be an https:// URL`;
  if (!referencesWellFormed(e.url)) return `${at}.url: malformed credential reference (use \${credential:NAME}, NAME in A-Z, 0-9 and _)`;
  const urlSecret = findSecret(e.url);
  if (urlSecret) return `${at}.url: it looks like it holds a ${urlSecret}; write the key as \${credential:NAME}`;
  const headersRaw = e.headers ?? {};
  if (typeof headersRaw !== "object" || Array.isArray(headersRaw) || headersRaw === null) return `${at}.headers: must be an object of strings`;
  const headers: Record<string, string> = {};
  for (const [h, v] of Object.entries(headersRaw as Record<string, unknown>)) {
    const field = `${at}.headers.${h}`;
    if (typeof v !== "string") return `${field}: must be a string`;
    if (!referencesWellFormed(v)) return `${field}: malformed credential reference (use \${credential:NAME}, NAME in A-Z, 0-9 and _)`;
    const secret = findSecret(v);
    if (secret) return `${field}: it looks like it holds a ${secret}; write the key as \${credential:NAME}`;
    if (isSensitiveHeader(h)) {
      const refs = v.match(CREDENTIAL_REF) ?? [];
      if (refs.length === 0 || !FIXED_WORDS.test(v.replace(CREDENTIAL_REF, ""))) return `${field}: write the key as \${credential:NAME}; the person types its value in OpenLen`;
    }
    headers[h] = v;
  }
  if (e.enabled !== undefined && typeof e.enabled !== "boolean") return `${at}.enabled: must be true or false`;
  const startup = timeout(e.startupTimeoutMs, `${at}.startupTimeoutMs`, DEFAULT_STARTUP_MS);
  if (typeof startup === "string") return startup;
  const call = timeout(e.toolCallTimeoutMs, `${at}.toolCallTimeoutMs`, DEFAULT_CALL_MS);
  if (typeof call === "string") return call;
  return { transport: "streamable-http", url: e.url, headers, enabled: e.enabled ?? true, startupTimeoutMs: startup, toolCallTimeoutMs: call };
}

export function parseMcpConfig(text: string, opts: { reservedServerNames: ReadonlySet<string> }): Parsed {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    return refuse(`mcp.json: not valid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return refuse('mcp.json: must be an object with "servers"');
  for (const k of Object.keys(doc)) if (k !== "servers") return refuse(`${k}: unknown field (the file has only "servers")`);
  const serversRaw = (doc as { servers?: unknown }).servers ?? {};
  if (!serversRaw || typeof serversRaw !== "object" || Array.isArray(serversRaw)) return refuse("servers: must be an object");
  const names = Object.keys(serversRaw);
  if (names.length > MCP_MAX_SERVERS) return refuse(`servers: at most ${MCP_MAX_SERVERS}; remove one before adding another`);
  const servers: Record<string, McpServerEntry> = {};
  for (const name of names) {
    if (!SERVER_NAME.test(name)) return refuse(`servers.${name}: a server name is 1 to 32 letters, digits, _ or -`);
    if (opts.reservedServerNames.has(name)) return refuse(`servers.${name}: an installed tool already uses this name`);
    const entry = entryOf(name, (serversRaw as Record<string, unknown>)[name]);
    if (typeof entry === "string") return refuse(entry);
    servers[name] = entry;
  }
  return { ok: true, config: { servers } };
}

/** What the person approves: where it goes and what it sends (raw templates), not whether it is on or its timeouts. */
export function entryFingerprint(e: Pick<McpServerEntry, "url" | "headers">): string {
  const headers = Object.fromEntries(Object.entries(e.headers).sort(([a], [b]) => a.localeCompare(b)));
  return createHash("sha256").update(JSON.stringify({ url: e.url, headers })).digest("hex");
}

export function serializeMcpConfig(c: McpConfig): string {
  return `${JSON.stringify(c, null, 2)}\n`;
}

export const EMPTY_MCP_CONFIG = serializeMcpConfig({ servers: {} });
