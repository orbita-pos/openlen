import { describe, expect, it } from "vitest";

import { createFableGenerationTelemetry } from "./fable-generation-telemetry";

describe("Fable generation telemetry", () => {
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
});
