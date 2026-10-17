import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_AGENT_PROVIDERS, PROVIDER_DIALECTS, _resetProviderWarnings, resolveAgentProviders } from "./providers";

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
    expect(deepinfra).toMatchObject({ id: "deepinfra", modelId: "deepseek-ai/DeepSeek-V4.1-Flash", apiKey: "di-key", dialect: PROVIDER_DIALECTS.deepinfra });
    expect(fireworks).toMatchObject({ id: "fireworks", modelId: "accounts/fireworks/models/deepseek-v4p1-flash", apiKey: "fw-key" });
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
