// READING A PROJECT'S BASE READ-ONLY, from the server (spec local 2026-11-03-len-que-avisa, §7.2): with the
// environment's SELECT-only role (lib/backend/read-only.ts, BYPASSRLS: it sees what the owner sees in their
// panel) inside a READ ONLY transaction with a 10 s timeout. The artifacts' datasets and the event tasks'
// sources read through here. Null: no backend, or that environment doesn't exist yet (never published).
import "server-only";

import type { QueryOutcome } from "./cli-core";

export async function queryBackendReadOnly(projectId: string, environment: "draft" | "live", sql: string): Promise<QueryOutcome | null> {
  const [{ getBackendByProject }, { getEnvironment, claimReadOnlyPassword }, { backendConfigured }] = await Promise.all([import("./registry"), import("./environments"), import("./pg")]);
  if (!backendConfigured()) return null;
  const rec = await getBackendByProject(projectId);
  const env = await getEnvironment(projectId, environment);
  if (!rec || !env?.provisionedAt) return null;
  const [{ encryptToken, decryptToken }, { newDatabasePassword }, { provisionReadOnlyRole }, { runLiveQuery }] = await Promise.all([import("../integrations/crypto"), import("./keys"), import("./read-only"), import("./sql-query")]);
  const encrypted = env.readOnlyPasswordEncrypted ?? await claimReadOnlyPassword(projectId, encryptToken(newDatabasePassword()), environment);
  const roPassword = decryptToken(encrypted);
  await provisionReadOnlyRole({ scope: env.scope, ref: rec.ref, password: roPassword });
  // runLiveQuery is named for its original CLI consumer, but accepts any scope: both environments use its
  // SELECT-only role and READ ONLY transaction.
  return runLiveQuery({ scope: env.scope, roPassword }, sql);
}

/** Production: what a published app's visitors wrote. */
export const queryLive = (projectId: string, sql: string): Promise<QueryOutcome | null> => queryBackendReadOnly(projectId, "live", sql);
