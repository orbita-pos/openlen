// ~/.len/mcp.json WRITTEN BY LEN (spec local 2026-11-06-conectores-mcp, §5.1, §5.3): DeepSeek's Creator installs an
// MCP bundle through `plugin_manager`, with approval per call; here Len writes the file like his skills, it is validated
// as DeepSeek validates a settings write, and every server whose url or headers are new waits for the person's tap.
// What stays approved is exactly what the person approved: the fingerprint of an entry's url and raw headers.
import { HOME_DIR } from "@/lib/agent/ficheros/len-md";

import { buildApprovalCard, type McpApprovalCard } from "./approval";
import { entryFingerprint, parseMcpConfig } from "./config";
import type { StoredConfig } from "./store";

export const MCP_CONFIG_PATH = `${HOME_DIR}/.len/mcp.json`;

export interface LenFileDeps {
  read(personId: string): Promise<StoredConfig>;
  write(
    personId: string,
    text: string,
    expectedVersion: number,
    approve: Readonly<Record<string, string>>,
    presentNames: readonly string[],
  ): Promise<{ ok: true; version: number } | { ok: false; reason: "conflict" }>;
  installedServerNames(personId: string): Promise<ReadonlySet<string>>;
  credentialNames(personId: string): Promise<readonly string[]>;
}

export type LenFileSaved = { ok: true; before: string; pending: McpApprovalCard[]; note: string } | { ok: false; error: string };

export async function saveLenMcpConfig(personId: string, text: string, d: LenFileDeps): Promise<LenFileSaved> {
  const parsed = parseMcpConfig(text, { reservedServerNames: await d.installedServerNames(personId) });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const current = await d.read(personId);
  const names = Object.keys(parsed.config.servers);
  const written = await d.write(personId, text, current.version, {}, names);
  if (!written.ok) return { ok: false, error: "~/.len/mcp.json changed while you were writing it: read it again and redo your change." };
  const approved = Object.fromEntries(Object.entries(current.approved).filter(([n]) => names.includes(n)));
  const set = new Set(await d.credentialNames(personId));
  const before = parseMcpConfig(current.text, { reservedServerNames: new Set() });
  const previous = before.ok ? { config: before.config, approved: current.approved } : undefined;
  const pending = names
    .filter((n) => parsed.config.servers[n]!.enabled && approved[n] !== entryFingerprint(parsed.config.servers[n]!))
    .map((n) => buildApprovalCard(n, parsed.config.servers[n]!, parsed.config, approved, set, written.version, previous));
  const waiting = pending.map((c) => c.server);
  const note =
    waiting.length === 0
      ? ""
      : `${waiting.join(", ")} ${waiting.length === 1 ? "waits" : "wait"} for the person's approval in a card; ${waiting.length === 1 ? "it doesn't" : "they don't"} connect until then.`;
  return { ok: true, before: current.text, pending, note };
}
