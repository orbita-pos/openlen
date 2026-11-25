import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_AGENT_PROVIDERS, PROVIDER_DIALECTS, _resetProviderWarnings, resolveAgentProviders, resolveRoleProviders } from "./providers";

const BOTH = { FIREWORKS_API_KEY: "fw-key", DEEPINFRA_API_KEY: "di-key" };
const ids = (env: Record<string, string | undefined>, only?: readonly ("fireworks" | "deepinfra")[]) =>
  resolveAgentProviders(env, only).map((p) => p.id);

describe("resolveAgentProviders", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    _resetProviderWarnings();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("defaults to DeepInfra first, Fireworks as fallback", () => {
    expect(DEFAULT_AGENT_PROVIDERS).toBe("deepinfra,fireworks");
    const [deepinfra, fireworks] = resolveAgentProviders(BOTH);
    expect(deepinfra).toMatchObject({ id: "deepinfra", modelId: "deepseek-ai/DeepSeek-V4.1-Flash-1017", apiKey: "di-key", dialect: PROVIDER_DIALECTS.deepinfra });
    expect(fireworks).toMatchObject({ id: "fireworks", modelId: "accounts/fireworks/models/deepseek-v4p1-flash-1017", apiKey: "fw-key" });
    expect(PROVIDER_DIALECTS.deepinfra).toEqual({
      id: "deepinfra",
      endpoint: "https://api.deepinfra.com/v1/openai/chat/completions",
      apiKeyEnv: "DEEPINFRA_API_KEY",
      affinityField: "prompt_cache_key",
      effortStyle: "word",
    });
    expect(PROVIDER_DIALECTS.fireworks).toMatchObject({ affinityField: "user", effortStyle: "budget" });
  });

  it("OPENLEN_AGENT_PROVIDERS=fireworks turns DeepInfra off", () => {
    expect(ids({ ...BOTH, OPENLEN_AGENT_PROVIDERS: "fireworks" })).toEqual(["fireworks"]);
    expect(ids({ ...BOTH, OPENLEN_AGENT_PROVIDERS: "deepinfra" })).toEqual(["deepinfra"]);
    expect(ids({ ...BOTH, OPENLEN_AGENT_PROVIDERS: " fireworks , deepinfra " })).toEqual(["fireworks", "deepinfra"]);
  });

  it("skips a provider without its key", () => {
    expect(ids({ FIREWORKS_API_KEY: "fw-key" })).toEqual(["fireworks"]);
    expect(ids({ FIREWORKS_API_KEY: "fw-key", DEEPINFRA_API_KEY: "   " })).toEqual(["fireworks"]);
  });

  it("ignores an unknown name, with one warning", () => {
    expect(ids({ ...BOTH, OPENLEN_AGENT_PROVIDERS: "deepinfra,openrouter,fireworks" })).toEqual(["deepinfra", "fireworks"]);
    ids({ ...BOTH, OPENLEN_AGENT_PROVIDERS: "deepinfra,openrouter,fireworks" });
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("openrouter"))).toHaveLength(1);
  });

  it("only restricts and keeps the order", () => {
    expect(ids(BOTH, ["fireworks"])).toEqual(["fireworks"]);
    expect(ids({ ...BOTH, OPENLEN_AGENT_PROVIDERS: "fireworks" }, ["deepinfra"])).toEqual([]);
  });

  it("no provider with a key gives an empty list", () => {
    expect(ids({})).toEqual([]);
  });
});

describe("resolveRoleProviders — the reasoner and the vision role, like the agent", () => {
  beforeEach(() => _resetProviderWarnings());

  it.each(["reasoner", "visual_critic"] as const)("%s: DeepInfra first, Fireworks as fallback, the same 1017", (role) => {
    const [deepinfra, fireworks, ...rest] = resolveRoleProviders(role, BOTH);
    expect(rest).toEqual([]);
    expect(deepinfra).toMatchObject({ id: "deepinfra", modelId: "deepseek-ai/DeepSeek-V4.1-Flash-1017", apiKey: "di-key", dialect: PROVIDER_DIALECTS.deepinfra });
    expect(fireworks).toMatchObject({ id: "fireworks", modelId: "accounts/fireworks/models/deepseek-v4p1-flash-1017", apiKey: "fw-key" });
  });

  it("the agent's answer does not change", () => {
    expect(resolveRoleProviders("agent", BOTH)).toEqual(resolveAgentProviders(BOTH));
  });

  it("one switch for all of them: OPENLEN_AGENT_PROVIDERS=fireworks turns DeepInfra off everywhere", () => {
    const env = { ...BOTH, OPENLEN_AGENT_PROVIDERS: "fireworks" };
    for (const role of ["agent", "odyssey", "reasoner", "visual_critic"] as const) {
      expect(resolveRoleProviders(role, env).map((p) => p.id), role).toEqual(["fireworks"]);
    }
  });

  it("odyssey defaults to its own policy order (Fireworks first, DeepInfra fallback)", () => {
    const [first, second] = resolveRoleProviders("odyssey", BOTH);
    expect(first).toMatchObject({ id: "fireworks", modelId: "accounts/fireworks/models/kimi-k3p1-pro" });
    expect(second).toMatchObject({ id: "deepinfra", modelId: "moonshotai/Kimi-K3.1-Pro" });
  });
});
