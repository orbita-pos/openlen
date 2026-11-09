// A card of what visitors asked for, as the routes send it (spec local 2026-11-06-asistente-propio, §4.6): without who
// decided it. Pure.
import type { RequestCardRow } from "./store";

export interface RequestCardView {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly visitors: number;
  readonly status: "pending" | "accepted" | "dismissed";
  /** Why the Len turn it launched couldn't start; it waits again. */
  readonly failure: string | null;
  readonly acceptedRowId: string | null;
  readonly createdAt: string;
  readonly lastAt: string;
  readonly decidedAt: string | null;
}

export function requestCardView(c: RequestCardRow): RequestCardView {
  return {
    id: c.id,
    projectId: c.projectId,
    title: c.title,
    visitors: c.visitors,
    status: c.status,
    failure: c.failure,
    acceptedRowId: c.acceptedRowId,
    createdAt: c.createdAt.toISOString(),
    lastAt: c.lastAt.toISOString(),
    decidedAt: c.decidedAt ? c.decidedAt.toISOString() : null,
  };
}
