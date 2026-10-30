// LEN WATCH (spec local 2026-10-30-len-watch): the shapes shared by the server, the web and Len
// mobile. Types and constants only, so a client component can import it.

/** What a visitor's browser reported when the page stayed blank, already scrubbed. */
export interface WatchReport {
  /** The first uncaught error or rejection while the page started; null if none. */
  message: string | null;
  /** Path of the script it came from (no origin, no query), or null. */
  file: string | null;
  line: number | null;
  col: number | null;
  /** Site-page slug the snippet was baked into; null = home. */
  page: string | null;
}

/** The owner's switches. Watching is on for everyone; fixing and publishing are the owner's to turn on. */
export interface LenWatchSettings {
  autoFix: boolean;
  /** Only ever true with `autoFix`. */
  autoPublish: boolean;
  /** No checks, no incidents, no notices for this project. */
  muted: boolean;
  /** The owner's interface language, learned when they touch the switches. */
  locale: string | null;
}

export type IncidentStatus = "open" | "fixing" | "fix_ready" | "publishing" | "needs_owner" | "fix_failed" | "resolved";

/** Every status but `resolved`: while one of these stands, no other incident opens and no turn starts alone. */
export const ACTIVE_STATUSES: readonly IncidentStatus[] = ["open", "fixing", "fix_ready", "publishing", "needs_owner", "fix_failed"];

export type Resolution = "fixed" | "recovered" | "owner_published";

/** An incident as the web and Len mobile read it (GET /api/projects/[id]/len-watch). */
export interface IncidentView {
  id: string;
  status: IncidentStatus;
  reason: string | null;
  summary: string | null;
  shipsUnpublished: boolean;
  createdAt: string;
}

/** What GET /api/projects/[id]/len-watch answers. */
export interface LenWatchStatus {
  enabled: boolean;
  isOwner: boolean;
  settings: LenWatchSettings;
  incident: IncidentView | null;
}

export interface Incident {
  id: string;
  projectId: string;
  status: IncidentStatus;
  sample: WatchReport;
  reports: number;
  /** What Len said when it finished, cut. */
  summary: string | null;
  /** Why it stopped where it did: a turn failure code, a publish gate, `no_change`. */
  reason: string | null;
  /** Publishing the fix would also publish changes the owner hadn't published. */
  shipsUnpublished: boolean;
  turnRowId: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  resolution: Resolution | null;
}
