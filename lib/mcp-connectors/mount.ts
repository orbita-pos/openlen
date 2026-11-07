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
  const save = async (s: ServerState) => {
    await d.saveState(personId, s);
    return s;
  };
  const opened = await openEntry(personId, entry, d);
  if (!opened.ok) {
    return save({ serverName: name, fingerprint, ...keep, status: opened.stage === "credentials" ? "waiting-credentials" : "failed", error: opened.error, stale: false });
  }
  const { conn, redact } = opened;
  try {
    if (new TextEncoder().encode(conn.instructions).byteLength > INSTRUCTIONS_MAX_BYTES) {
      return save({ serverName: name, fingerprint, ...keep, status: "failed", error: "server instructions are over 32 KB", stale: false });
    }
    const reviewed = reviewTools(name, await conn.listTools());
    if (reviewed.tools.length === 0 && reviewed.problems.some((p) => p.startsWith("duplicate tool name"))) {
      return save({ serverName: name, fingerprint, ...keep, status: "failed", error: reviewed.problems.join("; "), stale: false });
    }
    return save({
      serverName: name,
      fingerprint,
      tools: reviewed.tools,
      instructions: conn.instructions.trim(),
      hasResources: conn.capabilities.resources,
      listedAt: d.now(),
      status: "connected",
      error: reviewed.problems.length > 0 ? redact(reviewed.problems.join("; ")) : null,
      stale: false,
    });
  } catch (err) {
    return save({ serverName: name, fingerprint, ...keep, status: "failed", error: redact(messageOf(err)), stale: false });
  } finally {
    await conn.close();
  }
}

export async function probeServer(
  personId: string,
  name: string,
  d: MountDeps,
): Promise<{ ok: true; serverInfo: { name: string; version: string }; tools: string[]; problems: string[] } | { ok: false; stage: "credentials" | "connect" | "list"; error: string }> {
  const entry = entryIn(await d.readConfig(personId), name);
  if (!entry) return { ok: false, stage: "connect", error: `there is no server named ${name}` };
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

/** Which approved, enabled servers a turn should have mounted outside it: never listed, changed, stale or old. */
export function serversToMount(states: readonly ServerState[], config: McpConfig, approved: Readonly<Record<string, string>>, now: Date): string[] {
  const byName = new Map(states.map((s) => [s.serverName, s]));
  return Object.entries(config.servers)
    .filter(([name, e]) => {
      if (!e.enabled) return false;
      const fp = entryFingerprint(e);
      if (approved[name] !== fp) return false;
      const s = byName.get(name);
      if (!s || s.fingerprint !== fp || s.stale) return true;
      if (s.status === "waiting-credentials") return false;
      return !s.listedAt || now.getTime() - s.listedAt.getTime() > STALE_AFTER_MS;
    })
    .map(([name]) => name);
}
