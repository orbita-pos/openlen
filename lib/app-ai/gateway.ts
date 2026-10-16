// lib/app-ai/gateway.ts — THE AI GATEWAY OF THE APPS (spec local
// docs/superpowers/specs/2026-10-15-app-ai-design.md). A request to
// `<project URL>/ai/v1/…`:
//   1. on, a known endpoint, and the project out of the host (`resolve`);
//   2. the project's SECRET key and nothing else: the gateway is server-only;
//   3. GET /models lists the two aliases; POST /chat/completions goes on;
//   4. the body, strictly validated (`parseChatRequest`);
//   5. ADMIT before calling, undoing what came before on a refusal: the plan's
//      requests per minute and calls at once, the account's monthly cap (with
//      what is in flight), the free plan's daily pool, and the worst case
//      taken from the owner's credits;
//   6. call the model streaming, and answer in OpenAI's shape (JSON or SSE);
//   7. SETTLE exactly once: charge the real usage (or what was streamed when it
//      never came), give back the rest, add to the month, release, and alert.
// No database or provider here: everything comes in through `AppAiDeps`.

import type { FireworksStreamEvent } from "@/lib/ai/fireworks-stream-client";
import { hashSecretKey } from "@/lib/backend/keys";
import type { LedgerEntry } from "@/lib/credit-ledger";
import type { CreditRate } from "@/lib/credits";
import { modelIdForRole, roleForOperation } from "@/lib/generation/model-policy";
import type { ConcurrencyLimiter } from "@/lib/functions/concurrency";
import { monthKey } from "@/lib/functions/meter";
import type { WindowLimiter } from "@/lib/functions/window-limiter";
import type { Plan } from "@/lib/plan";

import { actualCenticredits, estimateTokens, streamedCenticredits, worstCaseCenticredits, type Usage } from "./billing";
import type { CapReservations } from "./cap";
import { appAiError } from "./errors";
import type { FreeDailyPool } from "./free-pool";
import { APP_AI_LIMITS, MAX_BODY_BYTES, monthlyCap } from "./limits";
import { APP_AI_MODELS, type AppAiModelSpec } from "./models";
import { completion, completionId, DONE, errorEvent, finishChunk, finishReasonOf, firstChunk, modelList, textChunk, usageChunk, wireUsage, type WireHead } from "./openai-wire";
import { parseChatRequest, type ParsedChatRequest } from "./request";
import type { AppAiEnvironment, AppAiStore } from "./store";

export interface ResolvedProject {
  readonly projectId: string;
  readonly environment: AppAiEnvironment;
  readonly secretKeyHash: string;
}

export interface Wallet {
  /** The owner's plan and monthly allotment, after the lazy refill. */
  state(userId: string): Promise<{ readonly plan: Plan; readonly allotment: number }>;
  /** Takes the amount only if the balance covers it. Each movement carries its
   *  spend-ledger row (lib/credit-ledger.ts). */
  debitIfEnough(userId: string, centicredits: number, entry: LedgerEntry): Promise<boolean>;
  /** Takes an overrun, clamped at zero. */
  debit(userId: string, centicredits: number, entry: LedgerEntry): Promise<unknown>;
  refund(userId: string, centicredits: number, entry: LedgerEntry): Promise<void>;
  /** A ledger row that moves nothing: the settlement when the call cost exactly
   *  what was reserved, so its tokens and cost are still on record. */
  record(userId: string, entry: LedgerEntry): Promise<void>;
}

export interface UpstreamCall {
  readonly request: ParsedChatRequest;
  readonly requestId: string;
  readonly signal: AbortSignal;
}

export interface CapAlertInput {
  readonly userId: string;
  readonly projectId: string;
  readonly month: string;
  readonly percent: 80 | 100;
  readonly spent: number;
  readonly cap: number;
}

export interface AppAiAlerts {
  cap(a: CapAlertInput): void;
  freePool(a: { readonly day: string; readonly spent: number; readonly cap: number }): void;
}

export interface AppAiDeps {
  enabled(): boolean;
  resolve(req: Request): Promise<ResolvedProject | null>;
  blocked(projectId: string): Promise<boolean>;
  ownerOf(projectId: string): Promise<string | null>;
  readonly wallet: Wallet;
  readonly store: AppAiStore;
  readonly reservations: CapReservations;
  readonly concurrency: ConcurrencyLimiter;
  readonly rate: WindowLimiter;
  readonly freePool: FreeDailyPool;
  upstream(call: UpstreamCall): AsyncIterable<FireworksStreamEvent>;
  rateFor(model: AppAiModelSpec): CreditRate;
  readonly alerts: AppAiAlerts;
  now(): Date;
}

const MINUTE_MS = 60_000;
const CAP_ALERT_SHARE = 0.8;

