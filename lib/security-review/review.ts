// lib/security-review/review.ts — THE SECURITY REVIEW AT PUBLISH (spec local
// 2026-10-15-security-review-design). One review per project and fingerprint:
//   · the rules (phase 0) run when it starts and are stored with it;
//   · the model (phases 1–3) runs in the background, only for projects with a
//     backend or functions, within the day's budget.
// Who asks what:
//   · the publish route, Len's publish and the MCP's publish ask `gate`;
//   · the dialog asks `start` and `view`;
//   · Len waits with `forAgent`.
//
// One process serves the app (one box), so the reviews in flight are a Map
// here. A `running` row that this process isn't running, and that is older
// than any real run can be, was cut by a restart: it is closed as failed when
// someone asks for it.

import { checkBudget, utcDayStart } from "./budget";
import { securityReviewEnabled } from "./enabled";
import { changedPaths, fileHashes, fingerprintOf } from "./fingerprint";
import type { ModelReviewResult } from "./model-review";
import { languageName, MAX_FILES_IN_PROMPT, projectContextMessage, scanFocusMessage } from "./prompt";
import { runRules } from "./rules";
import type { SecurityReviewStore } from "./store";
import type { Finding, ReviewInputs, ReviewRecord, ReviewStatus, ReviewView } from "./types";
import { buildView } from "./view";

