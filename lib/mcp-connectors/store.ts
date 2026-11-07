// WHERE ~/.len/mcp.json AND EACH CONNECTOR'S LAST LIST LIVE (spec local 2026-11-06-conectores-mcp, §5.1, §5.4). The
// config is one row per person, written with compare-and-swap on `version` (two writers never both win), with the
// approvals beside it: server name → the fingerprint the person approved. A server's state is DeepSeek's live
// generation: the last good list a turn declares, kept when a later mount fails.
import "server-only";
import { and, eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import { EMPTY_MCP_CONFIG } from "./config";
import type { ReviewedTool } from "./names";

const c = schema.personMcpConfigs;
const s = schema.personMcpServerState;

export interface ServerState {
  readonly serverName: string;
  readonly fingerprint: string;
  readonly tools: readonly ReviewedTool[];
  readonly instructions: string;
  readonly hasResources: boolean;
  readonly listedAt: Date | null;
  readonly status: "connected" | "failed" | "waiting-credentials";
  readonly error: string | null;
  readonly stale: boolean;
  /** Consecutive failed mounts (DeepSeek's attempt budget); a success resets it, missing keys don't count. */
  readonly failures: number;
  readonly attemptedAt: Date | null;
}

export interface StoredConfig {
  readonly text: string;
  readonly approved: Readonly<Record<string, string>>;
  readonly version: number;
}

export async function readMcpConfig(personId: string): Promise<StoredConfig> {
  const rows = await db.select({ text: c.text, approved: c.approved, version: c.version }).from(c).where(eq(c.personId, personId)).limit(1);
  const r = rows[0];
  return r ? { text: r.text, approved: r.approved ?? {}, version: r.version } : { text: EMPTY_MCP_CONFIG, approved: {}, version: 0 };
}

/** Writes the file if it is still at `expectedVersion`. `approve` marks names approved now (the person wrote them);
 *  approvals of names not in `presentNames` are dropped, the rest are kept as they were. */
export async function writeMcpConfig(
  personId: string,
  text: string,
  expectedVersion: number,
  approve: Readonly<Record<string, string>>,
  presentNames: readonly string[],
): Promise<{ ok: true; version: number } | { ok: false; reason: "conflict" }> {
  const current = await readMcpConfig(personId);
  if (current.version !== expectedVersion) return { ok: false, reason: "conflict" };
  const present = new Set(presentNames);
  const approved = Object.fromEntries(Object.entries({ ...current.approved, ...approve }).filter(([name]) => present.has(name)));
  const version = expectedVersion + 1;
  if (expectedVersion === 0) {
    const inserted = await db.insert(c).values({ personId, text, approved, version }).onConflictDoNothing().returning({ v: c.version });
    return inserted.length === 1 ? { ok: true, version } : { ok: false, reason: "conflict" };
  }
  const updated = await db
    .update(c)
    .set({ text, approved, version, updatedAt: new Date() })
    .where(and(eq(c.personId, personId), eq(c.version, expectedVersion)))
    .returning({ v: c.version });
  return updated.length === 1 ? { ok: true, version } : { ok: false, reason: "conflict" };
}

/** The person's tap on «Conectar»: approve one entry's fingerprint if the file is still at `expectedVersion`. */
export async function approve(personId: string, name: string, fingerprint: string, expectedVersion: number): Promise<boolean> {
  const updated = await db
    .update(c)
    .set({
      approved: sql`${c.approved} || ${JSON.stringify({ [name]: fingerprint })}::jsonb`,
      version: expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(c.personId, personId), eq(c.version, expectedVersion)))
    .returning({ v: c.version });
  return updated.length === 1;
}

export async function readServerStates(personId: string): Promise<ServerState[]> {
  const rows = await db.select().from(s).where(eq(s.personId, personId));
  return rows.map(({ personId: _p, ...r }) => ({ ...r, tools: r.tools ?? [] }));
}

export async function saveServerState(personId: string, st: ServerState): Promise<void> {
  const row = { ...st, tools: [...st.tools] };
  await db
    .insert(s)
    .values({ personId, ...row })
    .onConflictDoUpdate({ target: [s.personId, s.serverName], set: row });
}

export async function markStale(personId: string, serverName: string): Promise<void> {
  await db.update(s).set({ stale: true }).where(and(eq(s.personId, personId), eq(s.serverName, serverName)));
}

export async function deleteServerState(personId: string, serverName: string): Promise<void> {
  await db.delete(s).where(and(eq(s.personId, personId), eq(s.serverName, serverName)));
}
