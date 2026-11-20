// Shared pure types and constants for OpenLen A/B Testing (Plan 3).
// Zero Node/server-only imports so web client and mobile (`movil/`) can share them.

export type AbVariant = "a" | "b";

export type AbExperimentStatus =
  | "draft"
  | "running"
  | "winner_ready"
  | "inconclusive"
  | "paused_harm"
  | "promoted_b"
  | "kept_a"
  | "cancelled";

export type AbDecisionStatus = "none" | "pending" | "applying" | "resolved";

export type AbPrimaryMetric = "conversion_any" | "form_submit" | "cta_click";

export type AbVerdict =
  | "collecting"
  | "winner_b"
  | "winner_a"
  | "harm_stop"
  | "inconclusive"
  | "srm_blocked";

/** Why an experiment ended with no verdict: `uneven_traffic` = the split never matched its target (sample ratio mismatch) up to
 *  the end of its time, so its numbers can't be trusted. */
export type AbInconclusiveReason = "uneven_traffic";

export type AbBringState = "pending" | "brought" | "conflict" | "declined";

export type AbDecideAction = "promote_b" | "keep_a" | "extend";

export const AB_ACTIVE_STATUSES: readonly AbExperimentStatus[] = [
  "draft",
  "running",
  "winner_ready",
  "inconclusive",
];

export const AB_LIVE_STATUSES: readonly AbExperimentStatus[] = [
  "running",
  "winner_ready",
  "inconclusive",
];

export interface AbVariantCounts {
  readonly views: number;
  readonly clicks: number;
  readonly conversions: number;
  readonly rate: number;
}

export interface AbStatsResult {
  readonly verdict: AbVerdict;
  readonly winner: AbVariant | null;
  readonly probBBeatsA: number;
  readonly probABeatsB: number;
  readonly probHarm30: number;
  readonly expectedLossB: number;
  readonly expectedLossA: number;
  readonly relativeLift: number;
  readonly liftCiLow: number;
  readonly liftCiHigh: number;
  readonly alwaysValidP: number;
  /** The harm brake's own always-valid p-value (one-sided, B worse than A). Absent in snapshots from before it existed. */
  readonly harmAlwaysValidP?: number;
  readonly srmChi2: number;
  readonly srmWarning: boolean;
  readonly durationHours: number;
  /** Set with an `inconclusive` verdict that has a known cause. Absent = it simply ran out of time with a tie. */
  readonly reason?: AbInconclusiveReason;
}

export interface AbMetricsSnapshot {
  readonly a: AbVariantCounts;
  readonly b: AbVariantCounts;
  readonly stats: AbStatsResult;
  readonly computedAt: string;
}

/** Manifest written atomically as `<release>/openlen/ab.json` (lib/ab/layout.ts) and read by Rust `crates/edge` and TS fallback. */
export interface AbManifestExperiment {
  readonly id: string;
  readonly cookieName: string;
  readonly targetPath: string;
  readonly includeLocales: boolean;
  readonly locales: readonly string[];
  /** Basis points (0..10000) assigned to variant B. 5000 = 50/50. */
  readonly splitBps: number;
  readonly salt: string;
  readonly prefixB: string;
  readonly overrideParam: string;
  readonly expiresAt: string | null;
  /** The asset URL paths (leading slash, non-page files) whose bytes differ between B and control: the edge routes
   *  only these to B and marks them no-store. Absent (a manifest from before) = none. */
  readonly overrides?: readonly string[];
}

export interface AbManifest {
  readonly version: 1;
  readonly releaseSha: string;
  readonly experiments: readonly AbManifestExperiment[];
}

export interface AbExperimentView {
  readonly id: string;
  readonly projectId: string;
  readonly projectTitle?: string;
  readonly assistantId: string | null;
  readonly name: string;
  readonly hypothesis: string | null;
  readonly targetPath: string;
  readonly includeLocales: boolean;
  readonly primaryMetric: AbPrimaryMetric;
  readonly splitBps: number;
  readonly status: AbExperimentStatus;
  readonly decisionStatus: AbDecisionStatus;
  readonly copyProjectId: string | null;
  readonly bringState: AbBringState | null;
  readonly winnerVariant: AbVariant | null;
  readonly metrics: AbMetricsSnapshot | null;
  readonly startedAt: string | null;
  readonly minEndAt: string | null;
  readonly endedAt: string | null;
  readonly evaluatedAt: string | null;
  readonly createdAt: string;
}

export interface AbReadySummary {
  readonly experimentId: string;
  readonly projectId: string;
  readonly projectTitle: string;
  readonly name: string;
  readonly status: "winner_ready" | "inconclusive" | "paused_harm";
  readonly winnerVariant: AbVariant | null;
  readonly rateA: number;
  readonly rateB: number;
  readonly liftPct: number;
  readonly totalViews: number;
  readonly probability: number;
  /** An `inconclusive` one whose split never matched its target: it says so instead of «no clear winner». */
  readonly reason?: AbInconclusiveReason;
}
