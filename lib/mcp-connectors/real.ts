// THE REAL DEPENDENCIES OF LEN'S MCP CONNECTORS (spec local 2026-11-06-conectores-mcp): Postgres for the config, states
// and keys, the guarded fetch for the network, the official SDK for the protocol. One place, so the agent route, the
// management routes and the tests (which mock this module) agree.
import "server-only";

import { openMcp } from "./client";
import { resolveCredentials } from "./credentials";
import { createGuardedFetch } from "./fetch";
import { mountServer, type MountDeps } from "./mount";
import { markStale, readMcpConfig, readServerStates, saveServerState } from "./store";
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
