import { describe, expect, it, vi } from "vitest";

import type { FireworksJsonClient, } from "./fireworks-client";
import type { FireworksJsonRequest } from "./fireworks-contracts";
import { assessFinalVisualCandidate } from "./qwen-visual-critic";

const JPEG = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKmqsrO0tba3uLm6wsLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDq6KKK/os/KgooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//2Q==";

const verdict = {
  schemaVersion: "fable-visual-verdict/1.0" as const,
  nicheRecognition: 9,
  promptFidelity: 8,
  visualQuality: 8,
  coherence: 8,
  originality: 8,
  mobileQuality: 8,
  wrongNiche: false,
  genericAiStyle: false,
  issues: [],
  decision: "accept" as const,
};

function client(reply = verdict) {
  let request: FireworksJsonRequest<unknown> | undefined;
  const value: FireworksJsonClient = {
    async request<T>(candidate: FireworksJsonRequest<T>) {
      request = candidate as FireworksJsonRequest<unknown>;
      return { ok: true as const, value: candidate.responseSchema.parse(reply), modelId: "accounts/fireworks/models/qwen3p7-plus", usage: { inputTokens: 12, cachedTokens: 0, outputTokens: 8, thinkingTokens: 0 }, durationMs: 4, attempts: 1 as const };
    },
  };
  return { value, request: () => request };
}

const input = {
  requestId: "page-final-1",
  brief: { niche: "children_creativity", requiredSignals: ["hand_drawn"], forbiddenSignals: ["saas_dashboard"] },
  screenshots: { desktop: { mimeType: "image/jpeg" as const, dataBase64: JPEG }, mobile: { mimeType: "image/jpeg" as const, dataBase64: JPEG } },
  deterministic: { mobileOverflow: false, weakTypographyHierarchy: false, invalidGeometry: false },
};

describe("assessFinalVisualCandidate", () => {
  it("sends only the allowlisted brief and actual desktop/mobile images to Qwen", async () => {
    const qwen = client();
    const result = await assessFinalVisualCandidate(input, { client: qwen.value });

    expect(result).toMatchObject({ ok: true, verdict: { decision: "accept", nicheRecognition: 9 } });
    const messages = qwen.request()!.messages;
    expect(messages).toHaveLength(3);
    expect(messages[1]).toMatchObject({ role: "user", content: [{ type: "text", text: expect.stringContaining("children_creativity") }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${JPEG}` } }] });
    expect(messages[2]).toMatchObject({ role: "user", content: [{ type: "text", text: expect.stringContaining("mobile") }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${JPEG}` } }] });
    const desktopParts = messages[1]!.content as readonly [{ type: "text"; text: string }, { type: "image_url"; image_url: { url: string } }];
    const mobileParts = messages[2]!.content as readonly [{ type: "text"; text: string }, { type: "image_url"; image_url: { url: string } }];
    expect([desktopParts[0].text, mobileParts[0].text].join("\n")).not.toMatch(/html|css|https?:|private-copy/i);
  });

  it("overrides a Qwen accept when a deterministic overflow, typography, or geometry failure exists", async () => {
    const result = await assessFinalVisualCandidate({ ...input, deterministic: { mobileOverflow: true, weakTypographyHierarchy: true, invalidGeometry: true } }, { client: client().value });
    expect(result).toMatchObject({ ok: true, verdict: expect.objectContaining({ decision: "reject", issues: expect.arrayContaining([
      expect.objectContaining({ code: "overflow" }),
      expect.objectContaining({ code: "typography" }),
      expect.objectContaining({ code: "geometry" }),
    ]) }) });
  });

  it("does not accept wrong-niche, generic, or low-recognition Qwen output", async () => {
    for (const reply of [
      { ...verdict, wrongNiche: true },
      { ...verdict, genericAiStyle: true },
      { ...verdict, nicheRecognition: 6 },
    ]) {
      const result = await assessFinalVisualCandidate(input, { client: client(reply).value });
      expect(result).toMatchObject({ ok: true, verdict: { decision: "reject" } });
    }
  });
});
