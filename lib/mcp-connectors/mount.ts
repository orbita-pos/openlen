// MOUNTING A CONNECTOR (spec local 2026-11-06-conectores-mcp, §5.4): what DeepSeek's dsh-mcp-manager does when an entry
// changes — connect, list, keep the list — done OUTSIDE turns here: when the person approves or saves an entry, presses
// «Probar», or the stored list is stale (the server said it changed, a call met a missing tool, or it is over 24 h
// old). A turn only declares what was stored. A failed mount keeps the previous list (DeepSeek's previous generation)
// with the redacted error beside it; `probeServer` is DeepSeek's `probe`: it connects, lists and closes, saving nothing.
//
// A server that wants the person to sign in (spec local 2026-11-17-oauth-de-conectores-mcp, §5.4 steps 1 and 4) is not a
// failure: it is `needs-auth`, with the authorization server it named, why (first sign-in, one that lapsed, more
// permissions) and the scope. It keeps the last list, doesn't spend the attempt budget and isn't retried by itself — the
// person signs in from «Conectar» and that mounts it. Only a server WITHOUT its own `Authorization` header is given the
// SDK's OAuth, and only when `MountDeps.oauth` is there (`OPENLEN_MCP_OAUTH` on): without it a 401 is `failed`, as before.
import { entryFingerprint, parseMcpConfig, type McpConfig, type McpServerEntry } from "./config";
import type { McpConnection, openMcp } from "./client";
import { reviewTools } from "./names";
import { asNeedsSignIn, connectionProvider, shortError, type ConnectionProvider, type NeedsSignIn, type OAuthDeps } from "./oauth/provider";
import { cleanIssuer, cleanScope } from "./oauth/remote-text";
import type { ServerState, StoredConfig } from "./store";
import { credentialRefsOf, makeRedactor, resolveEntry } from "./templates";

export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
export const INSTRUCTIONS_MAX_BYTES = 32 * 1024;

