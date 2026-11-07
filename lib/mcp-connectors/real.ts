// THE REAL DEPENDENCIES OF LEN'S MCP CONNECTORS (spec local 2026-11-06-conectores-mcp): Postgres for the config, states
// and keys, the guarded fetch for the network, the official SDK for the protocol. One place, so the agent route, the
// management routes and the tests (which mock this module) agree.
import "server-only";

import { openMcp } from "./client";
import { credentialNames, resolveCredentials, setCredential } from "./credentials";
import { createGuardedFetch } from "./fetch";
import type { LenFileDeps } from "./len-file";
import type { ManageDeps } from "./manage";
import { mountServer, type MountDeps } from "./mount";
import { deleteServerState, markStale, readMcpConfig, readServerStates, saveServerState, writeMcpConfig } from "./store";
import type { CallDeps, TurnDeps } from "./turn";

/** What OpenLen reads of one MCP answer before it stops: generous (a list of tools, an SSE stream), never unbounded. */
export const MCP_ANSWER_MAX_BYTES = 8 * 1024 * 1024;

const guardedFetch = createGuardedFetch({ maxBytes: MCP_ANSWER_MAX_BYTES });

export function realTurnDeps(): TurnDeps {
  return { readConfig: readMcpConfig, readStates: readServerStates, now: () => new Date() };
}

export function realCallDeps(): CallDeps {
  // Len's model looks at the screenshots his eyes take (lib/agent/usar-pagina.ts): it takes images.
  return { resolveCredentials, open: openMcp, fetch: guardedFetch, markStale, modelTakesImages: true };
}

export function realMountDeps(): MountDeps {
  return {
    readConfig: readMcpConfig,
    readStates: readServerStates,
    saveState: saveServerState,
    resolveCredentials,
    open: openMcp,
    fetch: guardedFetch,
    now: () => new Date(),
  };
}

/** The server names the person's installed tools use for their operations: taken in the one `mcp__` namespace. */
async function installedServerNames(personId: string): Promise<ReadonlySet<string>> {
  const { listInstallations, readReleaseMcp } = await import("@/lib/tools/store");
  const rows = (await listInstallations(personId)).filter((r) => r.enabled && !r.removedAt);
  const mcp = await Promise.all(rows.map((r) => readReleaseMcp(r.releaseSha).catch(() => null)));
  return new Set(mcp.filter((m): m is NonNullable<typeof m> => m !== null).map((m) => m.serverName));
}

export function realLenFileDeps(): LenFileDeps {
  return {
    read: readMcpConfig,
    write: writeMcpConfig,
    installedServerNames,
    credentialNames: async (p) => (await credentialNames(p)).map((c) => c.name),
  };
}

export function realManageDeps(): ManageDeps {
  return {
    read: readMcpConfig,
    write: writeMcpConfig,
    readStates: readServerStates,
    deleteState: deleteServerState,
    credentialNames,
    setCredential,
    installedServerNames,
    mount: (p, n) => mountServer(p, n, realMountDeps()),
  };
}

/** Mounts these servers outside the turn that noticed them; never throws, never waited for. */
export function mountInBackground(personId: string, names: readonly string[]): void {
  if (names.length === 0) return;
  void Promise.all(
    names.map((n) =>
      mountServer(personId, n, realMountDeps()).catch((err: unknown) => {
        console.warn(`[mcp-connectors] mounting ${n} failed:`, err instanceof Error ? err.message : err);
      }),
    ),
  );
}
