// THE «CONECTAR» CARD (spec local 2026-11-06-conectores-mcp, §5.3): what OpenLen — never the model — shows the person
// before a server Len added or changed connects. DeepSeek asks approval for every change to the profile's plugins; here
// the tap approves one entry's fingerprint. A credential is a name of the person any entry may cite, as in DeepSeek, so
// the card names each key the server would receive and, in red, any other host that already gets it.
import { entryFingerprint, parseMcpConfig, type McpConfig, type McpServerEntry } from "./config";
import type { ServerState, StoredConfig } from "./store";
import { credentialRefsOf } from "./templates";

export interface ApproveDeps {
  read(personId: string): Promise<StoredConfig>;
  approve(personId: string, name: string, fingerprint: string, expectedVersion: number): Promise<boolean>;
  setCredential(personId: string, name: string, value: string): Promise<void>;
  mount(personId: string, name: string): Promise<ServerState | null>;
}

/** The person's tap: approve the entry exactly as the card showed it, store the keys typed in the card (only ones the
 *  entry cites), then mount it. Anything that moved in between refuses the whole tap. */
export async function approveServer(
  personId: string,
  name: string,
  fingerprint: string,
  version: number,
  credentials: Readonly<Record<string, string>>,
  d: ApproveDeps,
): Promise<{ ok: true; state: ServerState | null } | { ok: false; reason: "changed" | "unknown_credential" }> {
  const stored = await d.read(personId);
  const parsed = parseMcpConfig(stored.text, { reservedServerNames: new Set() });
  const entry = parsed.ok ? parsed.config.servers[name] : undefined;
  if (!entry || stored.version !== version || entryFingerprint(entry) !== fingerprint) return { ok: false, reason: "changed" };
  const refs = new Set(credentialRefsOf(entry));
  if (Object.keys(credentials).some((k) => !refs.has(k))) return { ok: false, reason: "unknown_credential" };
  for (const [k, v] of Object.entries(credentials)) if (v) await d.setCredential(personId, k, v);
  if (!(await d.approve(personId, name, fingerprint, version))) return { ok: false, reason: "changed" };
  return { ok: true, state: await d.mount(personId, name) };
}

export type { McpApprovalCard } from "./approval-card";
import type { McpApprovalCard } from "./approval-card";

export function hostOf(url: string): string {
  try {
    return new URL(url.replace(/\$\{credential:[A-Z0-9_]+\}/g, "x")).hostname;
  } catch {
    return url;
  }
}

export function buildApprovalCard(
  server: string,
  entry: McpServerEntry,
  config: McpConfig,
  approved: Readonly<Record<string, string>>,
  credentialsSet: ReadonlySet<string>,
  version: number,
): McpApprovalCard {
  const host = hostOf(entry.url);
  const credentials = credentialRefsOf(entry).map((name) => {
    const otherHosts = Object.entries(config.servers)
      .filter(([other, e]) => other !== server && approved[other] === entryFingerprint(e) && credentialRefsOf(e).includes(name))
      .map(([, e]) => hostOf(e.url))
      .filter((h) => h !== host);
    return { name, set: credentialsSet.has(name), otherHosts: [...new Set(otherHosts)].sort() };
  });
  return { server, host, headerNames: Object.keys(entry.headers).sort(), credentials, fingerprint: entryFingerprint(entry), version };
}