export interface MountDeps {
  readConfig(personId: string): Promise<StoredConfig>;
  readStates(personId: string): Promise<ServerState[]>;
  saveState(personId: string, state: ServerState): Promise<void>;
  resolveCredentials(personId: string, names: readonly string[]): Promise<Map<string, string>>;
  open: typeof openMcp;
  fetch: typeof fetch;
  now(): Date;
  /** Present only when OAuth is on (`oauthEnabled`): servers that sign in connect through the SDK's OAuth. */
  oauth?: OAuthDeps;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The entry, if the file parses and has it. */
function entryIn(stored: StoredConfig, name: string): McpServerEntry | null {
  const parsed = parseMcpConfig(stored.text, { reservedServerNames: new Set() });
  return parsed.ok ? (parsed.config.servers[name] ?? null) : null;
}

type Redact = (s: string) => string;
type Opened =
  | { ok: true; conn: McpConnection; redact: Redact; provider: ConnectionProvider | undefined }
  | { ok: false; stage: "credentials" | "connect"; error: string; redact: Redact; needs?: NeedsSignIn };

/** A key the person wrote is theirs: a server with its own `Authorization` header is never given OAuth. */
const hasOwnAuthorization = (entry: McpServerEntry): boolean => Object.keys(entry.headers).some((h) => h.toLowerCase() === "authorization");

/** What a sign-in says, as the line the person sees: Claude Code's «needs authentication», «needs you to sign in again»,
 *  «needs additional permissions (scope: …)». The scope is the server's own word: one short redacted line, shown. */
function whyText(needs: NeedsSignIn, redact: Redact): string {
  return shortError(needs.reason === "scope" && needs.scope ? `${needs.message} (scope: ${needs.scope})` : needs.message, redact);
}

async function openEntry(personId: string, name: string, entry: McpServerEntry, d: MountDeps): Promise<Opened> {
  const values = await d.resolveCredentials(personId, credentialRefsOf(entry));
  const resolved = resolveEntry(entry, values);
  if (!resolved.ok) return { ok: false, stage: "credentials", error: `missing: ${resolved.missing.join(", ")}`, redact: (s) => s };
  const redact = makeRedactor(resolved.resolved);
  // The speaker's connection: `personId` is whose config this is, never the owner of anything.
  const provider = d.oauth && !hasOwnAuthorization(entry) ? connectionProvider(personId, name, entry, d.oauth) : undefined;
  try {
    const conn = await d.open({ url: resolved.url, headers: resolved.headers }, { fetch: d.fetch, timeoutMs: entry.startupTimeoutMs, authProvider: provider });
    return { ok: true, conn, redact, provider };
  } catch (err) {
    const needs = await asNeedsSignIn(provider, err);
    return needs ? { ok: false, stage: "connect", error: whyText(needs, redact), redact, needs } : { ok: false, stage: "connect", error: redact(messageOf(err)), redact };
  }
}

export async function mountServer(personId: string, name: string, d: MountDeps): Promise<ServerState | null> {
  const stored = await d.readConfig(personId);
  const entry = entryIn(stored, name);
  if (!entry || !entry.enabled) return null;
  const fingerprint = entryFingerprint(entry);
  if (stored.approved[name] !== fingerprint) return null;
  const prev = (await d.readStates(personId)).find((s) => s.serverName === name);
  const keep = { tools: prev?.tools ?? [], instructions: prev?.instructions ?? "", hasResources: prev?.hasResources ?? false, listedAt: prev?.listedAt ?? null };
  // The sign-in columns are only for `needs-auth`: every other state writes them null, so a server that comes back clears them.
  const noSignIn = { authIssuer: null, authReason: null, authScope: null } as const;
  const now = d.now();
  // Whatever a server said is stored as one short line (the redaction already ran): the model reads it back in its context.
  const save = async (state: ServerState) => {
    const s = state.error === null ? state : { ...state, error: shortError(state.error) };
    await d.saveState(personId, s);
    return s;
  };
  // DeepSeek's attempt budget: a failed attempt counts, a success resets it; missing keys aren't an attempt.
  const failed = (error: string): Promise<ServerState> =>
    save({ serverName: name, fingerprint, ...keep, ...noSignIn, status: "failed", error, stale: false, failures: (prev?.failures ?? 0) + 1, attemptedAt: now });
  // Not a failure: the attempt budget is untouched, the last list stays, and nothing retries it until the person signs in.
  const needsSignIn = (needs: NeedsSignIn, redact: Redact): Promise<ServerState> =>
    save({
      serverName: name,
      fingerprint,
      ...keep,
      status: "needs-auth",
      error: whyText(needs, redact),
      stale: false,
      failures: prev?.failures ?? 0,
      attemptedAt: now,
      authIssuer: cleanIssuer(needs.issuer),
      authReason: needs.reason,
      authScope: cleanScope(needs.scope),
    });
  const opened = await openEntry(personId, name, entry, d);
  if (!opened.ok) {
    if (opened.needs) return needsSignIn(opened.needs, opened.redact);
    if (opened.stage !== "credentials") return failed(opened.error);
    return save({ serverName: name, fingerprint, ...keep, ...noSignIn, status: "waiting-credentials", error: opened.error, stale: false, failures: prev?.failures ?? 0, attemptedAt: prev?.attemptedAt ?? null });
  }
  const { conn, redact, provider } = opened;
  try {
    if (new TextEncoder().encode(conn.instructions).byteLength > INSTRUCTIONS_MAX_BYTES) return failed("server instructions are over 32 KB");
    const reviewed = reviewTools(name, await conn.listTools());
    if (reviewed.tools.length === 0 && reviewed.problems.some((p) => p.startsWith("duplicate tool name"))) return failed(reviewed.problems.join("; "));
    return save({
      serverName: name,
      fingerprint,
      tools: reviewed.tools,
      instructions: conn.instructions.trim(),
      hasResources: conn.capabilities.resources,
      listedAt: now,
      ...noSignIn,
      status: "connected",
      error: reviewed.problems.length > 0 ? redact(reviewed.problems.join("; ")) : null,
      stale: false,
      failures: 0,
      attemptedAt: now,
    });
  } catch (err) {
    // A 401 or a 403 `insufficient_scope` AFTER a good connect (the session ended, the token was revoked) is the same ask.
    const needs = await asNeedsSignIn(provider, err);
    return needs ? needsSignIn(needs, redact) : failed(redact(messageOf(err)));
  } finally {
    await conn.close();
  }
}

export async function probeServer(
  personId: string,
  name: string,
  d: MountDeps,
): Promise<{ ok: true; serverInfo: { name: string; version: string }; tools: string[]; problems: string[] } | { ok: false; stage: "credentials" | "connect" | "list"; error: string }> {
  const stored = await d.readConfig(personId);
  const entry = entryIn(stored, name);
  if (!entry) return { ok: false, stage: "connect", error: `there is no server named ${name}` };
  // Nothing connects without the person's tap; a disabled entry can still be probed (DeepSeek's probe).
  if (stored.approved[name] !== entryFingerprint(entry)) return { ok: false, stage: "connect", error: `${name} isn't approved yet: approve it first` };
  const opened = await openEntry(personId, name, entry, d);
  if (!opened.ok) return { ok: false, stage: opened.stage, error: opened.error };
  try {
    const reviewed = reviewTools(name, await opened.conn.listTools());
    return { ok: true, serverInfo: opened.conn.serverInfo, tools: reviewed.tools.map((t) => t.rawName), problems: reviewed.problems.map(opened.redact) };
  } catch (err) {
    const needs = await asNeedsSignIn(opened.provider, err);
    return { ok: false, stage: "list", error: needs ? whyText(needs, opened.redact) : opened.redact(messageOf(err)) };
  } finally {
    await opened.conn.close();
  }
}

/** DeepSeek's reconnect policy (dsh-mcp-client `reconnect`): delays double from 500 ms up to 30 s, and after 10
 *  consecutive failed attempts it stops until the configuration is reloaded — here, until the person saves or
 *  approves the entry again (those mount it directly, not through this). */
export const MOUNT_INITIAL_DELAY_MS = 500;
export const MOUNT_MAX_DELAY_MS = 30_000;
export const MOUNT_MAX_ATTEMPTS = 10;

export function retryDelayMs(failures: number): number {
  return Math.min(MOUNT_INITIAL_DELAY_MS * 2 ** Math.max(0, failures - 1), MOUNT_MAX_DELAY_MS);
}

/** Which approved, enabled servers a turn should have mounted outside it: never listed, changed, stale or old — and a
 *  failing one only once its retry delay has passed, never after its attempt budget is spent. `oauth` false
 *  (`OPENLEN_MCP_OAUTH=0`): a server left in `needs-auth` is the failure it was before OAuth, retried by that budget. */
export function serversToMount(
  states: readonly ServerState[],
  config: McpConfig,
  approved: Readonly<Record<string, string>>,
  now: Date,
  oauth = true,
): string[] {
  const byName = new Map(states.map((s) => [s.serverName, s]));
  return Object.entries(config.servers)
    .filter(([name, e]) => {
      if (!e.enabled) return false;
      const fp = entryFingerprint(e);
      if (approved[name] !== fp) return false;
      const s = byName.get(name);
      if (!s || s.fingerprint !== fp) return true;
      if (s.status === "failed" || (s.status === "needs-auth" && !oauth)) {
        if (s.failures >= MOUNT_MAX_ATTEMPTS) return false;
        return !s.attemptedAt || now.getTime() - s.attemptedAt.getTime() >= retryDelayMs(s.failures);
      }
      // Claude Code's «Skipping connection (cached needs-auth)»: it waits for the person, whatever its age or `stale`.
      if (s.status === "needs-auth") return false;
      if (s.stale) return true;
      if (s.status === "waiting-credentials") return false;
      return !s.listedAt || now.getTime() - s.listedAt.getTime() > STALE_AFTER_MS;
    })
    .map(([name]) => name);
}
