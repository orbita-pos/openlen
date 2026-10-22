// lib/stripe/publish.ts — STRIPE WHEN PUBLISHING (spec local
// 2026-10-21-stripe-integration, §6.4). Before anything is claimed, it reads
// what would go to live mode (the preview the card and Len see) and refuses
// what can't be published: no live key (the functions' 428), or keys of two
// accounts. Then `apply` copies to live mode and gives the test → live map the
// release is written with. A system republish never writes to Stripe: it reuses
// the twins, or leaves the project to its owner.
//
// 🔴 Planning deviation from the spec (§6.4 step 2): the copy runs BEFORE the
// release is written, not inside `beforeSwap`, because the release is
// content-addressed and written before `beforeSwap` runs. If a migration fails
// afterwards, what was copied stays as twins and is reused next time.

import { FunctionSecretsMissingError } from "@/lib/functions/publish-errors";
import type { SecretStore } from "@/lib/functions/secret-store";

import { StripeApiError, type StripeEnv, type StripeFetch } from "./api";
import { UNKNOWN_ACCOUNT, type StripeKeyCheck } from "./key-check";
import { StripeAccountMismatchError, StripeNeedsOwnerError, StripeSyncFailedError } from "./publish-errors";
import type { StripeObjectRow, StripeStore } from "./store";
import { findStripeRefs } from "./twins/discover";
import { applyTwins, planTwins, type TwinsDeps, type TwinsPlan } from "./twins/engine";
import { twinMapFrom, type TwinMap } from "./twins/swap";

export interface StripePublishPreview {
  readonly plan: TwinsPlan;
  readonly accountName: string | null;
}

export interface PreparedStripePublish {
  readonly preview: StripePublishPreview;
  /** Owner mode: creates what is missing in live. System mode: never writes. */
  apply(): Promise<TwinMap>;
}

export interface StripePublishDeps {
  readonly enabled: boolean;
  readonly store: StripeStore;
  readonly secrets: Pick<SecretStore, "values">;
  /** The draft's and the published site's function URLs, or null without a backend. */
  functionUrls(projectId: string): Promise<{ readonly draft: string; readonly live: string } | null>;
  readonly canvasHost: string | null;
  saveLiveSecret(projectId: string, name: string, value: string): Promise<void>;
  checkKey(value: string, env: StripeEnv): Promise<StripeKeyCheck>;
  readonly f?: StripeFetch;
}

async function realDeps(): Promise<StripePublishDeps> {
  const [{ stripeEnabled }, { pgStripeStore }, { pgSecretStore }, { realSecretsDeps }, { setFunctionSecrets }, registry, { lienzoBaseHost }, { checkStripeKey }] = await Promise.all([
    import("./enabled"),
    import("./store-pg"),
    import("@/lib/functions/secret-store-pg"),
    import("@/lib/functions/secrets-real"),
    import("@/lib/functions/secrets-core"),
    import("@/lib/backend/registry"),
    import("@/lib/lienzo/host"),
    import("./key-check"),
  ]);
  return {
    enabled: stripeEnabled(),
    store: pgStripeStore,
    secrets: pgSecretStore,
    async functionUrls(projectId) {
      const rec = await registry.getBackendByProject(projectId);
      if (!rec) return null;
      return { draft: `${await registry.draftProjectUrl(rec)}/functions/v1/`, live: `${registry.projectUrl(rec.ref)}/functions/v1/` };
    },
    canvasHost: lienzoBaseHost(),
    async saveLiveSecret(projectId, name, value) {
      const deps = realSecretsDeps();
      if (!deps) throw new Error("the Edge Functions are off on this server");
      const r = await setFunctionSecrets(projectId, [{ environment: "live", name, value }], null, deps);
      if (!r.ok) throw new Error(r.message);
    },
    checkKey: (value, env) => checkStripeKey(value, env),
  };
}

/** The twins already made, without calling Stripe: what a system republish compares the deployed functions with. */
export async function storedTwins(projectId: string, d?: StripePublishDeps): Promise<TwinMap> {
  const deps = d ?? (await realDeps());
  if (!deps.enabled) return new Map();
  return twinMapFrom(await deps.store.listObjects(projectId));
}

