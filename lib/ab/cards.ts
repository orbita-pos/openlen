// Which A/B experiments get a card (pure: the chat, the Insights panel and the phone share it; no server-only).
import type { AbExperimentView } from "./types";

/** How long an experiment the harm brake stopped keeps an informational card: the push and the email open a screen, and
 *  that screen must show what they talk about (review item 23). */
export const HARM_NOTICE_DAYS = 14;

const DAY_MS = 86_400_000;

/** Stopped for harm within the last `HARM_NOTICE_DAYS`: a card to read, with no decision to take. */
export function isRecentHarmStop(
  e: Pick<AbExperimentView, "status" | "endedAt">,
  now: number = Date.now(),
): boolean {
  if (e.status !== "paused_harm") return false;
  const ended = e.endedAt ? Date.parse(e.endedAt) : NaN;
  return Number.isFinite(ended) && now - ended <= HARM_NOTICE_DAYS * DAY_MS;
}

/** A promoted Variant B that isn't in the owner's draft yet (it clashed, or Len was working): their next publish waits. */
export function isUnbroughtWinner(e: Pick<AbExperimentView, "status" | "bringState">): boolean {
  return e.status === "promoted_b" && (e.bringState === "conflict" || e.bringState === "pending");
}

/** What the chat shows above the composer: a draft to launch, a decision waiting, a conflict to bring in, a recent harm
 *  stop, and the experiment a link points at (`?ab=<id>`). */
export function visibleAbCards(
  experiments: readonly AbExperimentView[],
  o: { readonly highlight?: string | null; readonly now?: number } = {},
): AbExperimentView[] {
  const now = o.now ?? Date.now();
  return experiments.filter(
    (e) =>
      e.status === "draft" ||
      ((e.status === "winner_ready" || e.status === "inconclusive") && e.decisionStatus === "pending") ||
      isUnbroughtWinner(e) ||
      isRecentHarmStop(e, now) ||
      (o.highlight != null && e.id === o.highlight),
  );
}
