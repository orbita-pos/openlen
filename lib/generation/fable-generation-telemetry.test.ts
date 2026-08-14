import { afterEach, describe, expect, it, vi } from "vitest";

import { createFableGenerationTelemetry } from "./fable-generation-telemetry";

describe("Fable generation telemetry", () => {
  afterEach(() => vi.restoreAllMocks());

  it("awaits redacted paid telemetry before a failure is released", async () => {
    const sink: unknown[] = [];
    let release!: () => void;
    const written = new Promise<void>((resolve) => { release = resolve; });
    const telemetry = createFableGenerationTelemetry({ sink: async (event) => { await written; sink.push(event); } });
    telemetry.recordModel({ stage: "final_critic", modelId: "accounts/fireworks/models/qwen3p7-plus", usage: { inputTokens: 12, cachedTokens: 0, outputTokens: 4, thinkingTokens: 0 }, durationMs: 7, attempts: 1 });
    const flush = telemetry.recordFailure({ stage: "visual_quality", reasonCode: "visual_quality_failed" });
    expect(sink).toEqual([]);
    release();
    await flush;

    expect(sink).toEqual([{ schemaVersion: "fable-generation-telemetry/1.0", outcome: "failed", stage: "visual_quality", reasonCode: "visual_quality_failed", paidCalls: [{ stage: "final_critic", kind: "model", modelId: "accounts/fireworks/models/qwen3p7-plus", usage: { inputTokens: 12, cachedTokens: 0, outputTokens: 4, thinkingTokens: 0 }, durationMs: 7, attempts: 1 }], cost: expect.any(Object) }]);
    expect(JSON.stringify(sink)).not.toMatch(/prompt|program|html|base64|screenshot|identity|https?:/i);
  });

  it.each(["delivered", "failed"] as const)("uses the default operational sink for a redacted paid %s event", async (outcome) => {
    const retained: unknown[] = [];
    vi.spyOn(console, "info").mockImplementation((line) => { retained.push(JSON.parse(String(line))); });
    const telemetry = createFableGenerationTelemetry();
    telemetry.recordModel({ stage: "final_critic", modelId: "accounts/fireworks/models/qwen3p7-plus", usage: { inputTokens: 12, cachedTokens: 0, outputTokens: 4, thinkingTokens: 0 }, durationMs: 7, attempts: 1 });

    if (outcome === "delivered") await telemetry.recordDelivered();
    else await telemetry.recordFailure({ stage: "visual_quality", reasonCode: "provider_error" });

    expect(retained).toEqual([expect.objectContaining({
      schemaVersion: "fable-generation-telemetry/1.0",
      outcome,
      stage: outcome === "delivered" ? "delivery" : "visual_quality",
      paidCalls: [expect.objectContaining({ kind: "model", modelId: "accounts/fireworks/models/qwen3p7-plus", durationMs: 7, attempts: 1 })],
    })]);
    expect(JSON.stringify(retained)).not.toMatch(/"(?:userId|prompt|copy|html|screenshot|url|providerBody|credential|secret)"\s*:/i);
  });

  it("keeps an operational sink exception nonfatal", async () => {
    const telemetry = createFableGenerationTelemetry({ sink: async () => { throw new Error("journal unavailable"); } });
    telemetry.recordModel({ stage: "final_critic", modelId: "accounts/fireworks/models/qwen3p7-plus", usage: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, thinkingTokens: 0 }, durationMs: 1, attempts: 1 });
    await expect(telemetry.recordDelivered()).resolves.toBeUndefined();
  });
});
