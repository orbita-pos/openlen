// lib/app-ai/serve.ts — THE AI GATEWAY WITH THE REAL THINGS (spec local
// 2026-10-15): the host → the backend (registry; the draft's own ref makes it
// the draft), the owner and their credits, the month in Postgres, Fireworks
// through the same streaming client Len uses, and the alerts (which neither
// wait nor throw).

import "server-only";

import { createFireworksStreamClient } from "@/lib/ai/fireworks-stream-client";
import { backendForHost } from "@/lib/backend/registry";
import { chargeCredits, chargeCreditsIfEnough, getCreditState, recordUncharged, returnCredits } from "@/lib/credits";
import { functionsBlocked } from "@/lib/functions/blocks-pg";
import { ConcurrencyLimiter } from "@/lib/functions/concurrency";
import { ownerOf as projectOwner } from "@/lib/functions/deploy";
import { WindowLimiter } from "@/lib/functions/window-limiter";
import { creditRateForRole, roleForOperation } from "@/lib/generation/model-policy";

import { CapReservations } from "./cap";
import { freePoolAlertEmail } from "./cap-messages";
import { appAiEnabledIn } from "./enabled";
import { FreeDailyPool } from "./free-pool";
import { handleAppAiRequest, type AppAiDeps } from "./gateway";
import { freeDailyCapCenticredits } from "./limits";
import { pgAppAiStore } from "./store-pg";

/** One process, one box: what is in flight lives here. */
const reservations = new CapReservations();
const concurrency = new ConcurrencyLimiter();
const rate = new WindowLimiter();
const freePool = new FreeDailyPool(freeDailyCapCenticredits());
const fireworks = createFireworksStreamClient();

function realDeps(): AppAiDeps {
  return {
    enabled: () => appAiEnabledIn(),
    async resolve(req) {
      const host = (req.headers.get("host") ?? new URL(req.url).host).toLowerCase().replace(/:\d+$/, "");
      const hb = await backendForHost(host);
      if (!hb) return null;
      return { projectId: hb.record.projectId, environment: hb.environment ?? "live", secretKeyHash: hb.record.secretKeyHash };
    },
    blocked: functionsBlocked,
    async ownerOf(projectId) {
      return (await projectOwner(projectId))?.userId ?? null;
    },
    wallet: {
      async state(userId) {
        const s = await getCreditState(userId);
        return { plan: s.plan, allotment: s.allotment };
      },
      debitIfEnough: chargeCreditsIfEnough,
      debit: chargeCredits,
      refund: returnCredits,
      record: recordUncharged,
    },
    store: pgAppAiStore,
    reservations,
    concurrency,
    rate,
    freePool,
    upstream: ({ request, requestId, signal }) =>
      fireworks.stream(
        {
          messages: request.messages,
          maxOutputTokens: request.maxTokens,
          temperature: request.temperature,
          requestId,
          operation: request.model.operation,
          jsonObject: request.jsonObject,
        },
        { signal },
      ),
    rateFor: (model) => creditRateForRole(roleForOperation(model.operation)),
    alerts: {
      cap(a) {
        void (async () => {
          const { scheduleNotification } = await import("@/lib/notifications/dispatch");
          await scheduleNotification(
            { type: "app_ai_cap", projectId: a.projectId, recipientUserId: a.userId, percent: a.percent, spent: a.spent, cap: a.cap },
            `app_ai_cap:${a.userId}:${a.month}:${a.percent}`,
          );
        })().catch((e: unknown) => console.error("[app-ai] the cap alert did not go out", a.userId, e));
      },
      freePool(a) {
        void (async () => {
          const { sendFunctionsPoolAlertEmail } = await import("@/lib/email");
          await sendFunctionsPoolAlertEmail(freePoolAlertEmail(a));
        })().catch((e: unknown) => console.error("[app-ai] the free pool alert did not go out", a.day, e));
      },
    },
    now: () => new Date(),
  };
}

export function serveAppAi(req: Request): Promise<Response> {
  return handleAppAiRequest(req, realDeps());
}
