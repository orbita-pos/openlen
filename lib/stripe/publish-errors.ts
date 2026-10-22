// lib/stripe/publish-errors.ts — WHY STRIPE STOPS A PUBLISH (spec local
// 2026-10-21-stripe-integration, §6.4) and how the publish route answers it. A
// missing live key is not here: it is the functions' 428 (`secrets_required`),
// so the same card asks for it.

import { FunctionsNeedOwnerError } from "@/lib/functions/publish-errors";

/** The live key and the draft's are from different Stripe accounts: nothing is published. */
export class StripeAccountMismatchError extends Error {
  constructor() {
    super("the production Stripe key belongs to another account than the draft's");
    this.name = "StripeAccountMismatchError";
  }
}

/** A system republish would have to create something in live mode: the owner publishes it.
 *  A FunctionsNeedOwnerError, so the republishers skip it the same way. */
export class StripeNeedsOwnerError extends FunctionsNeedOwnerError {
  constructor() {
    super();
    this.message = "Stripe's live mode would change: the owner publishes it";
    this.name = "StripeNeedsOwnerError";
  }
}

/** Copying to live mode failed: the release isn't switched; what was copied stays as twins. */
export class StripeSyncFailedError extends Error {
  constructor(
    readonly reason: unknown,
    readonly requestId: string | null,
  ) {
    super(`copying to Stripe's live mode failed: ${reason instanceof Error ? reason.message : String(reason)}`);
    this.name = "StripeSyncFailedError";
  }
}

export function stripePublishErrorBody(err: unknown): { status: number; body: Record<string, unknown> } | null {
  if (err instanceof StripeAccountMismatchError) return { status: 422, body: { error: "stripe_account_mismatch" } };
  if (err instanceof StripeSyncFailedError) {
    return { status: 502, body: { error: "stripe_sync_failed", message: err.reason instanceof Error ? err.reason.message : String(err.reason), ...(err.requestId ? { requestId: err.requestId } : {}) } };
  }
  return null;
}
