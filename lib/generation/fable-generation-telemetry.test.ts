import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFableGenerationTelemetry,
  FABLE_TELEMETRY_STAGES,
  type FableGenerationTelemetryEvent,
} from "./fable-generation-telemetry";

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

    expect(sink).toEqual([{ schemaVersion: "fable-generation-telemetry/1.0", outcome: "failed", stage: "visual_quality", reasonCode: "visual_quality_failed", paidCalls: [{ stage: "final_critic", kind: "model", modelId: "accounts/fireworks/models/qwen3p7-plus", usage: { inputTokens: 12, cachedTokens: 0, outputTokens: 4, thinkingTokens: 0 }, durationMs: 7, attempts: 1 }], degradations: [], cost: expect.any(Object) }]);
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

  it("delivers after a degraded stage instead of spending the outcome on it", async () => {
    const sink: FableGenerationTelemetryEvent[] = [];
    const telemetry = createFableGenerationTelemetry({ sink: (event) => { sink.push(event); } });

    telemetry.recordDegraded({ stage: "creative_session", reasonCode: "provider" });
    telemetry.recordDegraded({ stage: "advisory_review", reasonCode: "review_unavailable" });
    await telemetry.recordDelivered();

    expect(sink).toHaveLength(1);
    expect(sink[0]).toMatchObject({
      outcome: "delivered",
      stage: "delivery",
      reasonCode: null,
      degradations: [
        { stage: "creative_session", reasonCode: "provider" },
        { stage: "advisory_review", reasonCode: "review_unavailable" },
      ],
    });
  });

  // A stage or reason code the schema rejects makes the operational sink drop
  // the entire event — the whole request goes dark, silently.
  it.each(FABLE_TELEMETRY_STAGES)("keeps the default operational sink writing for the %s stage", async (stage) => {
    const retained: unknown[] = [];
    vi.spyOn(console, "info").mockImplementation((line) => { retained.push(JSON.parse(String(line))); });
    const telemetry = createFableGenerationTelemetry();
    telemetry.recordModel({ stage, modelId: "accounts/fireworks/models/deepseek-v4-flash-0731", usage: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, thinkingTokens: 0 }, durationMs: 1, attempts: 1 });
    telemetry.recordDegraded({ stage, reasonCode: "Provider Timeout!" });

    await telemetry.recordDelivered();

    expect(retained).toEqual([expect.objectContaining({
      outcome: "delivered",
      paidCalls: [expect.objectContaining({ stage })],
      degradations: [{ stage, reasonCode: "provider_timeout" }],
    })]);
  });

  it("keeps an operational sink exception nonfatal", async () => {
    const telemetry = createFableGenerationTelemetry({ sink: async () => { throw new Error("journal unavailable"); } });
    telemetry.recordModel({ stage: "final_critic", modelId: "accounts/fireworks/models/qwen3p7-plus", usage: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, thinkingTokens: 0 }, durationMs: 1, attempts: 1 });
    await expect(telemetry.recordDelivered()).resolves.toBeUndefined();
  });
});
