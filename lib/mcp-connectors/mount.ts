// MOUNTING A CONNECTOR (spec local 2026-11-06-conectores-mcp, §5.4): what DeepSeek's dsh-mcp-manager does when an entry
// changes — connect, list, keep the list — done OUTSIDE turns here: when the person approves or saves an entry, presses
// «Probar», or the stored list is stale (the server said it changed, a call met a missing tool, or it is over 24 h
// old). A turn only declares what was stored. A failed mount keeps the previous list (DeepSeek's previous generation)
// with the redacted error beside it; `probeServer` is DeepSeek's `probe`: it connects, lists and closes, saving nothing.
import { entryFingerprint, parseMcpConfig, type McpConfig, type McpServerEntry } from "./config";
import type { McpConnection, openMcp } from "./client";
import { reviewTools } from "./names";
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
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The entry, if the file parses and has it. */
function entryIn(stored: StoredConfig, name: string): McpServerEntry | null {
  const parsed = parseMcpConfig(stored.text, { reservedServerNames: new Set() });
  return parsed.ok ? (parsed.config.servers[name] ?? null) : null;
}

type Opened = { ok: true; conn: McpConnection; redact: (s: string) => string } | { ok: false; stage: "credentials" | "connect"; error: string; redact: (s: string) => string };

async function openEntry(personId: string, entry: McpServerEntry, d: MountDeps): Promise<Opened> {
  const values = await d.resolveCredentials(personId, credentialRefsOf(entry));
  const resolved = resolveEntry(entry, values);
  if (!resolved.ok) return { ok: false, stage: "credentials", error: `missing: ${resolved.missing.join(", ")}`, redact: (s) => s };
  const redact = makeRedactor(resolved.resolved);
  try {
    const conn = await d.open({ url: resolved.url, headers: resolved.headers }, { fetch: d.fetch, timeoutMs: entry.startupTimeoutMs });
    return { ok: true, conn, redact };
  } catch (err) {
    return { ok: false, stage: "connect", error: redact(messageOf(err)), redact };
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
  const now = d.now();
  const save = async (s: ServerState) => {
    await d.saveState(personId, s);
    return s;
  };
  // DeepSeek's attempt budget: a failed attempt counts, a success resets it; missing keys aren't an attempt.
  const failed = (error: string): Promise<ServerState> =>
    save({ serverName: name, fingerprint, ...keep, status: "failed", error, stale: false, failures: (prev?.failures ?? 0) + 1, attemptedAt: now });
  const opened = await openEntry(personId, entry, d);
  if (!opened.ok) {
    if (opened.stage !== "credentials") return failed(opened.error);
    return save({ serverName: name, fingerprint, ...keep, status: "waiting-credentials", error: opened.error, stale: false, failures: prev?.failures ?? 0, attemptedAt: prev?.attemptedAt ?? null });
  }
  const { conn, redact } = opened;
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
      status: "connected",
      error: reviewed.problems.length > 0 ? redact(reviewed.problems.join("; ")) : null,
      stale: false,
      failures: 0,
      attemptedAt: now,
    });
  } catch (err) {
    return failed(redact(messageOf(err)));
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
  const opened = await openEntry(personId, entry, d);
  if (!opened.ok) return { ok: false, stage: opened.stage, error: opened.error };
  try {
    const reviewed = reviewTools(name, await opened.conn.listTools());
    return { ok: true, serverInfo: opened.conn.serverInfo, tools: reviewed.tools.map((t) => t.rawName), problems: reviewed.problems.map(opened.redact) };
  } catch (err) {
    return { ok: false, stage: "list", error: opened.redact(messageOf(err)) };
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
 *  failing one only once its retry delay has passed, never after its attempt budget is spent. */
export function serversToMount(states: readonly ServerState[], config: McpConfig, approved: Readonly<Record<string, string>>, now: Date): string[] {
  const byName = new Map(states.map((s) => [s.serverName, s]));
  return Object.entries(config.servers)
    .filter(([name, e]) => {
      if (!e.enabled) return false;
      const fp = entryFingerprint(e);
      if (approved[name] !== fp) return false;
      const s = byName.get(name);
      if (!s || s.fingerprint !== fp) return true;
      if (s.status === "failed") {
        if (s.failures >= MOUNT_MAX_ATTEMPTS) return false;
        return !s.attemptedAt || now.getTime() - s.attemptedAt.getTime() >= retryDelayMs(s.failures);
      }
      if (s.stale) return true;
      if (s.status === "waiting-credentials") return false;
      return !s.listedAt || now.getTime() - s.listedAt.getTime() > STALE_AFTER_MS;
    })
    .map(([name]) => name);
}
