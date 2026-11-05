// ACTING ON A «CREAR» CARD (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): DeepSeek's action-cards
// (packages/experimental/action-cards, at fcc0ad4621, MIT) for OpenLen's `create_tool`. Every verb follows the same
// order: the card is the person's → it is reconciled with what really exists (an installation, a creator still
// running in this process) → concurrent presses on one card share one action → the verb, decided once by
// compare-and-swap. A card already decided only settles: the press sees it as it is.
import "server-only";

import type { Plan } from "@/lib/plan";

import type { ToolPlacement } from "../types";
import type { CreationDeps } from "./creation";
import { toCardView, type ToolCardRow } from "./store";
import { CUSTOM_LOCATION_MAX, OPEN_PHASES, type ToolCardPhase, type ToolCardView } from "./types";

export type ToolCardVerb = "create" | "dismiss" | "cancel" | "undo" | "restore" | "retry" | "install_anyway";

export interface ToolCardPayload {
  /** The card's place picker: one of the two places, or the person's own words for it. */
  readonly placement?: unknown;
  readonly customLocation?: unknown;
  readonly locale: string;
  readonly timeZone: string;
}

export type ToolCardActionResult = { status: "accepted" } | { status: "settled"; card: ToolCardView } | { status: "refused"; reason: string };

export interface ActionDeps {
  cardById(id: string): Promise<ToolCardRow | null>;
  casPhase: CreationDeps["casPhase"];
  installationOf(personId: string, projectId: string): Promise<{ id: string; removedAt: Date | null } | null>;
  plan(personId: string): Promise<Plan>;
  startCreation(
    card: ToolCardRow,
    o: { personId: string; locale: string; timeZone: string; previousError?: string },
  ): Promise<{ ok: true } | { ok: false; reason: "plan_required" }>;
  installAndCheck(card: ToolCardRow, o: { locale: string; acceptSecurityFingerprint?: string; confirmFingerprint?: string }): Promise<void>;
  /** The subagent registry's `stop`: aborts a run working in this process. */
  stopRun(runId: string): boolean;
  markRemoved(installationId: string, personId: string): Promise<boolean>;
  restore(installationId: string, personId: string): Promise<"restored" | "not_found" | "release_gone">;
  /** When this process started: a card left creating or installing before it has nobody finishing it. */
  processStartedAt: Date;
  sleep?(ms: number): Promise<void>;
}

/** When this server process started (one Next process, like the subagent registry). */
const PROCESS_STARTED_AT = new Date();

export async function realActionDeps(): Promise<ActionDeps> {
  const [store, creation, tools, limits, registry, restore] = await Promise.all([
    import("./store"),
    import("./creation"),
    import("../store"),
    import("@/lib/limits"),
    import("@/lib/agent/subagents/registry"),
    import("../restore"),
  ]);
  const cd = await creation.realCreationDeps();
  return {
    cardById: store.cardById,
    casPhase: (id, from, to, set) => store.casPhase(id, from, to, set),
    installationOf: tools.installationOf,
    plan: limits.getUserPlan,
    startCreation: (card, o) => creation.startCreation(card, o, cd),
    installAndCheck: (card, o) => creation.installAndCheck(card, o, cd),
    stopRun: registry.stop,
    markRemoved: tools.markRemoved,
    restore: (id, personId) => restore.restoreInstallation(id, personId),
    processStartedAt: PROCESS_STARTED_AT,
  };
}

/** Presses in flight, by card: a second press while the first runs gets the first's answer (DeepSeek coalesces). */
const inFlight = new Map<string, Promise<ToolCardActionResult>>();

const CANCEL_WAIT_MS = 15_000;
const RETRYABLE: readonly ToolCardPhase[] = ["failed", "cancelled", "interrupted"];

export function actOnCard(cardId: string, personId: string, verb: ToolCardVerb, payload: ToolCardPayload, deps: ActionDeps): Promise<ToolCardActionResult> {
  const running = inFlight.get(cardId);
  if (running) return running;
  const action = act(cardId, personId, verb, payload, deps).finally(() => inFlight.delete(cardId));
  inFlight.set(cardId, action);
  return action;
}

