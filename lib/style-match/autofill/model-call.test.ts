// lib/style-match/autofill/model-call.test.ts — `callModel` asks the policy who serves the role, and says who did.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetProviderHealth } from "@/lib/agent/provider-health";
import { _resetProviderWarnings } from "@/lib/ai/providers";
import { callModel } from "./model-call";

const DEEPINFRA = "https://api.deepinfra.com/v1/openai/chat/completions";
const FIREWORKS = "https://api.fireworks.ai/inference/v1/chat/completions";

const sse = (text: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: "stop" }] })}\n\n` +
  `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 40, completion_tokens: 3, total_tokens: 43 } })}\n\n` +
  "data: [DONE]\n\n";

let urls: string[];

beforeEach(() => {
  _resetProviderHealth();
  _resetProviderWarnings();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  urls = [];
  vi.stubEnv("FIREWORKS_API_KEY", "fw-key");
  vi.stubEnv("DEEPINFRA_API_KEY", "di-key");
  vi.stubEnv("OPENLEN_AGENT_PROVIDERS", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(String(url));
      return new Response(sse('{"ok":true}'), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const call = (over: Partial<Parameters<typeof callModel>[0]> = {}) =>
  callModel({
    system: "extract",
    user: "a bakery in Lisbon",
    operation: "simple_extraction",
    requestId: "autofill-extract-text",
    maxOutputTokens: 32,
    temperature: 0,
    jsonObject: true,
    ...over,
  });

describe("callModel — the reasoner on DeepInfra, with Fireworks behind", () => {
  it("goes to DeepInfra first and says so in its usage", async () => {
    const r = await call();
    expect(urls).toEqual([DEEPINFRA]);
    expect(r).toEqual({
      ok: true,
      raw: '{"ok":true}',
      usage: { inputTokens: 40, outputTokens: 3, provider: "deepinfra", model: "deepseek-ai/DeepSeek-V4.1-Flash-1017" },
    });
  });

  it("the vision role too (candidate_scouting, with its picture)", async () => {
    await call({ operation: "candidate_scouting", images: [{ mimeType: "image/png", dataBase64: "AAAA" }] });
    expect(urls).toEqual([DEEPINFRA]);
  });

  it("`providers: ['fireworks']` keeps a call on Fireworks", async () => {
    const r = await call({ providers: ["fireworks"] });
    expect(urls).toEqual([FIREWORKS]);
    expect(r.ok && r.usage).toMatchObject({ provider: "fireworks", model: "accounts/fireworks/models/deepseek-v4p1-flash-1017" });
  });
});
