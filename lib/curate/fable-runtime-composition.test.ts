import { describe, expect, it, vi } from "vitest";

import { createFableRuntimeComposition } from "./fable-runtime-composition";

const JPEG = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKmqsrO0tba3uLm6wsLDxMT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QADAMBAAIRAxEAPwDq6KKK/os/KgooooAKKKKACiiigAooooAKKKKACiiigD//2Q==";

describe("Fable runtime composition", () => {
  it("owns one budget/client boundary and delivers an accepted Qwen review without a test-only gate", async () => {
    const client = { request: vi.fn(async (request) => ({
      ok: true as const,
      value: request.responseSchema.parse({
        schemaVersion: "fable-visual-verdict/1.0", nicheRecognition: 9, promptFidelity: 8, visualQuality: 8,
        coherence: 8, originality: 8, mobileQuality: 8, wrongNiche: false, genericAiStyle: false, issues: [], decision: "accept",
      }),
      modelId: "accounts/fireworks/models/qwen3p7-plus",
      usage: { inputTokens: 4, cachedTokens: 0, outputTokens: 3, thinkingTokens: 0 }, durationMs: 2, attempts: 1 as const,
    })) };
    const sink = vi.fn();
    const runtime = createFableRuntimeComposition({
      client: client as never,
      budgetConfig: { rateCardVersion: "test", mxnPerUsd: 20, targetMicromxn: 5_000_000, capMicromxn: 10_000_000 },
      telemetrySink: sink,
      inspect: async () => ({ ok: true, deterministic: { mobileOverflow: false, weakTypographyHierarchy: false, invalidGeometry: false }, screenshots: { desktop: { mimeType: "image/jpeg", dataBase64: "aGVsbG8=" }, mobile: { mimeType: "image/jpeg", dataBase64: "aGVsbG8=" } } }),
    });

    const candidate = { html: "<!doctype html><html><body></body></html>", visualEngine: {} as never };
    const result = await runtime.runFinalGate({
      requestId: "page-1", candidate, handoff: {} as never,
      brief: { niche: "children_creativity", requiredSignals: ["hand_drawn"], forbiddenSignals: ["saas_dashboard"] },
    });

    expect(result).toEqual({ ok: true, candidate, repaired: false });
    expect(client.request).toHaveBeenCalledOnce();
    expect(runtime.pageBudget).toBeDefined();
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ outcome: "delivered", paidCalls: [expect.objectContaining({ modelId: "accounts/fireworks/models/qwen3p7-plus" })] }));
  });
});
