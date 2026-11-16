// lib/ai/policy-models.ts — WHAT `npm run modelos:comprobar` ASKS, AND WHERE (scripts/modelos-comprobar.ts).
//
// Until 2026-11-15 every role's `modelId` was a Fireworks model and the script only knew Fireworks. The
// Len-Bench judge (`judge`) is DeepInfra's: so the script asks EACH provider the policy names (a role's
// `providers`, or Fireworks with its `modelId`), and checks a role's price where its `creditRate` comes from.
import { MODEL_POLICY } from "@/lib/generation/model-policy";
import type { ProviderId } from "./providers";
import type { TarifaPorMillon } from "./tarifas";

export interface PolicyModel {
  readonly provider: ProviderId;
  readonly modelId: string;
  /** The roles that ask for it, named as in MODEL_POLICY. */
  readonly roles: readonly string[];
}

type PolicyEntry = { readonly modelId: string; readonly providers?: readonly { readonly provider: ProviderId; readonly modelId: string }[] };

/** Every (provider, model) the policy names, once each, with the roles that ask for it. */
export function policyModels(policy: Readonly<Record<string, PolicyEntry>> = MODEL_POLICY): PolicyModel[] {
  const byKey = new Map<string, { provider: ProviderId; modelId: string; roles: string[] }>();
  for (const [role, entry] of Object.entries(policy)) {
    const pairs = entry.providers?.length ? entry.providers : [{ provider: "fireworks" as ProviderId, modelId: entry.modelId }];
    for (const p of pairs) {
      const key = `${p.provider}/${p.modelId}`;
      const seen = byKey.get(key) ?? { provider: p.provider, modelId: p.modelId, roles: [] };
      if (!seen.roles.includes(role)) seen.roles.push(role);
      byKey.set(key, seen);
    }
  }
  return [...byKey.values()];
}

/** Whose price a role's `creditRate` declares: the provider its `modelId` belongs to (Fireworks unless its
 *  providers say otherwise). Len runs on DeepInfra first and is billed at Fireworks' price on purpose. */
export function tariffedProvider(entry: PolicyEntry): ProviderId {
  return entry.providers?.find((p) => p.modelId === entry.modelId)?.provider ?? "fireworks";
}

interface DeepinfraListModel {
  readonly model_name?: unknown;
  /** True when DeepInfra hands the model to a partner instead of serving it (as Qwen3.8-Flash and -Max, 15/11). */
  readonly is_partner?: unknown;
  readonly pricing?: { readonly cents_per_input_token?: unknown; readonly cents_per_output_token?: unknown; readonly rate_per_input_token_cached?: unknown };
}

/** Whether DeepInfra SERVES the model itself, per its public list (`is_partner: false`), or why not. A partner's
 *  model is handed on: what it reads leaves for the partner and passes its moderation — 15/11, Qwen3.8-Flash, the
 *  judge then, refused a customer's page with Alibaba Cloud's `data_inspection_failed`. */
export function deepinfraServesItself(list: unknown, modelId: string): true | string {
  if (!Array.isArray(list)) return "la respuesta de DeepInfra no es una lista de modelos";
  const m = (list as DeepinfraListModel[]).find((x) => x?.model_name === modelId);
  if (!m) return `no aparece en la lista de DeepInfra («${modelId}»)`;
  if (m.is_partner === false) return true;
  if (m.is_partner === true) return `DeepInfra no lo sirve: se lo pasa a un socio («${modelId}», is_partner)`;
  return `la lista de DeepInfra no dice quién lo sirve («${modelId}», sin is_partner)`;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The LIST price of a model in DeepInfra's public `GET https://api.deepinfra.com/models/list`, in dollars per
 *  million (the cached price is published as a share of the input's), or why it cannot be read. */
export function deepinfraListPrice(list: unknown, modelId: string): TarifaPorMillon | string {
  if (!Array.isArray(list)) return "la respuesta de DeepInfra no es una lista de modelos";
  const m = (list as DeepinfraListModel[]).find((x) => x?.model_name === modelId);
  if (!m) return `no aparece en la lista de DeepInfra («${modelId}»)`;
  const input = num(m.pricing?.cents_per_input_token);
  const output = num(m.pricing?.cents_per_output_token);
  const cachedShare = num(m.pricing?.rate_per_input_token_cached);
  if (input === null || output === null) return `sin precio por token en la lista de DeepInfra («${modelId}»)`;
  if (cachedShare === null) return `sin precio de caché en la lista de DeepInfra («${modelId}»)`;
  // cents per token → dollars per million: × 1e6 / 100.
  const perMillion = (cents: number) => cents * 1e4;
  return { input: perMillion(input), cached: perMillion(input) * cachedShare, output: perMillion(output) };
}