/** The account behind an environment's key: the stored row, or checked now and stored. */
async function accountOf(projectId: string, env: StripeEnv, key: string, d: StripePublishDeps): Promise<string | null> {
  const row = await d.store.getAccount(projectId, env);
  if (row) return row.accountId;
  const c = await d.checkKey(key, env);
  if (c.ok !== true) return null;
  const a = c.account;
  await d.store.putAccount({ projectId, environment: env, accountId: a.accountId, accountName: a.accountName, keyKind: a.keyKind, chargesEnabled: a.chargesEnabled });
  return a.accountId;
}

/** Without one of the keys nothing is read from Stripe, but the twins already made still go into
 *  the release: the published site keeps its live refs instead of going back to the test ones. */
function reuseTwins(rows: readonly StripeObjectRow[], refs: ReturnType<typeof findStripeRefs>): PreparedStripePublish | null {
  const twins = twinMapFrom(rows);
  if (twins.size === 0) return null;
  const swaps = [...refs.ids, ...refs.links].filter((r) => twins.has(r)).length;
  const none = { products: 0, prices: 0, paymentLinks: 0, shippingRates: 0, portalConfigurations: 0, webhookEndpoints: 0 };
  return {
    preview: { plan: { create: none, swaps, unknownRefs: [], chargesEnabled: null, needsWrites: false, droppedImages: 0 }, accountName: null },
    apply: async () => twins,
  };
}

export async function prepareStripeForPublish(
  projectId: string,
  o: { readonly mode: "owner" | "system"; readonly skipMissingSecrets: boolean; readonly texts: readonly string[]; readonly liveFunctions: readonly string[] },
  d?: StripePublishDeps,
): Promise<PreparedStripePublish | null> {
  const deps = d ?? (await realDeps());
  if (!deps.enabled) return null;
  const rows = await deps.store.listObjects(projectId);
  const refs = findStripeRefs(o.texts);
  if (rows.length === 0 && refs.ids.size === 0 && refs.links.size === 0) return null;

  const [draft, live] = await Promise.all([deps.secrets.values(projectId, "draft"), deps.secrets.values(projectId, "live")]);
  const testKey = draft.STRIPE_SECRET_KEY;
  const liveKey = live.STRIPE_SECRET_KEY;
  if (!liveKey) {
    if (o.skipMissingSecrets || o.mode === "system") return reuseTwins(rows, refs);
    throw new FunctionSecretsMissingError(["STRIPE_SECRET_KEY"]);
  }
  if (!testKey) return reuseTwins(rows, refs);
  const [draftAccount, liveAccount] = await Promise.all([accountOf(projectId, "draft", testKey, deps), accountOf(projectId, "live", liveKey, deps)]);
  if (draftAccount && liveAccount && draftAccount !== UNKNOWN_ACCOUNT && liveAccount !== UNKNOWN_ACCOUNT && draftAccount !== liveAccount) {
    throw new StripeAccountMismatchError();
  }

  const urls = await deps.functionUrls(projectId);
  const twinsDeps: TwinsDeps = {
    store: deps.store,
    testKey,
    liveKey,
    // Without a backend there are no functions: no endpoint matches.
    functionUrls: urls ?? { draft: "\u0000", live: "" },
    liveFunctions: o.liveFunctions,
    canvasHost: deps.canvasHost,
    ...(deps.f ? { f: deps.f } : {}),
  };
  const plan = await planTwins(projectId, o.texts, twinsDeps);
  const preview: StripePublishPreview = { plan, accountName: (await deps.store.getAccount(projectId, "live"))?.accountName ?? null };
  if (o.mode === "system") {
    if (plan.needsWrites) throw new StripeNeedsOwnerError();
    return { preview, apply: async () => twinMapFrom(await deps.store.listObjects(projectId)) };
  }
  return {
    preview,
    async apply() {
      try {
        return await applyTwins(projectId, o.texts, twinsDeps, (name, value) => deps.saveLiveSecret(projectId, name, value));
      } catch (e) {
        throw new StripeSyncFailedError(e, e instanceof StripeApiError ? e.requestId : null);
      }
    },
  };
}