async function act(cardId: string, personId: string, verb: ToolCardVerb, payload: ToolCardPayload, d: ActionDeps): Promise<ToolCardActionResult> {
  const found = await d.cardById(cardId);
  if (!found || found.personId !== personId) return { status: "refused", reason: "unknown" };
  const card = await reconcile(found, d);
  const settled = async (): Promise<ToolCardActionResult> => ({ status: "settled", card: toCardView((await d.cardById(cardId)) ?? card) });

  switch (verb) {
    case "dismiss": {
      if (!OPEN_PHASES.includes(card.phase)) return settled();
      const place = isPlacement(payload.placement) ? { placement: payload.placement } : {};
      await d.casPhase(card.id, [card.phase], "dismissed", place);
      return settled();
    }
    case "create":
    case "retry": {
      const from: readonly ToolCardPhase[] = verb === "create" ? ["proposed"] : RETRYABLE;
      if (!from.includes(card.phase)) return settled();
      const location = locationOf(payload, card);
      if (!location) return { status: "refused", reason: "invalid_location" };
      if ((await d.plan(personId)) === "free") return { status: "refused", reason: "plan_required" };
      const previousError = verb === "retry" ? card.error : null;
      const creating = await d.casPhase(card.id, [card.phase], "creating", { ...location, error: null, review: null, cancelRequested: false });
      if (!creating) return settled();
      const started = await d.startCreation(creating, {
        personId,
        locale: payload.locale,
        timeZone: payload.timeZone,
        ...(previousError ? { previousError } : {}),
      });
      if (!started.ok) {
        await d.casPhase(card.id, ["creating"], card.phase, { error: card.error });
        return { status: "refused", reason: started.reason };
      }
      return { status: "accepted" };
    }
    case "cancel": {
      if (card.phase !== "creating") return settled();
      if (!card.creatorRunId) {
        // The host hasn't launched the creator yet: it will see the card isn't creating and launch nothing.
        await d.casPhase(card.id, ["creating"], "cancelled", { cancelRequested: true });
        return settled();
      }
      await d.casPhase(card.id, ["creating"], "creating", { cancelRequested: true });
      // DeepSeek: abort, then wait for the activation's settlement, which records `cancelled`.
      d.stopRun(card.creatorRunId);
      await waitWhileCreating(card.id, d);
      return settled();
    }
    case "undo": {
      if (card.phase !== "installed" || !card.installationId) return settled();
      await d.markRemoved(card.installationId, personId);
      await d.casPhase(card.id, ["installed"], "removed");
      return settled();
    }
    case "restore": {
      if (card.phase !== "removed" || !card.installationId) return settled();
      const restored = await d.restore(card.installationId, personId);
      if (restored !== "restored") return { status: "refused", reason: "source-missing" };
      await d.casPhase(card.id, ["removed"], "installed");
      return settled();
    }
    case "install_anyway": {
      if (card.phase !== "needs_review" || !card.review) return settled();
      const review = card.review;
      const installing = await d.casPhase(card.id, ["needs_review"], "installing");
      if (!installing) return settled();
      await d.installAndCheck(installing, {
        locale: payload.locale,
        ...(review.kind === "security_findings" ? { acceptSecurityFingerprint: review.fingerprint } : { confirmFingerprint: review.fingerprint }),
      });
      return settled();
    }
  }
}

/**
 * DeepSeek reconciles a card with the registry before every action. Ours: a card left creating or installing by an
 * earlier process has nobody finishing it — interrupted, or installed if its tool did get installed; and an
 * installed card whose tool was removed from the Tools page (or restored there) follows it. A card still being
 * worked on in this process is left alone: its creator's settlement, or its install, decides it.
 */
async function reconcile(card: ToolCardRow, d: ActionDeps): Promise<ToolCardRow> {
  const working = card.phase === "creating" || card.phase === "installing";
  if (working && card.updatedAt >= d.processStartedAt) return card;
  if (card.phase === "dismissed" || card.phase === "replaced" || card.phase === "proposed") return card;
  const inst = card.toolProjectId ? await d.installationOf(card.personId, card.toolProjectId) : null;
  const live = !!inst && !inst.removedAt;
  if (live && card.phase !== "installed") {
    return (await d.casPhase(card.id, [card.phase], "installed", { installationId: inst.id })) ?? card;
  }
  if (!live && card.phase === "installed") return (await d.casPhase(card.id, ["installed"], "removed")) ?? card;
  if (working) return (await d.casPhase(card.id, [card.phase], "interrupted")) ?? card;
  return card;
}

async function waitWhileCreating(cardId: string, d: ActionDeps): Promise<void> {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const until = Date.now() + CANCEL_WAIT_MS;
  while (Date.now() < until) {
    const now = await d.cardById(cardId);
    if (!now || now.phase !== "creating") return;
    await sleep(250);
  }
}

function isPlacement(x: unknown): x is ToolPlacement {
  return x === "rail" || x === "project";
}

/** The place chosen on the card: one of the two, the person's own words (1–1,000 characters), or the card's own. */
function locationOf(p: ToolCardPayload, card: ToolCardRow): { placement: ToolPlacement; customLocation: string | null } | null {
  if (p.customLocation !== undefined && p.customLocation !== null) {
    if (typeof p.customLocation !== "string") return null;
    const words = p.customLocation.trim();
    if (words.length < 1 || words.length > CUSTOM_LOCATION_MAX) return null;
    return { placement: card.placement, customLocation: words };
  }
  if (p.placement !== undefined) return isPlacement(p.placement) ? { placement: p.placement, customLocation: null } : null;
  return { placement: card.placement, customLocation: card.customLocation };
}
