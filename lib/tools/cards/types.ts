// «CREAR» CARDS (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): DeepSeek's `create_personalized_page` card
// (packages/experimental/creation-recommendations/src/types.ts) for an OpenLen tool. Pure, client-safe.
import type { ToolPlacement } from "../types";

/** DeepSeek's page phases plus the shared `dismissed` and the derived `replaced`; `proposed` is a card nobody acted on,
 *  and `needs_review` is ours: install answered 428 (security findings, destructive migration). */
export type ToolCardPhase =
  | "proposed"
  | "dismissed"
  | "replaced"
  | "creating"
  | "installing"
  | "installed"
  | "removed"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "needs_review";

/** Phases where the card still offers its action (DeepSeek's `openPhases` plus the unstarted card). */
export const OPEN_PHASES: readonly ToolCardPhase[] = ["proposed", "failed", "cancelled", "interrupted", "needs_review"];

/** The 428 view a card keeps to offer «Instalar igual»: the person's acceptance, never Len's. */
export interface ToolCardReview {
  readonly kind: "security_findings" | "needs_confirmation";
  readonly fingerprint: string;
  readonly findings: readonly string[];
}

/** What the client and Len see of a card. */
export interface ToolCardView {
  readonly id: string;
  readonly chatRowId: string;
  readonly title: string;
  readonly brief: string;
  readonly initialContent: string | null;
  readonly placement: ToolPlacement;
  readonly customLocation: string | null;
  readonly phase: ToolCardPhase;
  readonly toolProjectId: string | null;
  readonly installationId: string | null;
  readonly error: string | null;
  readonly review: ToolCardReview | null;
}

/** Len's card tool, DeepSeek's name (packages/experimental/action-cards). */
export const PROPOSE_ACTION = "propose_action";

/** A human-written place for the tool: DeepSeek's `customLocationSchema` (1 to 1,000 characters, trimmed). */
export const CUSTOM_LOCATION_MAX = 1000;
