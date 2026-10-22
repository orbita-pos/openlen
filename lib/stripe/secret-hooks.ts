// lib/stripe/secret-hooks.ts — STRIPE AT THE SECRETS DOOR (spec local
// 2026-10-21-stripe-integration, §6.1 and §6.7). Whatever writes
// STRIPE_SECRET_KEY —Len's card, the Secrets tab, `supabase secrets set`, the
// keys missing at publish— goes through `setFunctionSecrets`, and this hook
// checks the key there: a test key for the draft, a live one for the published
// site, accepted by Stripe, and both from the same account. Removing the key
// also removes the webhook endpoints registered with it and their secrets.

import type { SecretEntry, SecretsHook, SecretsHookPrepared } from "@/lib/functions/secrets-core";

import type { StripeEnv } from "./api";
import { UNKNOWN_ACCOUNT, type StripeKeyCheck, type StripeKeyProblem } from "./key-check";
import type { StripeStore } from "./store";

export const STRIPE_SECRET_KEY = "STRIPE_SECRET_KEY";

export interface StripeHookDeps {
  readonly store: StripeStore;
  readonly check: (value: string, env: StripeEnv) => Promise<StripeKeyCheck>;
  /** Deletes in Stripe the endpoints of that environment; returns their secrets' names. */
  deleteEndpoints(projectId: string, env: StripeEnv): Promise<readonly string[]>;
}

const ENV_WORDS: Readonly<Record<StripeEnv, string>> = { draft: "the draft", live: "the published site" };
const other = (env: StripeEnv): StripeEnv => (env === "draft" ? "live" : "draft");

/** What Len reads when a key is refused (the card shows its own, translated). */
export function stripeKeyMessage(problem: StripeKeyProblem, env: StripeEnv): string {
  switch (problem) {
    case "publishable_key":
      return "STRIPE_SECRET_KEY needs the secret key (sk_…) or a restricted key (rk_…), not the publishable key (pk_…).";
    case "webhook_secret":
      return "That is a webhook signing secret (whsec_…): it goes in STRIPE_WEBHOOK_SECRET, not in STRIPE_SECRET_KEY.";
    case "not_a_stripe_key":
      return "That doesn't look like a Stripe key: STRIPE_SECRET_KEY takes sk_… or rk_….";
    case "live_in_draft":
      return "STRIPE_SECRET_KEY for the draft must be a test key (sk_test_… or rk_test_…): the canvas never charges real cards.";
    case "test_in_live":
      return "STRIPE_SECRET_KEY for the published site must be a live key (sk_live_… or rk_live_…).";
    case "rejected_by_stripe":
      return "Stripe rejected this key: check that it was copied whole and that it hasn't been revoked.";
    case "other_account":
      return `This key belongs to another Stripe account than the one already saved for ${ENV_WORDS[other(env)]}: both must be from the same account.`;
  }
}

const sameAccount = (a: string | undefined, b: string | undefined) => !a || !b || a === UNKNOWN_ACCOUNT || b === UNKNOWN_ACCOUNT || a === b;

export function stripeSecretHook(d: StripeHookDeps): SecretsHook {
  return {
    async prepare(projectId: string, entries: readonly SecretEntry[]): Promise<SecretsHookPrepared> {
      const keys = entries.filter((e) => e.name === STRIPE_SECRET_KEY);
      if (keys.length === 0) return {};
      const checked = new Map<StripeEnv, StripeKeyCheck>();
      for (const e of keys) {
        const c = await d.check(e.value, e.environment);
        if (c.ok === false) {
          return { rejection: { environment: e.environment, name: e.name, reason: c.problem, message: stripeKeyMessage(c.problem, e.environment) } };
        }
        checked.set(e.environment, c);
      }
      for (const [env, c] of checked) {
        if (c.ok !== true) continue;
        const inBatch = checked.get(other(env));
        const otherAccount = inBatch ? (inBatch.ok === true ? inBatch.account.accountId : undefined) : (await d.store.getAccount(projectId, other(env)))?.accountId;
        if (!sameAccount(c.account.accountId, otherAccount)) {
          return { rejection: { environment: env, name: STRIPE_SECRET_KEY, reason: "other_account", message: stripeKeyMessage("other_account", env) } };
        }
      }
      const unverified = [...checked].filter(([, c]) => c.ok === "unverified").map(([environment]) => ({ environment, name: STRIPE_SECRET_KEY }));
      return {
        commit: async () => {
          for (const [env, c] of checked) {
            if (c.ok === true) {
              const a = c.account;
              await d.store.putAccount({ projectId, environment: env, accountId: a.accountId, accountName: a.accountName, keyKind: a.keyKind, chargesEnabled: a.chargesEnabled });
            } else {
              // The old row belonged to the key this one replaces.
              await d.store.deleteAccount(projectId, env);
            }
          }
        },
        ...(unverified.length > 0 ? { unverified } : {}),
      };
    },
    async beforeUnset(projectId, env, names) {
      if (!names.includes(STRIPE_SECRET_KEY)) return [];
      const secrets = await d.deleteEndpoints(projectId, env).catch((err: unknown) => {
        console.warn("[stripe] could not delete the webhook endpoints", projectId, env, err);
        return [] as readonly string[];
      });
      await d.store.deleteAccount(projectId, env);
      return secrets;
    },
  };
}
