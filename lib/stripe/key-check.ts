// lib/stripe/key-check.ts — IS THIS STRIPE KEY GOOD FOR THIS ENVIRONMENT?
// (spec local 2026-10-21-stripe-integration, §6.1). The shape first, without the
// network: the draft only takes test keys (the canvas never charges real
// cards), the published site only live ones, and a publishable key or a
// webhook secret is not what goes here. Then ONE read of the account: a 401
// rejects the key; a 403 is a restricted key without that permission, which
// is still a good key (and Stripe's message names the account); a network
// failure or a 5xx leaves it unverified, saved, to be checked again later.

import { stripeRequest, type StripeEnv, type StripeFetch } from "./api";

export type StripeKeyKind = "sk" | "rk";
export type StripeKeyProblem =
  | "publishable_key"
  | "webhook_secret"
  | "not_a_stripe_key"
  | "live_in_draft"
  | "test_in_live"
  | "rejected_by_stripe"
  | "other_account";

export interface StripeAccountInfo {
  readonly accountId: string;
  readonly accountName: string | null;
  readonly keyKind: StripeKeyKind;
  readonly livemode: boolean;
  readonly chargesEnabled: boolean | null;
}

export type StripeKeyCheck =
  | { readonly ok: true; readonly account: StripeAccountInfo }
  | { readonly ok: false; readonly problem: StripeKeyProblem }
  | { readonly ok: "unverified"; readonly keyKind: StripeKeyKind; readonly livemode: boolean };

/** When a 403 doesn't say which account the key belongs to. */
export const UNKNOWN_ACCOUNT = "unknown";

const KEY = /^(sk|rk|pk)_(test|live)_[A-Za-z0-9]+$/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9]+$/;
const ACCOUNT_IN_MESSAGE = /on account '(acct_[A-Za-z0-9]+)'/;

export function stripeKeyShape(value: string): { readonly kind: "sk" | "rk" | "pk" | "whsec" | null; readonly livemode: boolean | null } {
  const v = value.trim();
  if (WEBHOOK_SECRET.test(v)) return { kind: "whsec", livemode: null };
  const m = KEY.exec(v);
  if (!m) return { kind: null, livemode: null };
  return { kind: m[1] as "sk" | "rk" | "pk", livemode: m[2] === "live" };
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function checkStripeKey(value: string, environment: StripeEnv, f?: StripeFetch): Promise<StripeKeyCheck> {
  const key = value.trim();
  const shape = stripeKeyShape(key);
  if (shape.kind === "pk") return { ok: false, problem: "publishable_key" };
  if (shape.kind === "whsec") return { ok: false, problem: "webhook_secret" };
  if (shape.kind === null || shape.livemode === null) return { ok: false, problem: "not_a_stripe_key" };
  if (shape.livemode && environment === "draft") return { ok: false, problem: "live_in_draft" };
  if (!shape.livemode && environment === "live") return { ok: false, problem: "test_in_live" };
  const keyKind = shape.kind;
  const livemode = shape.livemode;

  let r;
  try {
    r = await stripeRequest(key, { method: "GET", path: "/v1/account" }, f);
  } catch {
    return { ok: "unverified", keyKind, livemode };
  }
  if (r.status === 401) return { ok: false, problem: "rejected_by_stripe" };
  if (r.status === 403) {
    const message = text((r.json as { error?: { message?: unknown } } | null)?.error?.message) ?? "";
    const accountId = ACCOUNT_IN_MESSAGE.exec(message)?.[1] ?? UNKNOWN_ACCOUNT;
    return { ok: true, account: { accountId, accountName: null, keyKind, livemode, chargesEnabled: null } };
  }
  if (r.status < 200 || r.status >= 300) return { ok: "unverified", keyKind, livemode };
  const a = (r.json ?? {}) as {
    id?: unknown;
    charges_enabled?: unknown;
    settings?: { dashboard?: { display_name?: unknown } };
    business_profile?: { name?: unknown };
  };
  const accountId = text(a.id);
  if (!accountId) return { ok: "unverified", keyKind, livemode };
  return {
    ok: true,
    account: {
      accountId,
      accountName: text(a.settings?.dashboard?.display_name) ?? text(a.business_profile?.name),
      keyKind,
      livemode,
      chargesEnabled: typeof a.charges_enabled === "boolean" ? a.charges_enabled : null,
    },
  };
}
