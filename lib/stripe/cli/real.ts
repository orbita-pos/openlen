// lib/stripe/cli/real.ts — THE `stripe` COMMAND WITH WHAT IS REAL (spec local
// 2026-10-21-stripe-integration, §6.2 and §6.3): the project's
// STRIPE_SECRET_KEY of each environment (encrypted in `functionSecrets`), the
// Stripe objects it records, a new endpoint's `whsec_` saved as a draft secret
// through the secrets door, and every output masked with the secrets of BOTH
// environments. `stripeCliDepsFor` takes what it needs, for tests;
// `runStripeCliFor` is what the terminals call.

import type { FunctionsEnvironment } from "@/lib/functions/engines/types";
import { maskSecrets } from "@/lib/functions/mask";
import type { SecretStore } from "@/lib/functions/secret-store";

import { stripeRequest, type StripeFetch } from "../api";
import type { StripeStore } from "../store";
import { runStripeCli, type StripeCliDeps, type StripeCliOptions, type StripeCliOutput } from "./run";
import { runTrigger } from "./trigger";

export const WEBHOOK_SECRET = "STRIPE_WEBHOOK_SECRET";

export interface RealStripeCliDeps {
  readonly secrets: Pick<SecretStore, "values">;
  readonly store: StripeStore;
  /** Through `setFunctionSecrets`, so it counts in the 128 variables and reaches the engine. */
  saveSecret(projectId: string, env: FunctionsEnvironment, name: string, value: string): Promise<void>;
  draftFunctionsUrl(projectId: string): Promise<string | null>;
  readonly f?: StripeFetch;
}

const functionPart = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export async function stripeCliDepsFor(projectId: string, d: RealStripeCliDeps): Promise<StripeCliDeps> {
  const draftFunctionsUrl = await d.draftFunctionsUrl(projectId);
  const functionOf = (url: string) => (draftFunctionsUrl && url.startsWith(draftFunctionsUrl) ? url.slice(draftFunctionsUrl.length).split(/[/?#]/)[0] || null : null);
  return {
    keyFor: async (env) => (await d.secrets.values(projectId, env)).STRIPE_SECRET_KEY ?? null,
    request: (key, req) => stripeRequest(key, req, d.f),
    record: (obj) => d.store.recordTestObject({ projectId, source: "cli", ...obj }),
    async saveWebhookSecret(endpoint) {
      const taken = new Set(Object.keys(await d.secrets.values(projectId, "draft")));
      const fn = functionOf(endpoint.url);
      let name = WEBHOOK_SECRET;
      if (taken.has(name)) {
        name = fn ? `${WEBHOOK_SECRET}_${functionPart(fn)}` : `${WEBHOOK_SECRET}_2`;
        for (let n = 2; taken.has(name); n++) name = `${WEBHOOK_SECRET}_${fn ? `${functionPart(fn)}_` : ""}${n}`;
      }
      await d.saveSecret(projectId, "draft", name, endpoint.secret);
      await d.store.recordTestObject({ projectId, kind: "webhook_endpoint", testId: endpoint.id, source: "cli", secretName: name });
      return name;
    },
    async mask(text) {
      const [draft, live] = await Promise.all([d.secrets.values(projectId, "draft"), d.secrets.values(projectId, "live")]);
      return maskSecrets(maskSecrets(text, draft), live);
    },
    draftFunctionsUrl,
    trigger: (event, key) => runTrigger(event, key, (k, req) => stripeRequest(k, req, d.f)),
  };
}

/** What Len's two terminals call: the real stores, the draft's function URL, the secrets door. */
export async function runStripeCliFor(projectId: string, args: readonly string[], o: StripeCliOptions = {}): Promise<StripeCliOutput> {
  const [{ pgSecretStore }, { pgStripeStore }, { realSecretsDeps }, { setFunctionSecrets }, { draftProjectUrl, ensureBackend }] = await Promise.all([
    import("@/lib/functions/secret-store-pg"),
    import("../store-pg"),
    import("@/lib/functions/secrets-real"),
    import("@/lib/functions/secrets-core"),
    import("@/lib/backend/registry"),
  ]);
  const deps = await stripeCliDepsFor(projectId, {
    secrets: pgSecretStore,
    store: pgStripeStore,
    async saveSecret(p, env, name, value) {
      const secretsDeps = realSecretsDeps();
      if (!secretsDeps) throw new Error("the Edge Functions are off on this server");
      const r = await setFunctionSecrets(p, [{ environment: env, name, value }], null, secretsDeps);
      if (!r.ok) throw new Error(r.message);
    },
    draftFunctionsUrl: async (p) => `${await draftProjectUrl(await ensureBackend(p))}/functions/v1/`,
  });
  return runStripeCli(args, deps, o);
}
