/**
 * WHO SERVES LEN'S TURNS (spec local docs/superpowers/specs/2026-10-16-second-provider-design.md).
 *
 * The same model (DeepSeek V4.1 Flash) from two providers: DeepInfra first,
 * Fireworks as the fallback. `OPENLEN_AGENT_PROVIDERS` (comma-separated, in
 * order) says which are on; without it, `deepinfra,fireworks` — the code ships
 * switched ON (Jesús, 2026-10-16). `fireworks` turns DeepInfra off without a
 * deploy. A provider without its key is skipped, so a box without
 * `DEEPINFRA_API_KEY` keeps running on Fireworks alone.
 *
 * Both speak OpenAI's chat format; what differs lives in the dialect. The
 * per-provider model ids live in the policy table (`MODEL_POLICY.agent.providers`).
 */
import { MODEL_POLICY } from "@/lib/generation/model-policy";

export type ProviderId = "fireworks" | "deepinfra";

export interface ProviderDialect {
  readonly id: ProviderId;
  readonly endpoint: string;
  readonly apiKeyEnv: "FIREWORKS_API_KEY" | "DEEPINFRA_API_KEY";
  /** The request field that keeps a conversation on a warm prompt cache. */
  readonly affinityField: "user" | "prompt_cache_key";
}

export const PROVIDER_DIALECTS: Readonly<Record<ProviderId, ProviderDialect>> = Object.freeze({
  fireworks: Object.freeze({
    id: "fireworks",
    endpoint: "https://api.fireworks.ai/inference/v1/chat/completions",
    apiKeyEnv: "FIREWORKS_API_KEY",
    affinityField: "user",
  }),
  deepinfra: Object.freeze({
    id: "deepinfra",
    endpoint: "https://api.deepinfra.com/v1/openai/chat/completions",
    apiKeyEnv: "DEEPINFRA_API_KEY",
    // docs.deepinfra.com/chat/prompt-caching, read 2026-10-16: requests with the
    // same `prompt_cache_key` and model share a KV cache.
    affinityField: "prompt_cache_key",
  }),
});

export const DEFAULT_AGENT_PROVIDERS = "deepinfra,fireworks";

export interface ResolvedProvider {
  readonly id: ProviderId;
  readonly modelId: string;
  readonly apiKey: string;
  readonly dialect: ProviderDialect;
}

const warned = new Set<string>();

function warnOnce(key: string, line: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(line);
}

/** Only for tests: the warnings are module state. */
export function _resetProviderWarnings(): void {
  warned.clear();
}

/** The agent's providers that are on and have a key, in order. `only` narrows
 *  the list (the security review stays on Fireworks) without reordering it. */
export function resolveAgentProviders(
  env: Readonly<Record<string, string | undefined>>,
  only?: readonly ProviderId[],
): ResolvedProvider[] {
  const models = new Map(MODEL_POLICY.agent.providers.map((p) => [p.provider, p.modelId] as const));
  const names = (env.OPENLEN_AGENT_PROVIDERS?.trim() || DEFAULT_AGENT_PROVIDERS).split(",").map((n) => n.trim()).filter(Boolean);
  const out: ResolvedProvider[] = [];
  for (const name of names) {
    const id = name as ProviderId;
    const modelId = models.get(id);
    if (!modelId || !(id in PROVIDER_DIALECTS)) {
      warnOnce(`unknown:${name}`, `[agent] OPENLEN_AGENT_PROVIDERS: «${name}» is not a provider of Len, ignored`);
      continue;
    }
    if (only && !only.includes(id)) continue;
    if (out.some((p) => p.id === id)) continue;
    const dialect = PROVIDER_DIALECTS[id];
    const apiKey = env[dialect.apiKeyEnv]?.trim();
    if (!apiKey) {
      warnOnce(`nokey:${id}`, `[agent] ${id} sin clave (${dialect.apiKeyEnv}): se salta`);
      continue;
    }
    out.push({ id, modelId, apiKey, dialect });
  }
  return out;
}
