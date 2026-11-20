// How old a stored metrics snapshot may be before a request recomputes it (pure: the route and its test share it).
//
// `GET /api/projects/[id]/ab` used to recompute every running experiment's metrics — four SQL aggregations each — and write
// the row on EVERY request, from every open chat, once a minute. The evaluator already snapshots every 30 minutes; a
// request only recomputes when what is stored is older than this (review item 28).
import type { AbExperimentRow } from "./store";

export const SNAPSHOT_FRESH_MS = 5 * 60_000;

export function isSnapshotFresh(
  row: Pick<AbExperimentRow, "metricsSnapshot" | "evaluatedAt">,
  now: Date = new Date(),
): boolean {
  if (!row.metricsSnapshot || !row.evaluatedAt) return false;
  const age = now.getTime() - row.evaluatedAt.getTime();
  return age >= 0 && age < SNAPSHOT_FRESH_MS;
}