function keyOf(req: Request): string | null {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization")?.trim() ?? "")?.[1]?.trim();
  return bearer || req.headers.get("apikey")?.trim() || null;
}

async function claimAndAlert(deps: AppAiDeps, a: CapAlertInput): Promise<void> {
  try {
    if (await deps.store.claimCapAlert(a.userId, a.month, a.percent)) deps.alerts.cap(a);
  } catch (e) {
    console.error("[app-ai] the cap alert could not be claimed", a.userId, e);
  }
}

export async function handleAppAiRequest(req: Request, deps: AppAiDeps): Promise<Response> {
  if (!deps.enabled()) return appAiError("app_ai_disabled");
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const isModels = path === "/ai/v1/models" && req.method === "GET";
  const isChat = path === "/ai/v1/chat/completions" && req.method === "POST";
  if (!isModels && !isChat) return appAiError("unknown_endpoint");

  const project = await deps.resolve(req);
  if (!project) return appAiError("project_not_found");
  const key = keyOf(req);
  if (!key || !key.startsWith("sb_secret_") || hashSecretKey(key) !== project.secretKeyHash) return appAiError("invalid_api_key");
  if (await deps.blocked(project.projectId)) return appAiError("app_ai_disabled", { message: "AI is turned off for this project" });
  if (isModels) return Response.json(modelList(APP_AI_MODELS));

  const body = Buffer.from(await req.arrayBuffer());
  if (body.length > MAX_BODY_BYTES) return appAiError("invalid_request", { message: "The request body is larger than 1 MB" });
  const parsed = parseChatRequest(body.toString("utf8"));
  if (!parsed.ok) return appAiError(parsed.code, { message: parsed.message, param: parsed.param });
  const request = parsed.request;

  const ownerId = await deps.ownerOf(project.projectId);
  if (!ownerId) return appAiError("project_not_found");
  const { plan, allotment } = await deps.wallet.state(ownerId);
  const limits = APP_AI_LIMITS[plan];

  const slotKey = `ai|${project.projectId}`;
  const wait = deps.rate.hit(slotKey, [{ windowMs: MINUTE_MS, max: limits.requestsPerMinute }]);
  if (wait > 0) return appAiError("rate_limit_exceeded", { retryAfterSec: wait / 1000 });
  const releaseSlot = deps.concurrency.tryAcquire(slotKey, limits.concurrent);
  if (!releaseSlot) return appAiError("rate_limit_exceeded", { message: "Too many AI requests at once for this project", retryAfterSec: 1 });

  // From here on the slot is released exactly once: by a refusal below, or by `settle`.
  let settleOwnsSlot = false;
  try {
    const rate = deps.rateFor(request.model);
    const worst = worstCaseCenticredits({ inputBytes: body.length, maxTokens: request.maxTokens, rate });
    const month = monthKey(deps.now());
    const cap = monthlyCap(await deps.store.explicitCap(ownerId), allotment);
    const spent = await deps.store.monthSpent(ownerId, month);
    const releaseCap = deps.reservations.tryReserve(ownerId, spent, worst, cap);
    if (!releaseCap) {
      if (cap > 0) void claimAndAlert(deps, { userId: ownerId, projectId: project.projectId, month, percent: 100, spent, cap });
      return appAiError("app_ai_cap_reached");
    }
    const free = plan === "free";
    if (free && !deps.freePool.tryReserve(worst)) {
      releaseCap();
      return appAiError("app_ai_busy");
    }
    // The id is minted before the reservation so the reservation and its
    // settlement share one `refId` in the spend ledger.
    const requestId = completionId();
    const ledgerBase = { surface: "app_ai" as const, projectId: project.projectId, refId: requestId };
    if (!(await deps.wallet.debitIfEnough(ownerId, worst, { ...ledgerBase, outcome: "reserve", listCenticredits: worst }))) {
      releaseCap();
      if (free) deps.freePool.settle(worst, 0);
      return appAiError("insufficient_credits");
    }

    let settled = false;
    const settle = async (o: { readonly usage: Usage | null; readonly streamedChars: number }): Promise<void> => {
      if (settled) return;
      settled = true;
      try {
        const actual = o.usage
          ? actualCenticredits(o.usage, rate)
          : o.streamedChars > 0
            ? streamedCenticredits({ inputBytes: body.length, outputChars: o.streamedChars, rate })
            : 0;
        const settlement: LedgerEntry = {
          ...ledgerBase,
          outcome: "settle",
          listCenticredits: actual,
          uses: o.usage
            ? [
                {
                  provider: "fireworks",
                  model: modelIdForRole(roleForOperation(request.model.operation)),
                  inputTokens: o.usage.inputTokens,
                  cachedTokens: o.usage.cachedTokens,
                  outputTokens: o.usage.outputTokens,
                  at: deps.now(),
                },
              ]
            : [],
        };
        if (actual > worst) await deps.wallet.debit(ownerId, actual - worst, settlement);
        else if (actual < worst) await deps.wallet.refund(ownerId, worst - actual, settlement);
        else await deps.wallet.record(ownerId, settlement);
        // Added to the month BEFORE the reservation is released: a check in
        // between counts it twice (safe), never zero times.
        if (actual > 0) await deps.store.add({ userId: ownerId, month, projectId: project.projectId, environment: project.environment, centicredits: actual });
        if (free && deps.freePool.settle(worst, actual)) deps.alerts.freePool({ day: deps.freePool.day, spent: deps.freePool.spent, cap: deps.freePool.cap });
        if (actual > 0 && cap > 0) {
          const after = await deps.store.monthSpent(ownerId, month);
          const percent = after >= cap ? 100 : after >= cap * CAP_ALERT_SHARE ? 80 : null;
          if (percent) await claimAndAlert(deps, { userId: ownerId, projectId: project.projectId, month, percent, spent: after, cap });
        }
      } catch (e) {
        console.error("[app-ai] settling failed", project.projectId, e);
      } finally {
        releaseCap();
        releaseSlot();
      }
    };
    settleOwnsSlot = true;

    const controller = new AbortController();
    req.signal.addEventListener("abort", () => controller.abort(), { once: true });
    const head: WireHead = { id: requestId, created: Math.floor(deps.now().getTime() / 1000), model: request.model.id };
    const events = deps.upstream({ request, requestId, signal: controller.signal })[Symbol.asyncIterator]();
    const next = async (): Promise<FireworksStreamEvent | null> => {
      try {
        const r = await events.next();
        return r.done ? null : r.value;
      } catch (e) {
        return { type: "done", stopReason: { kind: "error", error: e instanceof Error ? e.message : String(e) } };
      }
    };
    const usageOf = (ev: Extract<FireworksStreamEvent, { type: "usage" }>): Usage => ({ inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, cachedTokens: ev.cachedTokens });
    const estimatedUsage = (chars: number) => ({ inputTokens: estimateTokens(body.length), outputTokens: estimateTokens(chars) });

    if (!request.stream) {
      let text = "";
      let usage: Usage | null = null;
      let finish: ReturnType<typeof finishReasonOf> = null;
      for (let ev = await next(); ev; ev = await next()) {
        if (ev.type === "text_delta") text += ev.text;
        else if (ev.type === "usage") usage = usageOf(ev);
        else if (ev.type === "done") {
          finish = finishReasonOf(ev.stopReason);
          break;
        }
      }
      if (!finish) {
        // Nothing delivered, nothing charged (plan 2026-10-15, deviation 5).
        await settle({ usage: null, streamedChars: 0 });
        return appAiError("upstream_error");
      }
      await settle({ usage, streamedChars: text.length });
      return Response.json(completion({ ...head, content: text, finishReason: finish, usage: wireUsage(usage ?? estimatedUsage(text.length)) }));
    }

    const first = await next();
    if (!first || (first.type === "done" && !finishReasonOf(first.stopReason))) {
      await settle({ usage: null, streamedChars: 0 });
      return appAiError("upstream_error");
    }
    const encoder = new TextEncoder();
    let pending: FireworksStreamEvent | null = first;
    let streamedChars = 0;
    let usage: Usage | null = null;
    /** The client cut: a `pull` still waiting on the model must not write to a cancelled stream. */
    let cut = false;
    const put = (c: ReadableStreamDefaultController<Uint8Array>, s: string): void => {
      try {
        c.enqueue(encoder.encode(s));
      } catch {
        /* the client cut */
      }
    };
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        put(c, firstChunk(head));
      },
      async pull(c) {
        for (;;) {
          const ev = pending ?? (await next());
          pending = null;
          if (cut) return;
          if (!ev || ev.type === "done") {
            const finish = ev ? finishReasonOf(ev.stopReason) : null;
            if (finish) {
              put(c, finishChunk(head, finish));
              if (request.includeUsage) put(c, usageChunk(head, wireUsage(usage ?? estimatedUsage(streamedChars))));
            } else {
              put(c, errorEvent("upstream_error", "The model stopped before finishing"));
            }
            put(c, DONE);
            try {
              c.close();
            } catch {
              /* the client cut */
            }
            await settle({ usage, streamedChars });
            return;
          }
          if (ev.type === "text_delta") {
            streamedChars += ev.text.length;
            put(c, textChunk(head, ev.text));
            return;
          }
          if (ev.type === "usage") usage = usageOf(ev);
          // Thinking and anything else stays inside: v1 returns text only.
        }
      },
      async cancel() {
        cut = true;
        controller.abort();
        await settle({ usage, streamedChars });
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", "x-accel-buffering": "no" },
    });
  } finally {
    if (!settleOwnsSlot) releaseSlot();
  }
}