export interface ReviewDeps {
  readonly store: SecurityReviewStore;
  loadInputs(projectId: string): Promise<ReviewInputs | null>;
  modelReview(o: {
    readonly inputs: ReviewInputs;
    readonly context: string;
    readonly focus: string;
    readonly signal: AbortSignal;
  }): Promise<ModelReviewResult & { readonly costCentiCredits: number }>;
  now(): Date;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export type Gate =
  | { readonly kind: "open"; readonly view: ReviewView | null }
  | { readonly kind: "pending"; readonly view: ReviewView }
  | { readonly kind: "blocked"; readonly view: ReviewView };

export interface AgentReview {
  readonly view: ReviewView;
  readonly firstTimeForAgent: boolean;
}

export interface SecurityReviewer {
  start(projectId: string, locale: string): Promise<ReviewView | null>;
  view(projectId: string, fingerprint: string): Promise<ReviewView | null>;
  wait(projectId: string, fingerprint: string, timeoutMs: number): Promise<ReviewView | null>;
  gate(o: { readonly projectId: string; readonly accept?: string; readonly actorId: string; readonly locale: string }): Promise<Gate>;
  forAgent(projectId: string, locale: string, waitMs?: number): Promise<AgentReview | null>;
}

/** Longer than phases 1–3 together (150 s), shorter than the agent route's silence clock (180 s). */
export const AGENT_WAIT_MS = 155_000;
/** Older than any real run (150 s): a `running` row nobody here runs was cut by a restart. */
export const ORPHAN_AFTER_MS = 160_000;
/** A review whose model run failed is tried again when asked, once this long has passed. */
export const RETRY_FAILED_AFTER_MS = 10 * 60_000;

const hasFunctions = (files: Readonly<Record<string, string>>) => Object.keys(files).some((p) => p.startsWith("/supabase/functions/"));

/** A review that didn't get its model run is not final: a budget skip from an earlier UTC day, a run cut by a newer
 *  state of the project, or a run that failed long enough ago. Otherwise the same content would be published without
 *  the model's review forever. */
function retryable(r: ReviewRecord, now: Date): boolean {
  if (r.status === "skipped_budget") return r.startedAt < utcDayStart(now);
  if (r.status !== "failed") return false;
  if (r.failReason === "superseded") return true;
  return now.getTime() - (r.finishedAt ?? r.startedAt).getTime() >= RETRY_FAILED_AFTER_MS;
}

export function createSecurityReviewer(deps: ReviewDeps): SecurityReviewer {
  const inFlight = new Map<string, { readonly fingerprint: string; readonly controller: AbortController; readonly done: Promise<void> }>();

  async function viewOf(r: ReviewRecord): Promise<ReviewView> {
    return buildView(r, await deps.store.acceptedFindings(r.projectId));
  }

  async function settleOrphan(r: ReviewRecord): Promise<ReviewRecord> {
    if (r.status !== "running") return r;
    if (inFlight.get(r.projectId)?.fingerprint === r.fingerprint) return r;
    if (deps.now().getTime() - r.startedAt.getTime() <= ORPHAN_AFTER_MS) return r;
    await deps.store.finish(r.projectId, r.fingerprint, { status: "failed", findings: [], costCentiCredits: 0, failReason: "interrupted", finishedAt: deps.now() });
    return (await deps.store.get(r.projectId, r.fingerprint)) ?? r;
  }

  function launch(inputs: ReviewInputs, fingerprint: string, phase0: readonly Finding[], hashes: Record<string, string>, locale: string): void {
    const { projectId } = inputs;
    // A newer state of the project replaces the review of an older one.
    inFlight.get(projectId)?.controller.abort();
    const controller = new AbortController();
    const done = (async () => {
      let costCentiCredits = 0;
      try {
        const previous = await deps.store.latestDone(projectId);
        const accepted = [...(await deps.store.acceptedFindings(projectId)).values()];
        const changed = previous ? changedPaths(previous.fileHashes, hashes).slice(0, MAX_FILES_IN_PROMPT) : [];
        const r = await deps.modelReview({
          inputs,
          context: projectContextMessage({ inputs, phase0 }),
          focus: scanFocusMessage({ changed, accepted, language: languageName(locale) }),
          signal: controller.signal,
        });
        costCentiCredits = r.costCentiCredits;
        await deps.store.finish(
          projectId,
          fingerprint,
          r.ok
            ? { status: "done", findings: r.findings, costCentiCredits, failReason: null, finishedAt: deps.now() }
            : { status: "failed", findings: [], costCentiCredits, failReason: controller.signal.aborted ? "superseded" : r.reason, finishedAt: deps.now() },
        );
      } catch (err) {
        await deps.store
          .finish(projectId, fingerprint, { status: "failed", findings: [], costCentiCredits, failReason: controller.signal.aborted ? "superseded" : String(err).slice(0, 500), finishedAt: deps.now() })
          .catch(() => undefined);
      } finally {
        if (inFlight.get(projectId)?.controller === controller) inFlight.delete(projectId);
      }
    })();
    inFlight.set(projectId, { fingerprint, controller, done });
  }

  async function startRecord(projectId: string, locale: string): Promise<ReviewRecord | null> {
    if (!securityReviewEnabled(deps.env)) return null;
    const inputs = await deps.loadInputs(projectId);
    if (!inputs) return null;
    const fingerprint = fingerprintOf(inputs);
    const inScope = inputs.hasBackend || hasFunctions(inputs.files);
    const existing = await deps.store.get(projectId, fingerprint);
    if (existing) {
      const settled = await settleOrphan(existing);
      const now = deps.now();
      if (!inScope || !retryable(settled, now) || !(await checkBudget(deps.store, projectId, now, deps.env)).ok) return settled;
      if (await deps.store.restart(projectId, fingerprint, now)) launch(inputs, fingerprint, settled.phase0, fileHashes(inputs), locale);
      return deps.store.get(projectId, fingerprint);
    }
    const phase0 = runRules(inputs);
    const hashes = fileHashes(inputs);
    const now = deps.now();
    const status: ReviewStatus = !inScope
      ? "skipped_scope"
      : (await checkBudget(deps.store, projectId, now, deps.env)).ok
        ? "running"
        : "skipped_budget";
    const inserted = await deps.store.insert({ projectId, fingerprint, status, phase0, fileHashes: hashes, startedAt: now });
    if (inserted && status === "running") launch(inputs, fingerprint, phase0, hashes, locale);
    return deps.store.get(projectId, fingerprint);
  }

  async function view(projectId: string, fingerprint: string): Promise<ReviewView | null> {
    const r = await deps.store.get(projectId, fingerprint);
    return r ? viewOf(await settleOrphan(r)) : null;
  }

  async function wait(projectId: string, fingerprint: string, timeoutMs: number): Promise<ReviewView | null> {
    const f = inFlight.get(projectId);
    if (f && f.fingerprint === fingerprint) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([f.done, new Promise<void>((r) => { timer = setTimeout(r, timeoutMs); })]);
      clearTimeout(timer);
    }
    return view(projectId, fingerprint);
  }

  return {
    async start(projectId, locale) {
      const r = await startRecord(projectId, locale);
      return r ? viewOf(r) : null;
    },
    view,
    wait,
    async gate({ projectId, accept, actorId, locale }) {
      const r = await startRecord(projectId, locale);
      if (!r) return { kind: "open", view: null };
      const v = await viewOf(r);
      if (r.status === "running") return { kind: "pending", view: v };
      if (v.blocking.length === 0) return { kind: "open", view: v };
      if (accept && accept === v.fingerprint) {
        await deps.store.accept(projectId, v.fingerprint, actorId, v.blocking, deps.now());
        return { kind: "open", view: await viewOf(r) };
      }
      return { kind: "blocked", view: v };
    },
    async forAgent(projectId, locale, waitMs = AGENT_WAIT_MS) {
      const r = await startRecord(projectId, locale);
      if (!r) return null;
      const v = r.status === "running" ? await wait(projectId, r.fingerprint, waitMs) : await viewOf(r);
      if (!v) return null;
      const firstTimeForAgent = v.status !== "running" && v.blocking.length > 0 ? await deps.store.claimShownToAgent(projectId, v.fingerprint, deps.now()) : false;
      return { view: v, firstTimeForAgent };
    },
  };
}
